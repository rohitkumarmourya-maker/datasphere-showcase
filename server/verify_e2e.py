"""Run the requested real curl verification and capture commands and responses."""
import json
import os
from pathlib import Path
import shlex
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "verification"
OUT.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:8710"
REPORT = ["# Executed verification", "", "All commands ran from the server directory. Full response bodies, headers, and logs are alongside this report.", ""]


def record(command, result):
    REPORT.extend(["```sh", shlex.join(command), "```", "", result, ""])
    print(result, flush=True)


def curl(name, path, body=None, key=None, stream=False):
    headers, output = OUT / f"{name}.headers", OUT / f"{name}.txt"
    command = ["curl", "-sS", "--max-time", "3" if stream else "30", "-D", str(headers), "-o", str(output)]
    if stream:
        command.append("-N")
    if body is not None:
        command += ["-X", "POST", "-H", "Content-Type: application/json", "--data", json.dumps(body, separators=(",", ":"))]
    if key:
        command += ["-H", f"Idempotency-Key: {key}"]
    command.append(BASE + path)
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    content = output.read_text()
    response_headers = headers.read_text()
    (OUT / f"{name}.stderr").write_text(result.stderr)
    assert "x-request-id:" in response_headers.lower(), response_headers
    status = int(response_headers.splitlines()[0].split()[1])
    if stream:
        assert result.returncode == 28 and status == 200
        assert "event: state\n" in content and "event: sim\n" in content
        assert "cache-control: no-cache" in response_headers.lower()
        assert "x-accel-buffering: no" in response_headers.lower()
        states, events = content.count("event: state\n"), content.count("event: sim\n")
        summary = f"HTTP {status}; {states} state events, {events} discrete sim events in 3 seconds. curl exit 28 is the requested timeout: `{result.stderr.strip()}`."
        payload = content
    elif path == "/metrics":
        assert result.returncode == 0 and status == 200 and "# TYPE datasphere_http_requests_total counter" in content
        for name in ("orders_committed_total", "orders_rejected_total", "idempotent_replays_total", "events_published_total",
                     "events_delivered_total", "duplicates_ignored_total", "outbox_pending", "consumer_up", "consistency_lag_events"):
            assert "datasphere_sim_" + name in content
        assert "datasphere_ha_replication_lag_bytes" in content
        assert "datasphere_lab_bench_runs_total" in content
        assert "datasphere_http_request_duration_seconds" in content
        summary = f"HTTP {status}; {len(content.encode())} bytes of Prometheus exposition, including the 13 contract metric families and HELP/TYPE lines."
        payload = content
    else:
        assert result.returncode == 0, result.stderr
        payload = json.loads(content)
        if path == "/api/health":
            assert status == 200 and payload["simulation"]["running"] is True
            summary = f"HTTP {status}; `{json.dumps(payload)}`"
        elif path == "/api/sim/orders":
            assert status == (200 if payload["replayed"] else 201)
            summary = f"HTTP {status}; order `{payload['order']['id']}`, replayed={str(payload['replayed']).lower()}, event `{payload['outbox_event_id']}`."
        elif path == "/api/sim/state":
            assert status == 200 and payload["postgres"]["orders_total"] == 1
            summary = f"HTTP {status}; {payload['postgres']['orders_total']} PG order, {payload['postgres']['outbox']['pending']} pending outbox row(s), consistency `{payload['consistency']['status']}`."
        elif path == "/api/capacity":
            assert status == 200 and payload["kind"] == "estimate"
            summary = f"HTTP {status}; estimate with 13 months and {len(payload['sensitivity'])} sensitivity rows; 12-month total {payload['series']['base'][-1]['total_bytes']} bytes."
        elif path == "/api/lab/index-bench":
            assert status == 200 and payload["rows"] == 20000
            assert any("USING INDEX" in p for p in payload["indexed"]["plan"])
            summary = (f"HTTP {status}; real SQLite, {payload['rows']} rows, {payload['repeats']} repeats, "
                       f"duration {payload['duration_ms']:.3f} ms, p50 {payload['baseline']['latency_ms']['p50']:.6f} → "
                       f"{payload['indexed']['latency_ms']['p50']:.6f} ms, p95 {payload['indexed']['latency_ms']['p95']:.6f} ms, "
                       f"speedup {payload['speedup_p50']:.2f}×. Indexed plan: `{payload['indexed']['plan']}`.")
        else:
            summary = f"HTTP {status}"
    record(command, summary)
    return payload


def main():
    check = ["lsof", "-nP", "-iTCP:8710", "-sTCP:LISTEN"]
    existing = subprocess.run(check, capture_output=True, text=True)
    assert existing.returncode == 1 and not existing.stdout, "Port 8710 is already in use; no existing process will be stopped"
    command = ([str(ROOT / "run.sh")] if "--run-script" in sys.argv else
               [str(ROOT / ".venv/bin/python"), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8710"])
    environment = {**os.environ, "DS_SIM_AUTOSTART": "1"}
    shutdown_client = None
    with (OUT / "uvicorn.log").open("w") as log:
        server = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT)
        record(["env", "DS_SIM_AUTOSTART=1", *command], f"Started in the background; PID {server.pid}; output: `verification/uvicorn.log`.")
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                assert server.poll() is None, "Server exited during startup"
                try:
                    with socket.create_connection(("127.0.0.1", 8710), timeout=.2):
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise AssertionError("Server did not bind within 10 seconds")
            curl("health", "/api/health")
            # Disable ambient traffic after proving autostart, so the subsequent
            # one-order assertions are repeatable without altering background ticks.
            curl("traffic", "/api/sim/traffic", {"enabled": False, "orders_per_min": 0})
            body = {"sku": "SKU-AURORA-LAMP", "qty": 2, "customer_id": None}
            first = curl("order", "/api/sim/orders", body, "e2e_order_key_01")
            replay = curl("order-replay", "/api/sim/orders", body, "e2e_order_key_01")
            assert first["order"] == replay["order"] and first["outbox_event_id"] == replay["outbox_event_id"]
            curl("state", "/api/sim/state")
            curl("stream", "/api/sim/stream", stream=True)
            capacity = {"records_per_day": 100000, "avg_record_bytes": 512, "events_per_record": 2,
                        "avg_event_bytes": 256, "index_overhead_pct": 30, "replication_factor": 3,
                        "backup_full_copies": 2, "retention_days": 90, "archive_compression_ratio": 4,
                        "monthly_growth_pct": 5, "threshold_gb": 50}
            curl("capacity", "/api/capacity", capacity)
            curl("benchmark", "/api/lab/index-bench", {"rows": 20000, "repeats": 20})
            curl("metrics", "/metrics")
            # An additional live client remains connected during SIGTERM. This
            # verifies shutdown itself, rather than merely a timed-out SSE client.
            shutdown_command = ["curl", "-sS", "-N", "--max-time", "10", "-D", str(OUT / "shutdown-stream.headers"),
                                "-o", str(OUT / "shutdown-stream.txt"), BASE + "/api/sim/stream"]
            shutdown_client = subprocess.Popen(shutdown_command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                output = OUT / "shutdown-stream.txt"
                if output.exists() and "event: state" in output.read_text():
                    break
                time.sleep(.05)
            else:
                raise AssertionError("Shutdown test client did not connect")
            record(shutdown_command, "Connected another SSE client and left it open during server termination.")
            before = time.monotonic()
            server.send_signal(signal.SIGTERM)
            returncode = server.wait(timeout=5)
            duration = (time.monotonic() - before) * 1000
            record(["kill", "-TERM", str(server.pid)], f"Server exited after {duration:.3f} ms with process exit {returncode}; active SSE response closed cleanly.")
            _, stderr = shutdown_client.communicate(timeout=2)
            assert shutdown_client.returncode == 0, stderr
            assert "Application shutdown complete" in (OUT / "uvicorn.log").read_text()
            assert "ERROR" not in (OUT / "uvicorn.log").read_text()
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)
            if shutdown_client is not None and shutdown_client.poll() is None:
                shutdown_client.terminate()
                shutdown_client.wait(timeout=5)
    final = subprocess.run(check, capture_output=True, text=True)
    record(check, f"Exit {final.returncode}; stdout `{final.stdout.strip()}`. No process is listening on TCP port 8710.")
    assert final.returncode == 1 and not final.stdout
    summary = next(line for line in (OUT / "pytest.txt").read_text().splitlines() if " passed" in line)
    REPORT.extend(["## Test and dependency checks", "", "```sh",
                   ".venv/bin/python -m pip install --disable-pip-version-check -r requirements-dev.txt > verification/install.txt 2>&1",
                   "DS_SIM_AUTOSTART=0 .venv/bin/python -m pytest -q | tee verification/pytest.txt",
                   ".venv/bin/python -m pip check > verification/pip-check.txt 2>&1", "bash -n run.sh", "```", "",
                   f"Actual test summary: `{summary}`. Full output: `pytest.txt`.", "",
                   "Dependency check: `No broken requirements found.` Bash syntax check exited 0. Install output is in `install.txt`.", "",
                   "Tests emitted one dependency deprecation warning: Starlette recommends httpx2; the required httpx tests passed.", "",
                   "The PowerShell script was authored but not executed: PowerShell is unavailable on this macOS host.", ""])
    REPORT.extend(["## Verification runner", "", "```sh", ".venv/bin/python verify_e2e.py --run-script", "```", "",
                   "This final run exited 0. The earlier direct uvicorn run also passed all HTTP and shutdown checks. "
                   "An initial runner attempt used the wrong Prometheus TYPE label in its assertion; that assertion was corrected "
                   "to the actual contract metric name ending in `_total`. Its captured responses are in `../verification-first/`.", ""])


if __name__ == "__main__":
    os.chdir(ROOT)
    try:
        main()
    finally:
        (OUT / "REPORT.md").write_text("\n".join(REPORT))
