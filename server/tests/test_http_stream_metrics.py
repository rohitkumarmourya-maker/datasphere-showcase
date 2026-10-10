import asyncio
import json
import re

from app.routes.stream import stream_events
from app.sim.bus import EventBus


def test_health_and_request_id_all_responses(client):
    health = client.get("/api/health", headers={"X-Request-ID": "my_request-123"})
    assert health.status_code == 200 and health.headers["X-Request-ID"] == "my_request-123"
    assert health.json()["status"] == "ok" and health.json()["version"] == "1.0.0"
    assert health.json()["simulation"] == {"running": False}
    responses = [client.get("/api/sim/state"), client.get("/api/ha/state"), client.get("/metrics"),
                 client.get("/api/no-such-path", headers={"X-Request-ID": "invalid id!"}),
                 client.post("/api/sim/orders", json={}), client.get("/api/sim/orders")]
    for response in responses:
        rid = response.headers["X-Request-ID"]
        assert re.fullmatch(r"[a-f0-9]{32}", rid)
        if response.status_code >= 400:
            assert response.json()["error"]["request_id"] == rid


def test_cors_only_contract_origins_and_error_envelope(client):
    for origin in ("http://localhost:5180", "http://127.0.0.1:5180"):
        response = client.options("/api/sim/orders", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                             "Access-Control-Request-Headers": "Idempotency-Key, X-Request-ID"})
        assert response.status_code == 200 and response.headers["access-control-allow-origin"] == origin
        assert "X-Request-ID" in response.headers
    rejected = client.options("/api/sim/orders", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert rejected.status_code == 400 and "access-control-allow-origin" not in rejected.headers
    assert rejected.json()["error"]["request_id"] == rejected.headers["X-Request-ID"]


def test_unexpected_error_has_no_traceback(client):
    @client.app.get("/test-internal-error")
    async def broken():
        raise RuntimeError("secret internal trace details")
    response = client.get("/test-internal-error")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "secret" not in response.text and "Traceback" not in response.text
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]


def test_metrics_names_and_bounded_route_labels(client):
    client.post("/api/sim/orders", json={"sku": "SKU-AURORA-LAMP", "qty": 1})
    for i in range(20):
        client.get(f"/unmatched/{i}")
    response = client.get("/metrics")
    assert response.status_code == 200
    names = ["datasphere_sim_orders_committed_total", "datasphere_sim_orders_rejected_total",
             "datasphere_sim_idempotent_replays_total", "datasphere_sim_events_published_total",
             "datasphere_sim_events_delivered_total", "datasphere_sim_duplicates_ignored_total",
             "datasphere_sim_outbox_pending", "datasphere_sim_consumer_up", "datasphere_sim_consistency_lag_events",
             "datasphere_ha_replication_lag_bytes", "datasphere_lab_bench_runs_total",
             "datasphere_http_requests_total", "datasphere_http_request_duration_seconds"]
    for name in names:
        assert name in response.text
    assert "# HELP" in response.text and "# TYPE" in response.text
    assert 'route="unmatched"' in response.text and "/unmatched/" not in response.text
    assert 'route="/api/sim/orders"' in response.text
    assert "datasphere_sim_orders_committed_total 1.0" in response.text


def test_sse_initial_event_fanout_shutdown_and_disconnect(client):
    class Request:
        disconnected = False
        async def is_disconnected(self):
            return self.disconnected
    async def exercise():
        s = client.app.state.services
        request = Request()
        stream = stream_events(s, request)
        first = await anext(stream)
        assert first.startswith("event: state\n")
        assert set(json.loads(first.split("data: ")[1])) == {"sim", "ha"}
        assert len(s.bus.queues) == 1
        s.bus.emit("order.committed", {"order_id": "ord_test1234"})
        discrete = await anext(stream)
        assert discrete.startswith("event: sim\n") and '"type":"order.committed"' in discrete
        request.disconnected = True
        try:
            await anext(stream)
            assert False, "Disconnected client must stop"
        except StopAsyncIteration:
            pass
        assert not s.bus.queues
        request.disconnected = False
        stream = stream_events(s, request)
        await anext(stream)
        s.bus.close()
        try:
            await anext(stream)
            assert False, "Closed bus must stop stream"
        except StopAsyncIteration:
            pass
        assert not s.bus.queues
    asyncio.run(exercise())


def test_bus_drop_oldest_independent_clients(clock):
    async def exercise():
        bus = EventBus(clock, queue_size=2)
        slow, fast = bus.subscribe(), bus.subscribe()
        for i in range(5):
            bus.emit("traffic.changed", {"i": i})
            assert (await fast.get())["data"]["i"] == i
        assert slow.qsize() == 2
        assert (await slow.get())["data"]["i"] == 3
        assert (await slow.get())["data"]["i"] == 4
        bus.close()
        assert await slow.get() is None and await fast.get() is None
        assert not bus.queues
    asyncio.run(exercise())
