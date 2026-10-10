import asyncio
from collections import OrderedDict
from copy import deepcopy
import random
import time

from app.errors import APIError
from app.sim.bus import EventBus, short_id, timestamp

HISTORY_LOST = "ChangeStreamHistoryLost (code 286): resume point is no longer in the oplog"
CATALOG = [
    ("SKU-AURORA-LAMP", "Aurora Lamp", "Lighting", 7900),
    ("SKU-NIMBUS-CHAIR", "Nimbus Chair", "Furniture", 24900),
    ("SKU-ORBIT-DESK", "Orbit Desk", "Furniture", 42900),
    ("SKU-PULSE-EARBUDS", "Pulse Earbuds", "Audio", 9900),
    ("SKU-QUARTZ-KETTLE", "Quartz Kettle", "Kitchen", 6900),
    ("SKU-VELA-BACKPACK", "Vela Backpack", "Travel", 8900),
]
NAMES = ["Asha Rao", "Leo Brandt", "Mina Park", "Omar Silva", "Zoe Chen", "Niko Patel", "Lila Moss", "Arun Bell"]


class Commerce:
    """In-memory outbox with explicit ticks and a bounded retained transaction window.

    Only settled, consistent transactions are retired. Archived counts and customer
    aggregates remain exact; unresolved work cannot be evicted to hide divergence.
    """

    def __init__(self, bus=None, clock=time.time, history_limit=4096):
        self.clock = clock
        self.bus = bus or EventBus(clock)
        self.history_limit = history_limit
        self.lock = asyncio.Lock()
        self._reset(clock())

    def _reset(self, now):
        self.rng = random.Random(7)
        self.products = {sku: {"sku": sku, "name": name, "category": category,
                              "price_cents": price, "stock": self.rng.randint(25, 60)}
                         for sku, name, category, price in CATALOG}
        self.customers = {}
        for i, name in enumerate(NAMES):
            cid = f"cus_{self.rng.getrandbits(32):08x}"
            self.customers[cid] = {"id": cid, "name": name, "tier": ("gold", "silver", "standard")[i % 3]}
        self.orders, self.outbox, self.views, self.keys = (OrderedDict() for _ in range(4))
        self.deliveries = {}
        self.processed_ids = {}
        self.processed_positions = set()
        self.watermark = self.head = 0
        self.token_valid = True
        self.status = "running"
        self.last_error = self.last_processed_at = self.last_reconciled_at = None
        self.processed_total = self.duplicates_ignored = self.retries = 0
        self.orders_total = self.published_total = self.movements_total = self.archived_views = 0
        self.counts = dict.fromkeys(("orders_committed", "orders_rejected", "idempotent_replays",
                                    "events_published", "events_delivered", "duplicates_ignored",
                                    "consumer_crashes", "reconciliations"), 0)
        self.customer_stats = {cid: {"_id": cid, "name": c["name"], "orders": 0,
                                     "lifetime_cents": 0, "last_order_at": None}
                               for cid, c in self.customers.items()}
        self.archived_last_order = dict.fromkeys(self.customers)
        self.duplicate_next = self.delay_next = False
        self.traffic = {"enabled": True, "orders_per_min": 18}
        self.next_traffic = now + self.rng.expovariate(18 / 60)
        self.restocks = {}

    def emit(self, kind, data, now):
        self.bus.emit(kind, data, now)

    def _expected_view(self, order):
        c = self.customers[order["customer_id"]]
        return {"_id": order["id"], "customer": deepcopy(c),
                "items": [{"sku": order["sku"], "name": order["product_name"], "qty": order["qty"],
                           "unit_price_cents": order["unit_price_cents"]}],
                "total_cents": order["total_cents"], "status": "placed",
                "source_event_id": order["outbox_event_id"], "version": 1}

    def _matches(self, order):
        view = self.views.get(order["id"])
        return view is not None and all(view.get(k) == v for k, v in self._expected_view(order).items())

    def _make_room(self):
        if len(self.orders) < self.history_limit:
            return
        in_flight = {d["order_id"] for d in self.deliveries.values()}
        for oid, order in self.orders.items():
            row = self.outbox[order["outbox_event_id"]]
            if (order["position"] <= self.watermark and row["status"] == "published" and
                    oid not in in_flight and self._matches(order)):
                del self.orders[oid]
                del self.views[oid]
                del self.outbox[order["outbox_event_id"]]
                del self.keys[order["idempotency_key"]]
                self.archived_views += 1
                cid = order["customer_id"]
                self.archived_last_order[cid] = max(self.archived_last_order[cid] or "", order["created_at"])
                return
        raise APIError(429, "BACKPRESSURE", "Retained transaction window is full of unresolved work")

    async def place_order(self, sku, qty, customer_id=None, idempotency_key=None, now=None):
        now = self.clock() if now is None else now
        async with self.lock:
            try:
                key = idempotency_key or short_id("key")
                fingerprint = (sku, qty, customer_id)
                if key in self.keys:
                    old_fingerprint, order = self.keys[key]
                    if old_fingerprint != fingerprint:
                        raise APIError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was used for a different request")
                    self.counts["idempotent_replays"] += 1
                    self.emit("order.replayed", {"order_id": order["id"], "event_id": order["outbox_event_id"], "sku": sku}, now)
                    return {"order": deepcopy(order), "replayed": True, "outbox_event_id": order["outbox_event_id"]}
                if sku not in self.products:
                    raise APIError(404, "PRODUCT_NOT_FOUND", "Product not found")
                if customer_id is not None and customer_id not in self.customers:
                    raise APIError(404, "CUSTOMER_NOT_FOUND", "Customer not found")
                product = self.products[sku]
                if product["stock"] < qty:
                    raise APIError(409, "INSUFFICIENT_STOCK", "Insufficient stock",
                                   {"available": product["stock"], "requested": qty, "sku": sku})
                self._make_room()
                # The omitted customer remains None in the fingerprint: retrying
                # an identical request must not choose another random customer.
                cid = customer_id or self.rng.choice(list(self.customers))
                oid, eid = short_id("ord"), short_id("evt")
                self.head += 1
                order = {"id": oid, "customer_id": cid, "customer_name": self.customers[cid]["name"],
                         "sku": sku, "product_name": product["name"], "qty": qty,
                         "unit_price_cents": product["price_cents"], "total_cents": qty * product["price_cents"],
                         "status": "placed", "idempotency_key": key, "created_at": timestamp(now),
                         "outbox_event_id": eid, "position": self.head}
                self.orders[oid] = order
                self.outbox[eid] = {"event_id": eid, "aggregate_id": oid, "event_type": "order.placed",
                                    "position": self.head, "status": "pending", "attempts": 0,
                                    "created_at": timestamp(now), "published_at": None, "_created": now}
                self.keys[key] = (fingerprint, order)
                product["stock"] -= qty
                self.movements_total += 1
                self.orders_total += 1
                self.counts["orders_committed"] += 1
                if product["stock"] < 6:
                    self.restocks.setdefault(sku, now + 2)
                self.emit("order.committed", {"order_id": oid, "event_id": eid, "sku": sku, "qty": qty,
                                               "customer_id": cid, "position": self.head}, now)
                return {"order": deepcopy(order), "replayed": False, "outbox_event_id": eid}
            except APIError as exc:
                self.counts["orders_rejected"] += 1
                self.emit("order.rejected", {"sku": sku, "qty": qty, "code": exc.code}, now)
                raise

    def _schedule(self, row, now, kind="normal", delay=None):
        row["attempts"] += 1
        did = short_id("dlv")
        due = now + (self.rng.uniform(.3, .9) if delay is None else delay)
        self.deliveries[did] = {"delivery_id": did, "event_id": row["event_id"], "order_id": row["aggregate_id"],
                                "position": row["position"], "attempt": row["attempts"], "kind": kind,
                                "deliver_at": timestamp(due), "_due": due}
        return due

    async def relay_tick(self, now):
        async with self.lock:
            published = 0
            for row in self.outbox.values():
                if published >= 10 or len(self.deliveries) >= 512:
                    break
                if row["status"] != "pending" or now - row["_created"] < .3:
                    continue
                row["status"], row["published_at"] = "published", timestamp(now)
                kind, delay = ("delayed", 6) if self.delay_next else ("normal", None)
                due = self._schedule(row, now, kind, delay)
                self.delay_next = False
                if self.duplicate_next:
                    self._schedule(row, now, "duplicate", due - now + .4)
                    self.duplicate_next = False
                self.published_total += 1
                self.counts["events_published"] += 1
                published += 1
                self.emit("outbox.published", {"event_id": row["event_id"], "order_id": row["aggregate_id"],
                                               "position": row["position"], "kind": kind}, now)

    def _mark_processed(self, eid, position):
        if position > self.watermark:
            self.processed_positions.add(position)
            self.processed_ids[eid] = position
        while self.watermark + 1 in self.processed_positions:
            self.watermark += 1
            self.processed_positions.remove(self.watermark)
        self.processed_ids = {e: p for e, p in self.processed_ids.items() if p > self.watermark}

    def _project(self, order, by, now):
        oid = order["id"]
        existed = oid in self.views
        view = self._expected_view(order)
        view.update(projected_at=timestamp(now), projected_by=by)
        self.views[oid] = view
        # Add to customer aggregates only for a newly projected document; stale
        # document repair and duplicate deliveries cannot double count.
        self.emit("readmodel.upserted", {"order_id": oid, "event_id": order["outbox_event_id"],
                                        "customer_id": order["customer_id"], "sku": order["sku"], "projected_by": by}, now)
        if not existed:
            stat = self.customer_stats[order["customer_id"]]
            stat["orders"] += 1
            stat["lifetime_cents"] += order["total_cents"]
            stat["last_order_at"] = max(stat["last_order_at"] or "", order["created_at"])

    async def consumer_tick(self, now):
        async with self.lock:
            if self.status != "running":
                return
            due = sorted((d for d in self.deliveries.values() if d["_due"] <= now), key=lambda d: d["_due"])
            for d in due:
                del self.deliveries[d["delivery_id"]]
                self.counts["events_delivered"] += 1
                self.emit("event.delivered", {k: d[k] for k in ("delivery_id", "event_id", "order_id", "position", "kind")}, now)
                eid, pos = d["event_id"], d["position"]
                if pos <= self.watermark or eid in self.processed_ids:
                    self.duplicates_ignored += 1
                    self.counts["duplicates_ignored"] += 1
                    self.emit("event.duplicate_ignored", {"order_id": d["order_id"], "event_id": eid,
                                                           "position": pos, "kind": d["kind"]}, now)
                    continue
                self._project(self.orders[d["order_id"]], "consumer", now)
                self._mark_processed(eid, pos)
                self.processed_total += 1
                self.last_processed_at = timestamp(now)

    async def traffic_tick(self, now):
        if not self.traffic["enabled"] or not self.traffic["orders_per_min"] or now < self.next_traffic:
            return
        self.next_traffic = now + self.rng.expovariate(self.traffic["orders_per_min"] / 60)
        await self._random_order(now)

    async def _random_order(self, now):
        try:
            await self.place_order(self.rng.choice(list(self.products)), self.rng.randint(1, 3),
                                   self.rng.choice(list(self.customers)), now=now)
        except APIError:
            pass

    async def restock_tick(self, now):
        async with self.lock:
            for sku, due in list(self.restocks.items()):
                if due <= now:
                    self.products[sku]["stock"] += 40
                    self.movements_total += 1
                    del self.restocks[sku]
                    self.emit("inventory.restocked", {"sku": sku, "qty": 40, "kind": "receipt",
                                                       "stock": self.products[sku]["stock"]}, now)

    def _reconcile(self, now):
        started = time.perf_counter()
        self.emit("reconcile.started", {"scanned": len(self.orders)}, now)
        repaired = 0
        for order in self.orders.values():
            if not self._matches(order):
                self._project(order, "reconciler", now)
                repaired += 1
            if order["position"] > self.watermark and order["position"] not in self.processed_positions:
                self._mark_processed(order["outbox_event_id"], order["position"])
                self.processed_total += 1
                self.last_processed_at = timestamp(now)
        self.last_reconciled_at = timestamp(now)
        self.counts["reconciliations"] += 1
        report = {"scanned": len(self.orders), "repaired": repaired,
                  "duration_ms": (time.perf_counter() - started) * 1000}
        self.emit("reconcile.completed", report, now)
        return report

    async def chaos(self, action, count=None, now=None):
        now = self.clock() if now is None else now
        if action == "burst":
            if len(self.deliveries) > 200:
                raise APIError(429, "BACKPRESSURE", "More than 200 deliveries are in flight")
            for _ in range(count or 20):
                await self._random_order(now)
            return {"ok": True, "action": action, "message": f"Attempted {count or 20} orders"}
        async with self.lock:
            if action == "duplicate_next":
                self.duplicate_next = True
                message = "The next published event will be delivered twice"
            elif action == "delay_next":
                self.delay_next = True
                message = "The next published event will be delayed by 6 seconds"
            elif action == "crash_consumer":
                self.status = "crashed"
                self.last_error = "Consumer stopped by chaos injection"
                self.counts["consumer_crashes"] += 1
                self.emit("consumer.crashed", {"last_error": self.last_error}, now)
                message = "Consumer crashed; deliveries will accumulate"
            elif action == "invalidate_resume_token":
                self.token_valid = False
                if self.status == "running":
                    self.status = "crashed"
                    self.last_error = HISTORY_LOST
                    self.counts["consumer_crashes"] += 1
                    self.emit("consumer.crashed", {"last_error": HISTORY_LOST}, now)
                message = "Resume token is no longer in the oplog"
            elif action == "restart_consumer":
                if not self.token_valid:
                    self.status = "resyncing"
                    self.emit("resume_token.invalid", {"position": self.watermark, "message": HISTORY_LOST}, now)
                    report = self._reconcile(now)
                    self.watermark = self.head
                    self.processed_ids.clear()
                    self.processed_positions.clear()
                    self.token_valid = True
                    self.emit("resync.completed", {**report, "position": self.watermark}, now)
                    message = "Resynced from PostgreSQL state with a fresh resume token"
                else:
                    in_flight = {d["event_id"] for d in self.deliveries.values()}
                    for d in self.deliveries.values():
                        if d["position"] > self.watermark:
                            d["kind"] = "redelivery"
                    for row in self.outbox.values():
                        if row["status"] == "published" and row["position"] > self.watermark and row["event_id"] not in in_flight:
                            self._schedule(row, now, "redelivery")
                            self.retries += 1
                    message = "Consumer restarted from its contiguous resume token"
                self.status, self.last_error = "running", None
                self.emit("consumer.restarted", {"position": self.watermark}, now)
            elif action == "drop_readmodel_doc":
                if self.views:
                    oid = self.rng.choice(list(self.views))
                    view = self.views.pop(oid)
                    order = self.orders[oid]
                    cid = order["customer_id"]
                    stat = self.customer_stats[cid]
                    stat["orders"] -= 1
                    stat["lifetime_cents"] -= order["total_cents"]
                    dates = [self.orders[v]["created_at"] for v in self.views if self.orders[v]["customer_id"] == cid]
                    if self.archived_last_order[cid]:
                        dates.append(self.archived_last_order[cid])
                    stat["last_order_at"] = max(dates) if dates else None
                    self.emit("readmodel.dropped", {"order_id": oid, "event_id": view["source_event_id"]}, now)
                    message = f"Dropped order view {oid}"
                else:
                    message = "No order views to drop"
            elif action == "reconcile":
                report = self._reconcile(now)
                message = f"Scanned {report['scanned']} orders; repaired {report['repaired']} views in {report['duration_ms']:.3f} ms"
            elif action == "reset":
                self._reset(now)
                self.emit("sim.reset", {}, now)
                message = "Commerce simulation reset to deterministic seed"
            else:
                raise APIError(400, "UNKNOWN_ACTION", "Unknown commerce chaos action")
            return {"ok": True, "action": action, "message": message}

    async def set_traffic(self, enabled, orders_per_min, now=None):
        now = self.clock() if now is None else now
        async with self.lock:
            self.traffic = {"enabled": enabled, "orders_per_min": orders_per_min}
            self.next_traffic = now + self.rng.expovariate(orders_per_min / 60) if enabled and orders_per_min else float("inf")
            self.emit("traffic.changed", dict(self.traffic), now)
            return dict(self.traffic)

    def consistency(self):
        missing = sum(o["id"] not in self.views for o in self.orders.values())
        stale = sum(o["id"] in self.views and not self._matches(o) for o in self.orders.values())
        pending = sum(r["status"] == "pending" for r in self.outbox.values())
        lag = sum(o["position"] > self.watermark and o["position"] not in self.processed_positions for o in self.orders.values())
        unapplied = lambda p: p > self.watermark and p not in self.processed_positions
        work_ids = {r["aggregate_id"] for r in self.outbox.values() if r["status"] == "pending" and unapplied(r["position"])}
        work_ids.update(d["order_id"] for d in self.deliveries.values() if unapplied(d["position"]))
        drift = any(not self._matches(o) and o["id"] not in work_ids for o in self.orders.values())
        if not missing and not stale and not pending and not self.deliveries:
            status = "consistent"
        elif self.status != "running" or drift:
            status = "diverged"
        else:
            status = "converging"
        return {"status": status, "pg_orders": self.orders_total,
                "mongo_views": self.archived_views + len(self.views), "missing_in_mongo": missing,
                "stale_in_mongo": stale, "lag_events": lag, "last_reconciled_at": self.last_reconciled_at}

    def state(self, now=None):
        now = self.clock() if now is None else now
        clean = lambda row: {k: v for k, v in row.items() if not k.startswith("_")}
        # View order follows PG commit position, even when delayed events arrive last.
        views = [self.views[oid] for oid in reversed(self.orders) if oid in self.views][:12]
        state = {
            "seq": self.bus.seq, "now": timestamp(now), "traffic": self.traffic,
            "products": list(self.products.values()), "customers": list(self.customers.values()),
            "postgres": {"orders_total": self.orders_total, "orders": list(reversed(self.orders.values()))[:12],
                         "outbox": {"pending": sum(r["status"] == "pending" for r in self.outbox.values()),
                                    "published_total": self.published_total,
                                    "rows": [clean(r) for r in reversed(self.outbox.values())][:10]},
                         "inventory_movements_total": self.movements_total, "idempotency_keys": len(self.keys)},
            "broker": {"in_flight": len(self.deliveries),
                       "delayed": sum(d["kind"] == "delayed" for d in self.deliveries.values()),
                       "deliveries": [clean(d) for d in sorted(self.deliveries.values(), key=lambda d: d["_due"])[:20]]},
            "consumer": {"status": self.status, "resume_token": {"position": self.watermark, "valid": self.token_valid},
                         "processed_total": self.processed_total, "duplicates_ignored": self.duplicates_ignored,
                         "retries": self.retries, "last_processed_at": self.last_processed_at, "last_error": self.last_error},
            "mongo": {"order_views_total": self.archived_views + len(self.views), "order_views": views,
                      "customer_stats": sorted(self.customer_stats.values(), key=lambda c: c["lifetime_cents"], reverse=True)[:8]},
            "consistency": self.consistency(),
            "metrics": {**self.counts, "events_per_sec_1m": self.bus.rate(now)},
        }
        return deepcopy(state)
