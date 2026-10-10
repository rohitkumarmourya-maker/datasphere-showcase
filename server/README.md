# DataSphere Showcase server

Python 3.11–3.13 backend matching `../CONTRACT.md`. Commerce and PostgreSQL HA are
**in-memory simulations**; no PostgreSQL or MongoDB services are contacted. The
index benchmark runs **real measurements on in-memory SQLite** in a worker thread.
Capacity results are estimates with their assumptions included in the response.

From the repository root, run `./start.sh` on macOS/Linux or double-click
`start.bat` on Windows. These launchers work from any working directory.
From `server/`, `./run.sh` and `./run.ps1` also work. Python selection checks
`DS_PYTHON` first, then 3.12, 3.13, 3.11, and finally `python3` (Unix) or
`python` (Windows); Windows uses `py` for the versioned candidates. Python must
be 3.11–3.13. Python 3.12 is recommended; 3.11/3.13 have not been tested.
Scripts create `.venv` when absent, install the pinned runtime requirements, and
bind to **127.0.0.1:8710**. `DS_PYTHON` selects Python when creating a venv.
The scripts print the site URL before starting. On first launch, installing
requirements needs internet access. Include `web/dist/` in the zip; Node.js is
not needed to serve the built site.

FastAPI serves `web/dist/` relative to the app package, or `DS_WEB_DIST` when set,
only when `index.html` exists. `/` and SPA routes return that index with
`Cache-Control: no-cache`; real files keep their content types, and hashed
`/assets/` files are cached for one year with `immutable`. `/api` and `/metrics`
remain reserved, traversal is rejected, and missing bundles keep the API-only
404 behavior with an info log. Static metrics use `/{path:path}` as the route
label. `DS_PORT` can change the printed URL and listening port.

Alternatively, from this directory:

```sh
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8710
```

`DS_SIM_AUTOSTART=0` disables background ticks for deterministic tests.
`DS_HOST` must be `127.0.0.1`; `DS_PORT` defaults to `8710`. Only the two Vite
origins on port 5180 are allowed by CORS. Every response has `X-Request-ID`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Process health and simulation running flag |
| GET | `/api/sim/state` | Commerce state |
| POST | `/api/sim/orders` | Atomic order; optional Idempotency-Key header |
| POST | `/api/sim/chaos` | Delivery faults, consumer recovery, reconciliation, burst, reset |
| POST | `/api/sim/traffic` | Ambient traffic control |
| GET | `/api/sim/stream` | Initial/periodic state and discrete commerce/HA SSE events |
| GET | `/api/ha/state` | Simulated WAL, roles, timelines, lag, RPO/RTO |
| POST | `/api/ha/action` | Kill, promote, fenced rewind/rejoin, mode, burst, reset |
| POST | `/api/lab/index-bench` | One real SQLite benchmark at a time |
| GET | `/api/lab/runs` | Latest 10 benchmark results |
| POST | `/api/capacity` | Daily storage model, scenarios and sensitivity |
| GET | `/metrics` | Prometheus exposition with bounded route labels |

Test from this directory:

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
DS_SIM_AUTOSTART=0 .venv/bin/python -m pytest -q
```

Tests drive injectable clocks and explicit commerce/HA ticks. The SSE bus gives
each client a bounded queue of 128 events, dropping the oldest when slow. Uvicorn
termination signals close the streams before lifespan teardown, including reload.

Commerce retains at most 4096 transaction snapshots, outbox rows, views, and
idempotency records. Only fully settled, consistent orders are retired; cumulative
counts and the eight customer aggregates remain. Idempotency replay is available
within this retained simulation window. Unresolved history is never silently
discarded: a full window rejects new orders with `BACKPRESSURE`. Relay publication
pauses when its delivery queue is full. Processed IDs above the contiguous watermark
are retained; entries below it are represented by the watermark itself. HA WAL
queues and event history, recent event-rate samples, and benchmark history are bounded.
Reset restarts the simulation counters, including their Prometheus counter values.

Benchmark caveats: one machine, in-memory SQLite rather than PostgreSQL, no disk
or network; p95 requires at least 20 samples. Plans are actual EXPLAIN QUERY PLAN
details. Index storage uses page count times page size. Query phases use identical
data and customers; insert phases use identical batches and exclude commit/rollback.
