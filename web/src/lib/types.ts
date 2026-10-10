// Mirrors CONTRACT.md. Keep in sync with server/app.

export type Tier = 'gold' | 'silver' | 'standard'

export interface Product {
  sku: string
  name: string
  category: string
  price_cents: number
  stock: number
}

export interface Customer {
  id: string
  name: string
  tier: Tier
}

export interface Order {
  id: string
  customer_id: string
  customer_name: string
  sku: string
  product_name: string
  qty: number
  unit_price_cents: number
  total_cents: number
  status: 'placed'
  idempotency_key: string
  created_at: string
  outbox_event_id: string
  position: number
}

export interface OutboxRow {
  event_id: string
  aggregate_id: string
  event_type: 'order.placed'
  position: number
  status: 'pending' | 'published'
  attempts: number
  created_at: string
  published_at: string | null
}

export type DeliveryKind = 'normal' | 'duplicate' | 'delayed' | 'redelivery'

export interface Delivery {
  delivery_id: string
  event_id: string
  order_id: string
  position: number
  attempt: number
  kind: DeliveryKind
  deliver_at: string
}

export interface OrderView {
  _id: string
  customer: Customer
  items: { sku: string; name: string; qty: number; unit_price_cents: number }[]
  total_cents: number
  status: string
  source_event_id: string
  projected_at: string
  projected_by: 'consumer' | 'reconciler'
  version: number
}

export interface CustomerStats {
  _id: string
  name: string
  orders: number
  lifetime_cents: number
  last_order_at: string | null
}

export type ConsistencyStatus = 'consistent' | 'converging' | 'diverged'
export type ConsumerStatus = 'running' | 'crashed' | 'resyncing'

export interface SimState {
  seq: number
  now: string
  traffic: { enabled: boolean; orders_per_min: number }
  products: Product[]
  customers: Customer[]
  postgres: {
    orders_total: number
    orders: Order[]
    outbox: { pending: number; published_total: number; rows: OutboxRow[] }
    inventory_movements_total: number
    idempotency_keys: number
  }
  broker: { in_flight: number; delayed: number; deliveries: Delivery[] }
  consumer: {
    status: ConsumerStatus
    resume_token: { position: number; valid: boolean } | null
    processed_total: number
    duplicates_ignored: number
    retries: number
    last_processed_at: string | null
    last_error: string | null
  }
  mongo: { order_views_total: number; order_views: OrderView[]; customer_stats: CustomerStats[] }
  consistency: {
    status: ConsistencyStatus
    pg_orders: number
    mongo_views: number
    missing_in_mongo: number
    stale_in_mongo: number
    lag_events: number
    last_reconciled_at: string | null
  }
  metrics: {
    orders_committed: number
    orders_rejected: number
    idempotent_replays: number
    events_published: number
    events_delivered: number
    duplicates_ignored: number
    consumer_crashes: number
    reconciliations: number
    events_per_sec_1m: number
  }
}

export type HARole = 'primary' | 'standby' | 'down' | 'fenced' | 'rewinding'

export interface HANode {
  id: 'pg-a' | 'pg-b'
  role: HARole
  timeline: number
  lsn: number
  replay_lsn: number
  healthy: boolean
}

export interface HAState {
  mode: 'async' | 'sync'
  nodes: HANode[]
  primary_id: string | null
  committed_txns: number
  lag_bytes: number
  lag_ms: number
  commit_latency_ms_p50: number
  writes_per_sec: number
  incident: { started_at: string; killed: string } | null
  last_failover: {
    at: string
    from: string
    to: string
    mode: 'async' | 'sync'
    rpo_lost_txns: number
    rpo_lost_bytes: number
    rto_ms: number
  } | null
  events: { ts: string; level: 'info' | 'warn' | 'error'; message: string }[]
}

export interface SimEvent {
  seq: number
  ts: string
  type: string
  data: Record<string, unknown>
}

export interface Stats {
  p50: number
  p95: number | null
  mean: number
  min: number
  max: number
}

export interface BenchRun {
  run_id: string
  started_at: string
  duration_ms: number
  engine: 'sqlite'
  sqlite_version: string
  python_version: string
  platform: string
  cpu_count: number
  rows: number
  repeats: number
  query: string
  baseline: { plan: string[]; latency_ms: Stats; samples_ms: number[] }
  indexed: { plan: string[]; latency_ms: Stats; samples_ms: number[] }
  index: {
    name: string
    ddl: string
    build_ms: number
    bytes_before: number
    bytes_after: number
    overhead_bytes: number
    overhead_pct: number
  }
  writes: {
    batch_rows: number
    no_index_ms: number
    with_index_ms: number
    no_index_rows_per_sec: number
    with_index_rows_per_sec: number
    overhead_pct: number
  }
  speedup_p50: number
  notes: string[]
}

export interface CapacityInput {
  records_per_day: number
  avg_record_bytes: number
  events_per_record: number
  avg_event_bytes: number
  index_overhead_pct: number
  replication_factor: number
  backup_full_copies: number
  retention_days: number
  archive_compression_ratio: number
  monthly_growth_pct: number
  threshold_gb: number
}

export interface CapacityPoint {
  month: number
  hot_bytes: number
  replica_bytes: number
  backup_bytes: number
  archive_bytes: number
  total_bytes: number
}

export interface CapacityResult {
  kind: 'estimate'
  assumptions: string[]
  daily: {
    record_bytes: number
    event_bytes: number
    index_bytes: number
    primary_bytes: number
    replicated_bytes: number
  }
  horizons: {
    label: string
    months: number
    hot_bytes: number
    replica_bytes: number
    backup_bytes: number
    archive_bytes: number
    total_bytes: number
  }[]
  series: {
    base: CapacityPoint[]
    low: { month: number; total_bytes: number }[]
    high: { month: number; total_bytes: number }[]
  }
  scenarios: {
    low: { monthly_growth_pct: number }
    base: { monthly_growth_pct: number }
    high: { monthly_growth_pct: number }
  }
  threshold: { gb: number; crossed_at_month: number | null }
  sensitivity: { parameter: string; change: string; total_12m_bytes: number; delta_pct: number }[]
}

export interface ApiErrorBody {
  error: { code: string; message: string; request_id: string; details: unknown }
}
