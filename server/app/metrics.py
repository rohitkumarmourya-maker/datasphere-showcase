import re
import time
import uuid

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from prometheus_client.core import CounterMetricFamily
from starlette.requests import Request

from app.errors import unexpected_error_handler


class Metrics:
    def __init__(self):
        self.registry = CollectorRegistry()
        self.gauges = {}
        self.counter_values = dict.fromkeys(("orders_committed", "orders_rejected", "idempotent_replays", "events_published",
                                           "events_delivered", "duplicates_ignored"), 0)
        self.completed_benchmarks = 0
        self.registry.register(self)
        for field in ("outbox_pending", "consumer_up", "consistency_lag_events"):
            self.gauges[field] = Gauge("datasphere_sim_" + field, field.replace("_", " "), registry=self.registry)
        self.ha_lag = Gauge("datasphere_ha_replication_lag_bytes", "Simulated standby replay lag bytes", registry=self.registry)
        self.requests = Counter("datasphere_http_requests_total", "HTTP requests", ("method", "route", "status"), registry=self.registry)
        self.duration = Histogram("datasphere_http_request_duration_seconds", "Time to response headers in seconds",
                                  ("method", "route"), registry=self.registry)

    def render(self, commerce, ha, bench):
        for field in self.counter_values:
            self.counter_values[field] = commerce.counts[field]
        self.gauges["outbox_pending"].set(sum(r["status"] == "pending" for r in commerce.outbox.values()))
        self.gauges["consumer_up"].set(int(commerce.status == "running"))
        self.gauges["consistency_lag_events"].set(commerce.consistency()["lag_events"])
        self.ha_lag.set(ha.state()["lag_bytes"])
        self.completed_benchmarks = bench.completed
        return generate_latest(self.registry)

    def collect(self):
        for field, value in self.counter_values.items():
            yield CounterMetricFamily("datasphere_sim_" + field, "Simulation counter since last reset", value=value)
        yield CounterMetricFamily("datasphere_lab_bench_runs", "Completed real SQLite benchmarks", value=self.completed_benchmarks)


class RequestMiddleware:
    """Pure ASGI middleware: no task wrapping around long-lived SSE responses."""

    def __init__(self, app, metrics):
        self.app, self.metrics = app, metrics

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        supplied = next((v.decode("latin1") for k, v in scope["headers"] if k.lower() == b"x-request-id"), "")
        rid = supplied if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", supplied) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = rid
        started, sent, cors_error = time.perf_counter(), False, False

        async def wrapped(message):
            nonlocal sent, cors_error
            if message["type"] == "http.response.start":
                sent = True
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                message["headers"].append((b"x-request-id", rid.encode("ascii")))
                route = scope.get("route")
                template = getattr(route, "path", "unmatched")
                method = scope["method"] if scope["method"] in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} else "OTHER"
                self.metrics.requests.labels(method, template, str(message["status"])).inc()
                self.metrics.duration.labels(method, template).observe(time.perf_counter() - started)
                # CORSMiddleware produces a plain-text 400 for rejected preflights.
                # Convert it here to the same JSON envelope as every other error.
                if message["status"] == 400 and scope["method"] == "OPTIONS":
                    cors_error = True
                    message["headers"] = [(k, v) for k, v in message["headers"] if k.lower() not in {b"content-type", b"content-length"}]
                    message["headers"].append((b"content-type", b"application/json"))
            elif message["type"] == "http.response.body" and scope["method"] == "OPTIONS":
                # The flag is set from response status rather than request origin.
                if cors_error:
                    import json
                    message["body"] = json.dumps({"error": {"code": "BAD_REQUEST", "message": "CORS preflight rejected",
                                                            "request_id": rid, "details": None}}).encode()
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        except Exception:
            if sent:
                raise
            response = await unexpected_error_handler(Request(scope), None)
            await response(scope, receive, wrapped)
