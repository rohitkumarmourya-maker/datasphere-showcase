import asyncio
from threading import Event

import pytest
from app.capacity import estimate_capacity
from app.errors import APIError
from app.lab.bench import Benchmark

SAMPLE = {"records_per_day": 100000, "avg_record_bytes": 512, "events_per_record": 2,
          "avg_event_bytes": 256, "index_overhead_pct": 30, "replication_factor": 3,
          "backup_full_copies": 2, "retention_days": 90, "archive_compression_ratio": 4,
          "monthly_growth_pct": 5, "threshold_gb": 50}


def test_real_benchmark_plans_timings_and_runs(client):
    response = client.post("/api/lab/index-bench", json={"rows": 5000, "repeats": 20})
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["engine"] == "sqlite" and run["rows"] == 5000 and run["repeats"] == 20
    assert any("SCAN orders" in p for p in run["baseline"]["plan"])
    assert any("USING INDEX idx_orders_customer_created" in p for p in run["indexed"]["plan"])
    for phase in ("baseline", "indexed"):
        assert len(run[phase]["samples_ms"]) == 20 and all(t > 0 for t in run[phase]["samples_ms"])
        stats = run[phase]["latency_ms"]
        assert stats["p95"] is not None and stats["min"] <= stats["p50"] <= stats["p95"] <= stats["max"]
    assert run["duration_ms"] > 0 and run["index"]["build_ms"] > 0
    assert run["index"]["bytes_after"] > run["index"]["bytes_before"]
    assert run["index"]["overhead_bytes"] == run["index"]["bytes_after"] - run["index"]["bytes_before"]
    assert run["writes"]["batch_rows"] == 1000 and run["writes"]["no_index_ms"] > 0
    assert run["writes"]["with_index_ms"] > 0 and run["speedup_p50"] > 0
    notes = " ".join(run["notes"])
    assert "not PostgreSQL" in notes and "Single machine" in notes and "sample" in notes
    assert client.get("/api/lab/runs").json()["runs"][0] == run


def test_benchmark_small_sample_p95_null(client):
    run = client.post("/api/lab/index-bench", json={"rows": 5000, "repeats": 5}).json()
    assert run["baseline"]["latency_ms"]["p95"] is None
    assert run["indexed"]["latency_ms"]["p95"] is None


def test_benchmark_busy_and_thread_offload(monkeypatch):
    entered, released = Event(), Event()
    def worker(rows, repeats):
        entered.set()
        assert released.wait(5)
        return {"rows": rows, "repeats": repeats}
    monkeypatch.setattr("app.lab.bench.run_benchmark", worker)
    async def exercise():
        bench = Benchmark()
        first = asyncio.create_task(bench.run(5000, 20))
        assert await asyncio.to_thread(entered.wait, 5)
        try:
            with pytest.raises(APIError) as error:
                await bench.run(5000, 20)
            assert error.value.status == 409 and error.value.code == "BENCH_BUSY"
        finally:
            released.set()
        assert (await first)["rows"] == 5000
        assert bench.completed == 1 and not bench.lock.locked()
    asyncio.run(exercise())


def test_capacity_monotonic_rf_scaling_and_integer_bytes(client):
    response = client.post("/api/capacity", json=SAMPLE)
    assert response.status_code == 200
    result = response.json()
    assert result["kind"] == "estimate" and result["assumptions"]
    base = result["series"]["base"]
    assert [r["month"] for r in base] == list(range(13))
    assert all(a["total_bytes"] <= b["total_bytes"] for a, b in zip(base, base[1:]))
    for row in base + result["horizons"]:
        assert all(type(v) is int for k, v in row.items() if k.endswith("_bytes"))
        assert row["total_bytes"] == sum(row[k] for k in ("hot_bytes", "replica_bytes", "backup_bytes", "archive_bytes"))
        assert row["replica_bytes"] == 2 * row["hot_bytes"]
        assert row["backup_bytes"] == 2 * row["hot_bytes"]
    rf1 = estimate_capacity({**SAMPLE, "replication_factor": 1})["series"]["base"]
    assert all(b["total_bytes"] - a["total_bytes"] == 2 * b["hot_bytes"] for a, b in zip(rf1, base))
    assert {r["parameter"] for r in result["sensitivity"]} >= {
        "records_per_day", "avg_record_bytes", "events_per_record", "index_overhead_pct",
        "replication_factor", "retention_days", "monthly_growth_pct"}
    assert result["scenarios"]["low"]["monthly_growth_pct"] == 2.5
    assert result["scenarios"]["high"]["monthly_growth_pct"] == 7.5
    assert result["threshold"]["crossed_at_month"] is not None


def test_capacity_exact_constant_daily_model_and_archive():
    p = {**SAMPLE, "records_per_day": 10, "avg_record_bytes": 100, "events_per_record": 2,
         "avg_event_bytes": 50, "index_overhead_pct": 50, "retention_days": 1,
         "monthly_growth_pct": 0, "replication_factor": 2, "backup_full_copies": 1,
         "archive_compression_ratio": 2}
    result = estimate_capacity(p)
    assert result["daily"] == {"record_bytes": 1000, "event_bytes": 1000, "index_bytes": 1000,
                               "primary_bytes": 3000, "replicated_bytes": 6000}
    last = result["series"]["base"][-1]
    assert last["hot_bytes"] == 3000 and last["archive_bytes"] == 364000
    assert last["total_bytes"] == 373000
    assert result["scenarios"]["low"]["monthly_growth_pct"] == -5
    assert result["scenarios"]["high"]["monthly_growth_pct"] == 5
    zero = estimate_capacity({**p, "records_per_day": 0})
    assert all(r["total_bytes"] == 0 for r in zero["series"]["base"])
    assert zero["threshold"]["crossed_at_month"] is None


@pytest.mark.parametrize("path,body", [("/api/lab/index-bench", {"rows": 4999}),
                                      ("/api/lab/index-bench", {"repeats": 61}),
                                      ("/api/capacity", {**SAMPLE, "retention_days": 0}),
                                      ("/api/capacity", {**SAMPLE, "threshold_gb": 0}),
                                      ("/api/capacity", {**SAMPLE, "replication_factor": 8}),
                                      ("/api/capacity", {**SAMPLE, "events_per_record": True}),
                                      ("/api/capacity", {**SAMPLE, "monthly_growth_pct": "5"})])
def test_ranges(client, path, body):
    response = client.post(path, json=body)
    assert response.status_code == 422 and response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_capacity_fractional_average_daily_rounding():
    result = estimate_capacity({**SAMPLE, "records_per_day": 1, "avg_record_bytes": 16,
                                "events_per_record": .01, "avg_event_bytes": 16, "index_overhead_pct": 300})
    daily = result["daily"]
    assert daily["primary_bytes"] == result["horizons"][0]["hot_bytes"] == 65
    assert daily["primary_bytes"] == daily["record_bytes"] + daily["event_bytes"] + daily["index_bytes"]
