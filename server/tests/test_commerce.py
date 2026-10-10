import asyncio
import pytest
from app.sim.bus import EventBus
from app.sim.commerce import Commerce, HISTORY_LOST
from conftest import tick

SKU = "SKU-AURORA-LAMP"


def order(client, key="test_key_001", **changes):
    return client.post("/api/sim/orders", json={"sku": SKU, "qty": 2, "idempotency_key": key, **changes})


def chaos(client, action, **extra):
    response = client.post("/api/sim/chaos", json={"action": action, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_order_happy_path(client):
    before = client.get("/api/sim/state").json()
    response = order(client)
    assert response.status_code == 201
    result = response.json()
    assert result["replayed"] is False
    o = result["order"]
    assert o["id"].startswith("ord_") and result["outbox_event_id"].startswith("evt_")
    assert o["created_at"].endswith("Z") and len(o["created_at"].split(".")[1]) == 4
    assert set(o) == {"id", "customer_id", "customer_name", "sku", "product_name", "qty", "unit_price_cents",
                      "total_cents", "status", "idempotency_key", "created_at", "outbox_event_id", "position"}
    state = client.get("/api/sim/state").json()
    assert state["products"][0]["stock"] == before["products"][0]["stock"] - 2
    assert state["postgres"]["orders_total"] == 1
    assert state["postgres"]["inventory_movements_total"] == 1
    assert state["postgres"]["outbox"]["pending"] == 1
    assert state["consistency"]["status"] == "converging"


def test_insufficient_stock_is_atomic(client):
    sim = client.app.state.services.commerce
    sim.products[SKU]["stock"] = 1
    response = order(client)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INSUFFICIENT_STOCK"
    assert response.json()["error"]["details"] == {"available": 1, "requested": 2, "sku": SKU}
    assert sim.products[SKU]["stock"] == 1
    assert not sim.orders and not sim.outbox and not sim.keys and sim.movements_total == 0


def test_idempotency_replay_and_fingerprint(client):
    first = order(client).json()
    before = client.get("/api/sim/state").json()
    replay = order(client)
    assert replay.status_code == 200
    assert replay.json() == {**first, "replayed": True}
    after = client.get("/api/sim/state").json()
    assert after["postgres"] == before["postgres"] and after["products"] == before["products"]
    mismatch = order(client, qty=3)
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert after["postgres"]["orders_total"] == 1


def test_header_wins_and_null_customer_replay(client):
    body = {"sku": SKU, "qty": 1, "customer_id": None, "idempotency_key": "body_key_001"}
    first = client.post("/api/sim/orders", json=body, headers={"Idempotency-Key": "header_key_01"})
    assert first.status_code == 201 and first.json()["order"]["idempotency_key"] == "header_key_01"
    body["idempotency_key"] = "body_key_002"
    replay = client.post("/api/sim/orders", json=body, headers={"Idempotency-Key": "header_key_01"})
    assert replay.status_code == 200 and replay.json()["order"] == first.json()["order"]


@pytest.mark.parametrize("changes,code", [({"sku": "unknown"}, "PRODUCT_NOT_FOUND"),
                                         ({"customer_id": "cus_unknown"}, "CUSTOMER_NOT_FOUND")])
def test_unknown_identifiers(client, changes, code):
    response = order(client, **changes)
    assert response.status_code == 404 and response.json()["error"]["code"] == code
    assert not client.app.state.services.commerce.orders


@pytest.mark.parametrize("changes", [{"qty": 0}, {"qty": 21}, {"qty": True}, {"qty": 1.5},
                                     {"idempotency_key": "bad"}, {"idempotency_key": "illegal!!"}])
def test_validation_error_envelope(client, changes):
    response = order(client, **changes)
    assert response.status_code == 422
    error = response.json()["error"]
    assert set(error) == {"code", "message", "request_id", "details"}
    assert error["code"] == "VALIDATION_ERROR" and error["details"]["fields"]
    assert response.headers["X-Request-ID"] == error["request_id"]


def test_relay_consumer_and_duplicate(client, clock):
    chaos(client, "duplicate_next")
    o = order(client).json()["order"]
    tick(client, clock, "relay_tick", .2)
    assert client.app.state.services.commerce.published_total == 0
    tick(client, clock, "relay_tick", .2)
    state = client.get("/api/sim/state").json()
    assert state["postgres"]["outbox"]["pending"] == 0 and state["broker"]["in_flight"] == 2
    tick(client, clock, "consumer_tick", 2)
    state = client.get("/api/sim/state").json()
    assert state["mongo"]["order_views_total"] == 1
    view = state["mongo"]["order_views"][0]
    assert view["_id"] == o["id"] and view["total_cents"] == o["total_cents"]
    assert view["projected_by"] == "consumer"
    assert state["consumer"]["processed_total"] == 1 and state["consumer"]["duplicates_ignored"] == 1
    assert state["consumer"]["resume_token"]["position"] == 1
    assert state["consistency"]["status"] == "consistent"
    assert sum(s["orders"] for s in state["mongo"]["customer_stats"]) == 1


def test_out_of_order_contiguous_watermark_and_redelivery(client, clock):
    chaos(client, "delay_next")
    order(client, "delay_key_001")
    tick(client, clock, "relay_tick", .4)
    order(client, "later_key_002")
    tick(client, clock, "relay_tick", .4)
    tick(client, clock, "consumer_tick", 1)
    sim = client.app.state.services.commerce
    assert sim.processed_total == 1 and sim.watermark == 0 and sim.processed_positions == {2}
    chaos(client, "crash_consumer")
    chaos(client, "restart_consumer")
    assert all(d["kind"] == "redelivery" for d in sim.deliveries.values())
    tick(client, clock, "consumer_tick", 1)
    assert sim.duplicates_ignored == 1 and sim.watermark == 0
    tick(client, clock, "consumer_tick", 5)
    assert sim.watermark == 2 and sim.processed_total == 2
    assert not sim.processed_ids and not sim.processed_positions
    assert sim.consistency()["status"] == "consistent"


def test_crash_pileup_restart(client, clock):
    chaos(client, "crash_consumer")
    order(client)
    tick(client, clock, "relay_tick", .4)
    tick(client, clock, "consumer_tick", 2)
    sim = client.app.state.services.commerce
    assert len(sim.deliveries) == 1 and not sim.views and sim.consistency()["status"] == "diverged"
    chaos(client, "restart_consumer")
    assert next(iter(sim.deliveries.values()))["kind"] == "redelivery"
    tick(client, clock, "consumer_tick")
    assert sim.processed_total == 1 and sim.watermark == 1 and len(sim.views) == 1


def test_invalid_token_resync_repairs_and_ignores_deliveries(client, clock):
    order(client)
    tick(client, clock, "relay_tick", .4)
    chaos(client, "invalidate_resume_token")
    sim = client.app.state.services.commerce
    assert sim.status == "crashed" and sim.last_error == HISTORY_LOST and sim.token_valid is False
    chaos(client, "restart_consumer")
    assert sim.status == "running" and sim.token_valid and sim.watermark == sim.head == 1
    assert sim.views[next(iter(sim.orders))]["projected_by"] == "reconciler"
    tick(client, clock, "consumer_tick", 2)
    assert sim.duplicates_ignored == 1 and sim.processed_total == 1
    assert sim.consistency()["status"] == "consistent"


def test_drift_and_reconcile_report(client, clock):
    order(client)
    tick(client, clock, "relay_tick", .4)
    tick(client, clock, "consumer_tick", 2)
    sim = client.app.state.services.commerce
    queue = sim.bus.subscribe()
    chaos(client, "drop_readmodel_doc")
    assert sim.consistency()["status"] == "diverged" and sim.consistency()["missing_in_mongo"] == 1
    chaos(client, "reconcile")
    assert sim.consistency()["status"] == "consistent"
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    report = next(e["data"] for e in events if e["type"] == "reconcile.completed")
    assert report["scanned"] == 1 and report["repaired"] == 1 and report["duration_ms"] >= 0
    sim.views[next(iter(sim.orders))]["total_cents"] = 0
    assert sim.consistency()["stale_in_mongo"] == 1
    chaos(client, "reconcile")
    assert sim.consistency()["status"] == "consistent"
    assert sum(s["orders"] for s in sim.customer_stats.values()) == 1
    sim.bus.unsubscribe(queue)


def test_restock_traffic_reset_unknown_and_backpressure(client, clock):
    sim = client.app.state.services.commerce
    sim.products[SKU]["stock"] = 6
    order(client, qty=1)
    tick(client, clock, "restock_tick", 1.9)
    assert sim.products[SKU]["stock"] == 5
    tick(client, clock, "restock_tick", .2)
    assert sim.products[SKU]["stock"] == 45
    response = client.post("/api/sim/traffic", json={"enabled": False, "orders_per_min": 0})
    assert response.json() == {"enabled": False, "orders_per_min": 0}
    tick(client, clock, "traffic_tick", 100)
    assert sim.orders_total == 1
    assert client.post("/api/sim/chaos", json={"action": "unknown"}).status_code == 400
    sim.deliveries = {str(i): {} for i in range(201)}
    response = client.post("/api/sim/chaos", json={"action": "burst"})
    assert response.status_code == 429 and response.json()["error"]["code"] == "BACKPRESSURE"
    chaos(client, "reset")
    assert sim.orders_total == 0 and len(sim.customers) == 8 and len(sim.products) == 6


def test_bounded_history_and_atomic_parallel_stock(clock):
    async def exercise():
        sim = Commerce(clock=clock, history_limit=8)
        for i in range(200):
            sim.products[SKU]["stock"] = 60
            await sim.place_order(SKU, 1, idempotency_key=f"bound_{i:08d}")
            await sim.relay_tick(clock.advance(.4))
            await sim.consumer_tick(clock.advance(1))
        assert len(sim.orders) == len(sim.views) == len(sim.outbox) == len(sim.keys) == 8
        assert sim.orders_total == sim.state()["mongo"]["order_views_total"] == 200
        assert sim.watermark == 200 and not sim.processed_ids and not sim.processed_positions
        sim = Commerce(clock=clock)
        sim.products[SKU]["stock"] = 10
        results = await asyncio.gather(*(sim.place_order(SKU, 1) for _ in range(20)), return_exceptions=True)
        assert sum(isinstance(r, dict) for r in results) == 10
        assert sim.products[SKU]["stock"] == 0
        assert sim.orders_total == sim.movements_total == len(sim.outbox) == len(sim.keys) == 10
    asyncio.run(exercise())
