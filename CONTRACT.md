# DataSphere Showcase — server ↔ web contract

This is the single source of truth for the API between `server/` (Python FastAPI) and `web/`
(React + Vite). Both sides must follow it exactly. If something here is ambiguous, pick the
simplest behaviour that keeps every field listed below present and correctly typed.

The showcase site markets **Enterprise DataSphere** (a multi-database reliability platform:
PostgreSQL as source of truth, transactional outbox, idempotent consumer, MongoDB read models,
HA/DR, performance lab, capacity planning). The backend powers the *live, interactive* parts of
the site. It never pretends to be real PostgreSQL/MongoDB: the commerce + HA parts are an
**in-memory simulation of the patterns**, and the index benchmark is a **real measurement on
in-memory SQLite**. Nothing may return invented "measured" numbers.

## Runtime

- Python 3.12, FastAPI, uvicorn, pydantic v2. Directory `server/`. Package `server/app/`.
- Bind `127.0.0.1:8710`. Entrypoint: `uvicorn app.main:app --host 127.0.0.1 --port 8710` run from `server/`.
- The Vite dev server (port 5180) proxies `/api` and `/metrics` to `http://127.0.0.1:8710`.
- CORS: allow only `http://localhost:5180` and `http://127.0.0.1:5180`.
- Every response carries `X-Request-ID` (echo a valid incoming one, else a new uuid4 hex).
- Errors are always JSON: `{"error": {"code": "UPPER_SNAKE", "message": str, "request_id": str, "details": object|null}}`
  with the right status code (400/404/409/422/429/500). Pydantic validation errors → 422 with
  code `VALIDATION_ERROR`, and `details` listing field errors (no stack traces, ever).
- Timestamps: ISO-8601 UTC, millisecond precision, `Z` suffix, e.g. `2026-10-10T17:03:11.482Z`.
- IDs: prefixed short random ids: `ord_xxxxxxxx`, `evt_xxxxxxxx`, `cus_xxxxxxxx`, `dlv_xxxxxxxx`, `run_xxxxxxxx`.
- Env `DS_SIM_AUTOSTART` (default `1`): when `0`, background loops (relay, consumer, ambient
  traffic, HA ticker) do not start — tests drive the simulation by calling tick functions with a
  controllable clock.

## 1. Health

`GET /api/health` → 200
```json
{"status": "ok", "version": "1.0.0", "started_at": "ts", "uptime_s": 12.3,
 "simulation": {"running": true}}
```

## 2. Commerce + transactional-outbox simulation

Models the real DataSphere flow: one PostgreSQL transaction writes order + order item +
inventory decrement + inventory movement + outbox row; a relay publishes outbox rows; a consumer
applies events idempotently to MongoDB read models; a resume token tracks consumer progress;
a reconciler repairs read-model drift from the source of truth.

Seed (deterministic, `random.Random(7)`): 6 products, 8 synthetic customers. Products have
`stock` between 25 and 60. Suggested catalog (use exactly these skus):
`SKU-AURORA-LAMP` (Lighting), `SKU-NIMBUS-CHAIR` (Furniture), `SKU-ORBIT-DESK` (Furniture),
`SKU-PULSE-EARBUDS` (Audio), `SKU-QUARTZ-KETTLE` (Kitchen), `SKU-VELA-BACKPACK` (Travel).
Customer names are obviously synthetic (e.g. "Asha Rao", "Leo Brandt" … mixed, 8 total),
tiers in `gold|silver|standard`.

### `POST /api/sim/orders`
Body: `{"sku": str, "qty": int 1..20, "customer_id": str|null, "idempotency_key": str|null}`
- `idempotency_key`: 8..64 chars `[A-Za-z0-9_-]`; generated server-side if absent. The header
  `Idempotency-Key` is also accepted and wins over the body field.
- Whole operation is atomic (single `asyncio.Lock` critical section = "one PG transaction").
- Unknown sku → 404 `PRODUCT_NOT_FOUND`. Unknown customer_id → 404 `CUSTOMER_NOT_FOUND`.
  Missing customer_id → random seeded customer.
- Key already used with the **same** request fingerprint (sku, qty, customer) → 200
  `{"order": Order, "replayed": true, "outbox_event_id": str}` and NO new writes.
- Key already used with a **different** fingerprint → 422 `IDEMPOTENCY_KEY_REUSED`.
- `stock < qty` → 409 `INSUFFICIENT_STOCK`, details `{"available": int, "requested": int, "sku": str}`.
  Nothing is written (no partial order, stock never negative).
- Success → 201 `{"order": Order, "replayed": false, "outbox_event_id": str}`.
- Emits stream events `order.committed` | `order.replayed` | `order.rejected`.

### `POST /api/sim/chaos`
Body: `{"action": str, "count": int|null}` → 200 `{"ok": true, "action": str, "message": str}`
Actions:
- `duplicate_next` — the next published event is delivered twice (second delivery kind `duplicate`, ~400 ms later).
- `delay_next` — the next published event's delivery is delayed by 6 s (kind `delayed`), so later events may overtake it.
- `crash_consumer` — consumer status → `crashed` (deliveries pile up in the broker).
- `restart_consumer` — if resume token valid: status → `running`, re-deliver (kind `redelivery`)
  every published event with position > token position that is not already in-flight; ones that
  were actually processed are ignored as duplicates. If the token is invalid: status → `resyncing`,
  emit `resume_token.invalid`, run a full reconciliation from PostgreSQL state, set a fresh token
  at the current outbox head, status → `running`.
- `invalidate_resume_token` — simulates the oplog rolling past the stored token. Token `valid=false`;
  if the consumer was running it crashes with `last_error` =
  `"ChangeStreamHistoryLost (code 286): resume point is no longer in the oplog"`.
- `drop_readmodel_doc` — deletes (or corrupts the total of) one random Mongo order view to simulate drift.
- `reconcile` — scan all PG orders vs Mongo views; re-project missing/stale ones from PG.
  Emits `reconcile.started` and `reconcile.completed` `{"scanned", "repaired", "duration_ms"}`.
- `burst` — place `count` (1..50, default 20) random orders through the normal code path.
- `reset` — reinitialise the whole commerce simulation from the seed.
Unknown action → 400 `UNKNOWN_ACTION`. Burst while > 200 in-flight deliveries → 429 `BACKPRESSURE`.

### `POST /api/sim/traffic`
Body `{"enabled": bool, "orders_per_min": int 0..120}` → 200 `{"enabled": bool, "orders_per_min": int}`.
Default ambient traffic: enabled, 18 orders/min, random gaps (exponential-ish), random sku/customer/qty 1..3.
Auto-restock: when a product's stock drops below 6, ~2 s later +40 units (inventory movement
`receipt`), event `inventory.restocked`.

### `GET /api/sim/state` → `SimState`

```ts
SimState = {
  seq: number;                 // last emitted event seq
  now: string;
  traffic: { enabled: boolean; orders_per_min: number };
  products: { sku: string; name: string; category: string; price_cents: number; stock: number }[];
  customers: { id: string; name: string; tier: "gold"|"silver"|"standard" }[];
  postgres: {
    orders_total: number;
    orders: Order[];                       // newest first, max 12
    outbox: { pending: number; published_total: number; rows: OutboxRow[] };  // rows newest first, max 10
    inventory_movements_total: number;
    idempotency_keys: number;
  };
  broker: { in_flight: number; delayed: number; deliveries: Delivery[] };     // soonest first, max 20
  consumer: {
    status: "running"|"crashed"|"resyncing";
    resume_token: { position: number; valid: boolean } | null;
    processed_total: number; duplicates_ignored: number; retries: number;
    last_processed_at: string|null; last_error: string|null;
  };
  mongo: { order_views_total: number; order_views: OrderView[]; customer_stats: CustomerStats[] }; // views newest first max 12; stats sorted by lifetime desc, max 8
  consistency: {
    status: "consistent"|"converging"|"diverged";
      // consistent: every PG order has an up-to-date view and nothing pending/in-flight
      // converging: differences exist but are explained by pending/in-flight events and consumer running
      // diverged: differences not explained by in-flight work (consumer crashed/resyncing, dropped docs)
    pg_orders: number; mongo_views: number; missing_in_mongo: number; stale_in_mongo: number;
    lag_events: number;            // published-or-pending events not yet applied
    last_reconciled_at: string|null;
  };
  metrics: {
    orders_committed: number; orders_rejected: number; idempotent_replays: number;
    events_published: number; events_delivered: number; duplicates_ignored: number;
    consumer_crashes: number; reconciliations: number; events_per_sec_1m: number;
  };
}
Order = { id; customer_id; customer_name; sku; product_name; qty; unit_price_cents; total_cents;
          status: "placed"; idempotency_key; created_at; outbox_event_id; position: number }
OutboxRow = { event_id; aggregate_id; event_type: "order.placed"; position: number;
              status: "pending"|"published"; attempts: number; created_at; published_at: string|null }
Delivery = { delivery_id; event_id; order_id; position: number; attempt: number;
             kind: "normal"|"duplicate"|"delayed"|"redelivery"; deliver_at: string }
OrderView = { _id: string /*order id*/; customer: {id; name; tier}; items: {sku; name; qty; unit_price_cents}[];
              total_cents; status; source_event_id; projected_at; projected_by: "consumer"|"reconciler"; version: number }
CustomerStats = { _id: string; name: string; orders: number; lifetime_cents: number; last_order_at: string|null }
```

Timing (real wall-clock when autostarted): relay polls every ~400 ms (batch ≤ 10, oldest first,
publish delay so a `pending` row is visible for ≥ 300 ms); a normal delivery lands 300–900 ms after
publish; consumer loop every ~100 ms. Resume token position = contiguous watermark (highest position
p such that every position ≤ p has been applied). Memory is bounded (ring buffers; processed-id set
may be trimmed below the watermark because positions ≤ watermark count as processed).

## 3. HA / failover simulation (PostgreSQL primary + standby)

`GET /api/ha/state` → `HAState`; `POST /api/ha/action` body
`{"action": "kill_primary"|"promote_standby"|"rejoin_old_primary"|"set_mode"|"write_burst"|"reset", "mode": "sync"|"async"|null}`
→ 200 `{"ok": true, "message": str, "state": HAState}`; invalid transitions → 409 `INVALID_TRANSITION`
with a human message (e.g. promoting while the primary is healthy, rejoining with nothing to rejoin).

```ts
HAState = {
  mode: "async"|"sync";
  nodes: { id: "pg-a"|"pg-b"; role: "primary"|"standby"|"down"|"fenced"|"rewinding";
           timeline: number; lsn: number /*WAL bytes written/received*/; replay_lsn: number; healthy: boolean }[];
  primary_id: string|null;
  committed_txns: number;            // txns acknowledged to clients on the current timeline history
  lag_bytes: number; lag_ms: number; // standby replay lag (0 if no standby)
  commit_latency_ms_p50: number;     // simulated, sync mode is higher (waits for standby flush)
  writes_per_sec: number;
  incident: { started_at: string; killed: string } | null;   // open outage
  last_failover: { at: string; from: string; to: string; mode: "async"|"sync";
                   rpo_lost_txns: number; rpo_lost_bytes: number; rto_ms: number } | null;
  events: { ts: string; level: "info"|"warn"|"error"; message: string }[];  // newest first, max 20
}
```
Behaviour: the primary commits ~40 txns/s (~180–260 WAL bytes each) while healthy. Async: standby
receives/replays with 150–600 ms jitter → non-zero lag. Sync: commit acknowledged only after
standby flush → lag ≈ 0 for acknowledged txns, higher commit latency. `kill_primary` → primary
`down`, incident opens, writes stop. `promote_standby` → standby becomes primary on `timeline+1`;
`rpo_lost_txns/bytes` = acknowledged-on-old-primary minus replayed-on-standby (0 in sync mode);
`rto_ms` = real elapsed time from kill to promotion. `rejoin_old_primary` → old node comes back
thinking it is primary on the old timeline: emit a split-brain warning, role `fenced`, then
`rewinding` (pg_rewind) for ~2 s, then `standby` of the new primary on the new timeline.
`write_burst` adds 400 txns instantly. Stream events use types prefixed `ha.`.

## 4. Real index micro-benchmark (SQLite, in-memory)

`POST /api/lab/index-bench` body `{"rows": int 5000..300000 (default 100000), "repeats": int 5..60 (default 30)}`
Runs in a worker thread; only one at a time (409 `BENCH_BUSY`). Seeded data (`random.Random(42)`),
table `orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, status TEXT NOT NULL,
created_at INTEGER NOT NULL, total_cents INTEGER NOT NULL)`, customers = rows // 50.
Query: `SELECT id, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`
(random customer per repeat, same sequence before and after). Index:
`CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC)`.
Write overhead: time a batch of `min(20000, rows // 5)` inserts before the index and another batch
of the same size after it.

→ 200
```ts
BenchRun = {
  run_id; started_at; duration_ms: number; engine: "sqlite"; sqlite_version; python_version;
  platform: string; cpu_count: number; rows: number; repeats: number; query: string;
  baseline: { plan: string[]; latency_ms: Stats; samples_ms: number[] };
  indexed:  { plan: string[]; latency_ms: Stats; samples_ms: number[] };
  index: { name; ddl; build_ms; bytes_before; bytes_after; overhead_bytes; overhead_pct };
  writes: { batch_rows; no_index_ms; with_index_ms; no_index_rows_per_sec; with_index_rows_per_sec; overhead_pct };
  speedup_p50: number;
  notes: string[];   // honest caveats: in-memory SQLite, not PostgreSQL; laptop; small sample etc.
}
Stats = { p50: number; p95: number|null /* null if repeats < 20 */; mean: number; min: number; max: number }
```
`GET /api/lab/runs` → `{"runs": BenchRun[]}` newest first, max 10 (in memory).
Plans come from `EXPLAIN QUERY PLAN` (detail column), so they read like `SCAN orders` /
`USE TEMP B-TREE FOR ORDER BY` before and `SEARCH orders USING INDEX idx_orders_customer_created (customer_id=?)` after.

## 5. Capacity planner (estimates only)

`POST /api/capacity` body (all required, validated ranges):
```ts
{ records_per_day: int 0..1_000_000_000; avg_record_bytes: int 16..1_000_000;
  events_per_record: number 0..50; avg_event_bytes: int 16..1_000_000;
  index_overhead_pct: number 0..300; replication_factor: int 1..7;
  backup_full_copies: int 0..60; retention_days: int 1..3650;
  archive_compression_ratio: number 1..20; monthly_growth_pct: number -50..200; threshold_gb: number >0 }
```
Model (day-level loop over 365 days, month = 30.4375 days): day d volume = base × (1+g)^(d/30.4375).
Hot set = last `retention_days` of (records + events) + index overhead on records+events;
older data moves to archive compressed by `archive_compression_ratio` (single copy, no index).
Replica bytes = hot × (RF − 1). Backups = `backup_full_copies` × hot primary bytes (uncompressed
logical fulls — stated as an assumption). Total = hot primary + replicas + backups + archive.

→ 200
```ts
{ kind: "estimate"; assumptions: string[];
  daily: { record_bytes; event_bytes; index_bytes; primary_bytes; replicated_bytes };
  horizons: { label: "1 day"|"1 month"|"3 months"|"6 months"|"12 months"; months: number;
              hot_bytes; replica_bytes; backup_bytes; archive_bytes; total_bytes }[];
  series: { base: { month: number; hot_bytes; replica_bytes; backup_bytes; archive_bytes; total_bytes }[]; // months 0..12
            low:  { month: number; total_bytes }[]; high: { month: number; total_bytes }[] };
  scenarios: { low: { monthly_growth_pct }; base: { monthly_growth_pct }; high: { monthly_growth_pct } };
     // low = g×0.5 (or g−5 if g≤0), high = g×1.5 (or g+5 if g≤0)
  threshold: { gb: number; crossed_at_month: number|null };  // base scenario, linear interp between months
  sensitivity: { parameter: string; change: "+20%"; total_12m_bytes: number; delta_pct: number }[];
}
```
All byte values are integers.

## 6. Live stream (Server-Sent Events)

`GET /api/sim/stream` → `text/event-stream`, no buffering.
- On connect: `event: state` with `{"sim": SimState, "ha": HAState}`.
- Every ~1000 ms: `event: state` with the same shape.
- Each discrete event: `event: sim` with `{"seq": int, "ts": str, "type": str, "data": object}`.
  Types: `order.committed`, `order.replayed`, `order.rejected`, `outbox.published`,
  `event.delivered`, `event.duplicate_ignored`, `readmodel.upserted`, `consumer.crashed`,
  `consumer.restarted`, `resume_token.invalid`, `resync.completed`, `reconcile.started`,
  `reconcile.completed`, `readmodel.dropped`, `inventory.restocked`, `traffic.changed`,
  `sim.reset`, `ha.write_burst`, `ha.primary_down`, `ha.promoted`, `ha.split_brain_prevented`,
  `ha.rewind_started`, `ha.rejoined`, `ha.mode_changed`, `ha.reset`.
  `data` always includes the ids needed to animate (order_id, event_id, delivery kind, sku, node ids…).
- `: ping` comment every 15 s. Each client has its own bounded queue (drop oldest when slow).

## 7. Prometheus metrics

`GET /metrics` → Prometheus text exposition (HELP/TYPE lines), low-cardinality labels only:
`datasphere_sim_orders_committed_total`, `datasphere_sim_orders_rejected_total`,
`datasphere_sim_idempotent_replays_total`, `datasphere_sim_events_published_total`,
`datasphere_sim_events_delivered_total`, `datasphere_sim_duplicates_ignored_total`,
`datasphere_sim_outbox_pending`, `datasphere_sim_consumer_up`, `datasphere_sim_consistency_lag_events`,
`datasphere_ha_replication_lag_bytes`, `datasphere_lab_bench_runs_total`,
`datasphere_http_requests_total{method,route,status}` (route = path template, never raw path),
`datasphere_http_request_duration_seconds` histogram `{method,route}`.
