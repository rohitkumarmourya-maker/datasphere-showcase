import asyncio
import importlib
from types import SimpleNamespace

import pytest
from app.errors import APIError
from app.sim.commerce import Commerce
from conftest import tick
from test_commerce import SKU, chaos, order


def test_drift_with_duplicate_inflight_is_diverged(client, clock):
    chaos(client, "duplicate_next")
    order(client)
    tick(client, clock, "relay_tick", .4)
    sim = client.app.state.services.commerce
    first_due = min(d["_due"] for d in sim.deliveries.values())
    clock.now = first_due
    tick(client, clock, "consumer_tick")
    assert sim.processed_total == 1 and len(sim.deliveries) == 1
    chaos(client, "drop_readmodel_doc")
    assert sim.consistency()["status"] == "diverged"
    tick(client, clock, "consumer_tick", 1)
    assert sim.consistency()["status"] == "diverged" and sim.duplicates_ignored == 1
    chaos(client, "reconcile")
    assert sim.consistency()["status"] == "consistent"


def test_full_unresolved_window_backpressure(clock):
    async def exercise():
        sim = Commerce(clock=clock, history_limit=2)
        await sim.place_order(SKU, 1)
        await sim.place_order(SKU, 1)
        stock = sim.products[SKU]["stock"]
        with pytest.raises(APIError) as error:
            await sim.place_order(SKU, 1)
        assert error.value.status == 429 and error.value.code == "BACKPRESSURE"
        assert sim.products[SKU]["stock"] == stock and sim.head == 2
        assert len(sim.orders) == len(sim.outbox) == len(sim.keys) == 2
    asyncio.run(exercise())


def test_sse_periodic_state_ping_and_headers(client, monkeypatch):
    module = importlib.import_module("app.routes.stream")
    wall = SimpleNamespace(now=0)
    monkeypatch.setattr(module, "time", SimpleNamespace(monotonic=lambda: wall.now))
    class Request:
        app = client.app
        async def is_disconnected(self):
            return False
    async def exercise():
        response = await module.stream(Request())
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        assert response.headers["content-type"].startswith("text/event-stream")
        generator = response.body_iterator
        assert (await anext(generator)).startswith("event: state\n")
        wall.now = 1.01
        assert (await anext(generator)).startswith("event: state\n")
        client.app.state.services.bus.emit("traffic.changed", {})
        assert (await anext(generator)).startswith("event: sim\n")
        wall.now = 15.01
        assert (await anext(generator)).startswith("event: state\n")
        assert await anext(generator) == ": ping\n\n"
        await generator.aclose()
        assert not client.app.state.services.bus.queues
    asyncio.run(exercise())


def test_second_kill_during_rewind_does_not_break_tick(client, clock):
    ha = client.app.state.services.ha
    for action in ("kill_primary", "promote_standby", "rejoin_old_primary", "kill_primary"):
        assert client.post("/api/ha/action", json={"action": action}).status_code == 200
    ha.tick(clock.advance(3))
    assert ha.primary_id is None and ha.incident is not None
    assert all(n["role"] in ("down", "rewinding") for n in ha.nodes)
    response = client.post("/api/ha/action", json={"action": "promote_standby"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "INVALID_TRANSITION"


def test_unmatched_method_and_malformed_body(client):
    response = client.post("/api/sim/orders", content='{"sku":', headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and response.json()["error"]["code"] == "VALIDATION_ERROR"
    response = client.request("SOMETHING", "/unknown")
    assert response.status_code == 404
    text = client.get("/metrics").text
    assert 'method="OTHER"' in text and 'method="SOMETHING"' not in text
