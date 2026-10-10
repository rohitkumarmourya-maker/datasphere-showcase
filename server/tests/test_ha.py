import pytest


def act(client, action, **extra):
    response = client.post("/api/ha/action", json={"action": action, **extra})
    assert response.status_code == 200, response.text
    return response.json()["state"]


def test_async_failover_rpo_rto(client, clock):
    state = act(client, "write_burst")
    assert state["committed_txns"] == 400 and state["lag_bytes"] > 0
    act(client, "kill_primary")
    clock.advance(.25)
    state = act(client, "promote_standby")
    failover = state["last_failover"]
    assert failover["rpo_lost_txns"] >= 0
    assert failover["rpo_lost_txns"] == 400
    assert failover["rpo_lost_bytes"] > 0 and failover["rto_ms"] == pytest.approx(250)
    assert state["primary_id"] == "pg-b" and state["nodes"][1]["timeline"] == 2
    assert state["committed_txns"] == 0 and state["incident"] is None


def test_sync_failover_zero_rpo(client, clock):
    act(client, "set_mode", mode="sync")
    state = act(client, "write_burst")
    assert state["lag_bytes"] == 0
    assert state["nodes"][0]["lsn"] == state["nodes"][1]["replay_lsn"]
    act(client, "kill_primary")
    clock.advance(.6)
    state = act(client, "promote_standby")
    assert state["last_failover"]["rpo_lost_txns"] == 0
    assert state["last_failover"]["rpo_lost_bytes"] == 0
    assert state["last_failover"]["rto_ms"] == pytest.approx(600, abs=.001)
    assert state["committed_txns"] == 400
    assert state["writes_per_sec"] == 0  # sync blocks until a standby rejoins


def test_split_brain_fence_rewind_rejoin(client, clock):
    act(client, "write_burst")
    act(client, "kill_primary")
    act(client, "promote_standby")
    state = act(client, "rejoin_old_primary")
    assert state["nodes"][0]["role"] == "fenced" and state["nodes"][0]["timeline"] == 1
    sim = client.app.state.services.ha
    sim.tick(clock.advance(.2))
    assert sim.nodes[0]["role"] == "rewinding"
    sim.tick(clock.advance(2))
    assert sim.nodes[0]["role"] == "standby" and sim.nodes[0]["timeline"] == 2
    assert sim.primary_id == "pg-b" and sim.nodes[0]["healthy"]
    messages = [e["message"] for e in sim.events]
    assert any("Split-brain prevented" in m for m in messages)
    assert any("pg_rewind" in m for m in messages)
    assert any("rejoined" in m for m in messages)


@pytest.mark.parametrize("action,extra", [("promote_standby", {}), ("rejoin_old_primary", {}),
                                        ("set_mode", {}), ("nonsense", {})])
def test_invalid_transition(client, action, extra):
    response = client.post("/api/ha/action", json={"action": action, **extra})
    assert response.status_code == 409 and response.json()["error"]["code"] == "INVALID_TRANSITION"


def test_wal_replay_and_repeat_failover(client, clock):
    sim = client.app.state.services.ha
    sim.tick(clock.advance(.1))
    assert sim.committed_txns == 4
    assert sim.state()["lag_bytes"] > 0
    # Directly drain the first WAL entries without adding writes.
    sim._replicate(clock.advance(1))
    assert sim.nodes[1]["replay_lsn"] == sim.nodes[0]["lsn"]
    act(client, "kill_primary")
    act(client, "promote_standby")
    act(client, "rejoin_old_primary")
    sim.tick(clock.advance(2.2))
    act(client, "set_mode", mode="sync")
    act(client, "write_burst")
    act(client, "kill_primary")
    state = act(client, "promote_standby")
    assert state["primary_id"] == "pg-a" and state["nodes"][0]["timeline"] == 3
    assert state["last_failover"]["rpo_lost_txns"] == 0
