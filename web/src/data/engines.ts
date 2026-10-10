export type EngineKey = 'pg' | 'mg' | 'my' | 'ms' | 'ca' | 'hb'

export interface OrbitEngine {
  key: EngineKey
  name: string
  color: string
  ring: string
  core: boolean
  r: number
  tilt: [number, number, number]
  speed: number
  phase: number
}

/** Orbits for the hero scene: the two integrated engines share the inner orbit. */
export const ENGINE_ORBITS: OrbitEngine[] = [
  { key: 'pg', name: 'PostgreSQL', color: '#2f5fb3', ring: '#161512', core: true, r: 3.25, tilt: [0.42, 0, 0.18], speed: 0.17, phase: 0 },
  { key: 'mg', name: 'MongoDB', color: '#2e7d4f', ring: '#161512', core: true, r: 3.25, tilt: [0.42, 0, 0.18], speed: 0.17, phase: Math.PI },
  { key: 'my', name: 'MySQL', color: '#b5651d', ring: '#161512', core: false, r: 4.05, tilt: [-0.62, 0, -0.34], speed: 0.105, phase: 0.6 },
  { key: 'ms', name: 'SQL Server', color: '#b3263e', ring: '#161512', core: false, r: 4.05, tilt: [-0.62, 0, -0.34], speed: 0.105, phase: 0.6 + (2 * Math.PI) / 3 },
  { key: 'ca', name: 'Cassandra', color: '#6a4c9c', ring: '#161512', core: false, r: 4.05, tilt: [-0.62, 0, -0.34], speed: 0.105, phase: 0.6 + (4 * Math.PI) / 3 },
  { key: 'hb', name: 'HBase', color: '#0f7c80', ring: '#161512', core: false, r: 4.7, tilt: [1.15, 0.2, 0.62], speed: 0.075, phase: 2.2 },
]

export interface Engine {
  key: EngineKey
  name: string
  mono: string
  color: string
  role: 'core' | 'lab'
  roleLabel: string
  oneLiner: string
  model: string
  query: string
  txn: string
  consistency: string
  replication: string
  scale: string
  indexing: string
  backup: string
  ops: 1 | 2 | 3 | 4 | 5
  bestFor: string[]
  notFor: string[]
  inDataSphere: string
  verdict: string
}

export const ENGINES: Engine[] = [
  {
    key: 'pg',
    name: 'PostgreSQL',
    mono: 'PG',
    color: 'var(--pg)',
    role: 'core',
    roleLabel: 'Core · source of truth',
    oneLiner: 'The ledger. Every order, item, stock change, simulated payment and outbox row commits here — together or not at all.',
    model: 'Relational tables, rich types (JSONB, arrays, ranges)',
    query: 'SQL with CTEs, window functions, LATERAL, JSONB operators',
    txn: 'Full ACID with MVCC; Read Committed by default, Repeatable Read and Serializable available',
    consistency: 'Strong on the primary; replicas are eventually consistent (async) or zero-loss (synchronous commit)',
    replication: 'Physical streaming replication (async / sync), plus logical replication for selective tables',
    scale: 'Vertical first, read replicas, declarative partitioning; sharding via extensions such as Citus',
    indexing: 'B-tree, Hash, GIN, GiST, SP-GiST, BRIN; partial, expression and covering (INCLUDE) indexes',
    backup: 'pg_dump / pg_restore (logical); pg_basebackup + WAL archiving for point-in-time recovery',
    ops: 3,
    bestFor: ['Transactional business records', 'Constraints that must never be violated', 'Ad-hoc reporting joins'],
    notFor: ['Unbounded append-only firehoses across regions', 'Schemaless attribute bags at huge scale'],
    inDataSphere:
      'customers, products (core), inventory, orders, order_items, inventory_movements, payments_sim, outbox, audit_log — with CHECK (on_hand >= 0), FKs and an idempotency_keys table.',
    verdict: 'Chosen as the system of record: constraints + transactions are the product.',
  },
  {
    key: 'mg',
    name: 'MongoDB',
    mono: 'MG',
    color: 'var(--mg)',
    role: 'core',
    roleLabel: 'Core · read models & catalog',
    oneLiner: 'The projection. Denormalised order views and flexible product metadata, rebuilt from events — never the authority.',
    model: 'BSON documents in collections; embedded arrays and sub-documents',
    query: 'MQL + aggregation pipeline; $lookup for occasional joins',
    txn: 'Single-document writes are atomic; multi-document transactions on replica sets and sharded clusters',
    consistency: 'Tunable via write concern (w: "majority") and read concern (majority, linearizable)',
    replication: 'Replica sets with automatic primary election; change streams require a replica set',
    scale: 'Horizontal sharding by shard key; zones for data locality',
    indexing: 'Single, compound, multikey, text, geospatial, wildcard, partial and TTL indexes',
    backup: 'mongodump / mongorestore (logical, --oplog for a consistent point), filesystem snapshots',
    ops: 3,
    bestFor: ['Read models shaped like the screen', 'Variable product attributes', 'Event-driven projections'],
    notFor: ['The financial ledger of record', 'Workloads leaning on many cross-collection joins'],
    inDataSphere:
      'product_catalog (variant attributes), order_views and customer_stats projections fed by an idempotent change consumer that persists its resume token.',
    verdict: 'Chosen for projections: shape-per-screen reads, and losing it is recoverable from PostgreSQL.',
  },
  {
    key: 'my',
    name: 'MySQL',
    mono: 'MY',
    color: 'var(--my)',
    role: 'lab',
    roleLabel: 'Lab · comparison',
    oneLiner: 'Same retail schema, different engine: a side-by-side lab for InnoDB clustering, indexes and replication semantics.',
    model: 'Relational tables (InnoDB clusters rows by primary key)',
    query: 'SQL; CTEs and window functions since 8.0',
    txn: 'ACID with InnoDB MVCC; Repeatable Read by default',
    consistency: 'Strong on the source; replicas async, semi-sync or Group Replication',
    replication: 'Binary-log replication with GTIDs; Group Replication / InnoDB Cluster for HA',
    scale: 'Read replicas; sharding via Vitess or application routing',
    indexing: 'Clustered PK + secondary B-tree indexes (which carry the PK), full-text, spatial, functional',
    backup: 'mysqldump / MySQL Shell dump utilities (logical), Percona XtraBackup (physical), binlog PITR',
    ops: 2,
    bestFor: ['High-volume OLTP with simple access paths', 'Teams with existing MySQL estates'],
    notFor: ['Heavy JSON/array indexing needs', 'Feature parity with PostgreSQL extensions'],
    inDataSphere: 'mysql-lab: identical orders schema, EXPLAIN FORMAT=TREE exercises, PK-design experiments, a repeatable benchmark against the PostgreSQL baseline.',
    verdict: 'Rejected for core only to keep one SQL dialect — not for lack of capability.',
  },
  {
    key: 'ms',
    name: 'SQL Server',
    mono: 'MS',
    color: 'var(--ms)',
    role: 'lab',
    roleLabel: 'Lab · compatibility',
    oneLiner: 'An enterprise-estate compatibility lab: port the schema to T-SQL and compare isolation, indexing and HA vocabulary.',
    model: 'Relational tables; rowstore and columnstore',
    query: 'T-SQL with procedural extensions; Query Store for plan history',
    txn: 'ACID; Read Committed (locking) by default, optional RCSI / Snapshot isolation',
    consistency: 'Strong on the primary; AG secondaries sync- or async-commit',
    replication: 'Always On Availability Groups, Failover Cluster Instances, log shipping',
    scale: 'Mostly vertical; readable secondaries for read scale-out',
    indexing: 'Clustered / nonclustered, filtered, included columns, columnstore',
    backup: 'Full, differential and transaction-log backups; PITR under the full recovery model',
    ops: 3,
    bestFor: ['Microsoft-centric enterprises', 'Mixed OLTP + analytics with columnstore'],
    notFor: ['Zero-licence-cost production', 'ARM laptops without x64 emulation'],
    inDataSphere:
      'sqlserver-lab: schema port, T-SQL queries, connection config via the Linux container image (Developer edition, non-production licence); documents platform and licensing constraints.',
    verdict: 'Rejected for core: licensing and footprint; kept as a skills-transfer lab.',
  },
  {
    key: 'ca',
    name: 'Cassandra',
    mono: 'CA',
    color: 'var(--ca)',
    role: 'lab',
    roleLabel: 'Lab · event history',
    oneLiner: 'Query-first, masterless, always writable: the lab stores order-event history partitioned by store and day.',
    model: 'Partitioned wide rows: partition key + clustering columns',
    query: 'CQL — no joins; design one table per query',
    txn: 'No multi-partition ACID; lightweight transactions (Paxos) for per-partition compare-and-set',
    consistency: 'Tunable per request: ONE, QUORUM, LOCAL_QUORUM, ALL (R + W > RF for read-your-writes)',
    replication: 'Masterless ring, replication factor per keyspace (NetworkTopologyStrategy)',
    scale: 'Linear horizontal scale by adding nodes; vnodes distribute token ranges',
    indexing: 'Primary key access first; storage-attached indexes (SAI) in 5.0 for limited secondary access',
    backup: 'nodetool snapshot + incremental backups; regular anti-entropy repair is mandatory',
    ops: 4,
    bestFor: ['Append-heavy time series', 'Multi-region always-on writes', 'Known, fixed query patterns'],
    notFor: ['Inventory decrements needing cross-row atomicity', 'Ad-hoc analytical queries'],
    inDataSphere:
      'cassandra-lab: order_events_by_store_day ((store_id, day), ts DESC) with RF=3, consistency-level experiments and a stopped-node read/write drill.',
    verdict: 'Rejected for orders: no multi-row transactions. Strong candidate for event history at scale.',
  },
  {
    key: 'hb',
    name: 'HBase',
    mono: 'HB',
    color: 'var(--hb)',
    role: 'lab',
    roleLabel: 'Lab · wide-column on HDFS',
    oneLiner: 'Bigtable-style sorted rows on HDFS: a row-key design lab for sparse, massive, scan-heavy history.',
    model: 'Sorted map: row key → column families → qualifiers → timestamped cells',
    query: 'Get / Put / Scan by row-key range; SQL via Apache Phoenix',
    txn: 'Atomic per row; no multi-row transactions natively',
    consistency: 'Strong per row — each region is served by exactly one RegionServer',
    replication: 'HDFS block replication for durability; asynchronous cluster-to-cluster replication',
    scale: 'Regions split automatically as they grow and are balanced across RegionServers',
    indexing: 'Row key only; secondary indexes via Phoenix or hand-built index tables',
    backup: 'Snapshots, ExportSnapshot to another cluster, replication',
    ops: 5,
    bestFor: ['Petabyte-scale sparse tables', 'Hadoop-ecosystem pipelines (Spark, MapReduce)'],
    notFor: ['A laptop-sized dataset', 'Teams without HDFS / ZooKeeper operations experience'],
    inDataSphere:
      'hbase-lab: salted + reversed-timestamp row keys to avoid region hot-spotting, column-family layout, pre-split regions; runs in standalone mode for learning, with the cluster prerequisites documented.',
    verdict: 'Rejected for core: operational weight far beyond the data volume. Optional lab.',
  },
]

export const MATRIX_ROWS: { key: keyof Engine; label: string }[] = [
  { key: 'model', label: 'Data model' },
  { key: 'query', label: 'Query model' },
  { key: 'txn', label: 'Transactions' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'replication', label: 'Replication' },
  { key: 'scale', label: 'Scale-out' },
  { key: 'indexing', label: 'Indexing' },
  { key: 'backup', label: 'Backup & recovery' },
]

export interface Workload {
  id: string
  label: string
  detail: string
  pick: EngineKey
  runnerUp: EngineKey
  avoid: EngineKey
  why: string
  whyNot: string
}

export const WORKLOADS: Workload[] = [
  {
    id: 'checkout',
    label: 'Checkout: decrement stock, create order, record payment',
    detail: 'Must never oversell; must be all-or-nothing.',
    pick: 'pg',
    runnerUp: 'my',
    avoid: 'ca',
    why: 'One ACID transaction with SELECT … FOR UPDATE and a CHECK (on_hand >= 0) makes overselling impossible, and the outbox row commits in the same transaction.',
    whyNot: 'Cassandra cannot atomically update an inventory row and an order row in different partitions.',
  },
  {
    id: 'catalog',
    label: 'Product catalog with per-category attributes',
    detail: 'Lamps have lumens, chairs have seat heights, earbuds have codecs.',
    pick: 'mg',
    runnerUp: 'pg',
    avoid: 'hb',
    why: 'Documents hold variable attributes naturally, with JSON-schema validation and indexes on the fields that are actually queried.',
    whyNot: 'HBase would work at petabyte scale, but its operational cost dwarfs a catalog of this size.',
  },
  {
    id: 'events',
    label: 'Order-event history, 50k writes/s across regions',
    detail: 'Append-only; read back as "latest events for a store on a day".',
    pick: 'ca',
    runnerUp: 'hb',
    avoid: 'ms',
    why: 'Partition by (store_id, day), cluster by ts DESC: every read is a single-partition slice; writes stay available with LOCAL_QUORUM per region.',
    whyNot: 'A single-primary relational engine would need sharding work to absorb this write rate across regions.',
  },
  {
    id: 'views',
    label: 'Order-detail screen: one round-trip, no joins',
    detail: 'Customer + items + totals rendered from one read.',
    pick: 'mg',
    runnerUp: 'pg',
    avoid: 'ca',
    why: 'A projection document shaped like the screen, rebuilt idempotently from outbox events; losing it is recoverable from PostgreSQL.',
    whyNot: 'Cassandra would need a table per query and offers nothing a read model needs here.',
  },
  {
    id: 'clickstream',
    label: 'Years of sparse clickstream next to a Hadoop / Spark stack',
    detail: 'Huge, sparse, scanned by row-key ranges in batch jobs.',
    pick: 'hb',
    runnerUp: 'ca',
    avoid: 'my',
    why: 'Sorted row keys over HDFS give efficient range scans for Spark jobs; column families keep sparse data cheap.',
    whyNot: 'A single MySQL primary would hit storage and write-amplification limits long before this data size.',
  },
  {
    id: 'msestate',
    label: 'Finance reporting inside a Microsoft-centric enterprise',
    detail: 'Existing AD, SSIS, Power BI and DBA skills.',
    pick: 'ms',
    runnerUp: 'pg',
    avoid: 'hb',
    why: 'Columnstore indexes, Query Store and Always On fit the existing estate and staff skills.',
    whyNot: 'A Hadoop stack adds a whole platform for a reporting problem.',
  },
]

export const ENGINE_BY_KEY = Object.fromEntries(ENGINES.map((e) => [e.key, e])) as Record<EngineKey, Engine>
