import asyncio
from collections import deque
import math
import os
import platform
import random
import sqlite3
import statistics
import time

from app.errors import APIError
from app.sim.bus import short_id, timestamp

QUERY = "SELECT id, total_cents, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20"
DDL = "CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC)"


def stats(samples):
    ordered = sorted(samples)
    return {"p50": statistics.median(samples),
            "p95": ordered[math.ceil(len(samples) * .95) - 1] if len(samples) >= 20 else None,
            "mean": statistics.mean(samples), "min": min(samples), "max": max(samples)}


def run_benchmark(rows, repeats):
    started_at, started = timestamp(time.time()), time.perf_counter()
    rng = random.Random(42)
    customers = rows // 50
    batch = min(20000, rows // 5)

    def data(count):
        return [(rng.randrange(1, customers + 1), rng.choice(("placed", "paid", "shipped")),
                 rng.randrange(1_600_000_000, 1_800_000_000), rng.randrange(500, 150000)) for _ in range(count)]

    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, total_cents INTEGER NOT NULL)")
        insert = "INSERT INTO orders(customer_id,status,created_at,total_cents) VALUES (?,?,?,?)"
        db.executemany(insert, data(rows))
        db.commit()
        customer_sequence = [rng.randrange(1, customers + 1) for _ in range(repeats)]

        def measure_queries():
            plan = [r[3] for r in db.execute("EXPLAIN QUERY PLAN " + QUERY, (customer_sequence[0],))]
            samples = []
            for customer in customer_sequence:
                before = time.perf_counter()
                db.execute(QUERY, (customer,)).fetchall()
                samples.append((time.perf_counter() - before) * 1000)
            return {"plan": plan, "latency_ms": stats(samples), "samples_ms": samples}

        def bytes_used():
            return db.execute("PRAGMA page_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0]

        # Both query samples see exactly the same rows. Roll back the unindexed write
        # batch so data volume cannot bias the indexed query measurements.
        baseline = measure_queries()
        write_data = data(batch)
        before = time.perf_counter()
        db.executemany(insert, write_data)
        no_index_ms = (time.perf_counter() - before) * 1000
        db.rollback()
        # VACUUM removes any unused pages allocated by the rolled-back write batch.
        db.execute("VACUUM")
        bytes_before = bytes_used()
        before = time.perf_counter()
        db.execute(DDL)
        db.commit()
        build_ms = (time.perf_counter() - before) * 1000
        bytes_after = bytes_used()
        indexed = measure_queries()
        before = time.perf_counter()
        db.executemany(insert, write_data)
        with_index_ms = (time.perf_counter() - before) * 1000
        db.rollback()
        return {"run_id": short_id("run"), "started_at": started_at,
                "duration_ms": (time.perf_counter() - started) * 1000,
                "engine": "sqlite", "sqlite_version": sqlite3.sqlite_version,
                "python_version": platform.python_version(), "platform": platform.platform(),
                "cpu_count": os.cpu_count() or 1, "rows": rows, "repeats": repeats, "query": QUERY,
                "baseline": baseline, "indexed": indexed,
                "index": {"name": "idx_orders_customer_created", "ddl": DDL, "build_ms": build_ms,
                          "bytes_before": bytes_before, "bytes_after": bytes_after,
                          "overhead_bytes": bytes_after - bytes_before,
                          "overhead_pct": (bytes_after - bytes_before) / bytes_before * 100},
                "writes": {"batch_rows": batch, "no_index_ms": no_index_ms, "with_index_ms": with_index_ms,
                           "no_index_rows_per_sec": batch / (no_index_ms / 1000),
                           "with_index_rows_per_sec": batch / (with_index_ms / 1000),
                           "overhead_pct": (with_index_ms / no_index_ms - 1) * 100},
                "speedup_p50": baseline["latency_ms"]["p50"] / indexed["latency_ms"]["p50"],
                "notes": ["Real time.perf_counter measurements of in-memory SQLite, not PostgreSQL.",
                          "Single machine (possibly a laptop); no disk, network, replication, or production workload.",
                          f"Small sample: {repeats} queries per phase; p95 is null below 20 repeats.",
                          "Identical customer sequence and table contents before and after the index; cache and phase-order effects remain.",
                          "Write timings cover identical insert batches inside transactions, excluding commit and rollback.",
                          "Storage uses PRAGMA page_count * page_size; index bytes are captured before indexed writes."]}
    finally:
        db.close()


class Benchmark:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.runs = deque(maxlen=10)
        self.completed = 0
        self.worker = None

    async def run(self, rows, repeats):
        if self.lock.locked():
            raise APIError(409, "BENCH_BUSY", "An index benchmark is already running")
        async with self.lock:
            self.worker = asyncio.create_task(asyncio.to_thread(run_benchmark, rows, repeats))
            try:
                result = await asyncio.shield(self.worker)
            except asyncio.CancelledError:
                # Keep ownership of the busy lock until the thread actually finishes.
                await self.worker
                raise
            finally:
                self.worker = None
            self.runs.appendleft(result)
            self.completed += 1
            return result
