from collections import deque
from copy import deepcopy
import random
import time

from app.errors import APIError
from app.sim.bus import EventBus, timestamp


class HA:
    """Simulated WAL bytes and acknowledged/replayed transaction bookkeeping."""

    def __init__(self, bus=None, clock=time.time):
        self.clock = clock
        self.bus = bus or EventBus(clock)
        self._reset(clock())

    def _reset(self, now):
        self.rng = random.Random(11)
        self.mode = "async"
        self.nodes = [{"id": nid, "role": role, "timeline": 1, "lsn": 0,
                       "replay_lsn": 0, "healthy": True}
                      for nid, role in (("pg-a", "primary"), ("pg-b", "standby"))]
        self.primary_id = "pg-a"
        self.committed_txns = 0
        self.replayed_txns = {"pg-a": 0, "pg-b": 0}
        self.pending = deque()
        self.events = deque(maxlen=20)
        self.incident = self.last_failover = None
        self.killed_at = self.rewind_at = self.fence_until = None
        self.last_tick = now
        self.credit = 0.0
        self.last_replay_at = now
        self._log("info", "Simulated PostgreSQL primary and standby initialized", now)

    def _node(self, nid):
        return next(n for n in self.nodes if n["id"] == nid)

    def _standby(self):
        return next((n for n in self.nodes if n["role"] == "standby" and n["healthy"]), None)

    def _log(self, level, message, now):
        self.events.appendleft({"ts": timestamp(now), "level": level, "message": message})

    def _emit(self, kind, data, now):
        self.bus.emit("ha." + kind, data, now)

    def _write(self, count, now):
        if self.primary_id is None:
            return
        primary, standby = self._node(self.primary_id), self._standby()
        if self.mode == "sync" and standby is None:
            return  # Synchronous acknowledgements require the standby flush.
        for _ in range(count):
            size = self.rng.randint(180, 260)
            primary["lsn"] += size
            primary["replay_lsn"] = primary["lsn"]
            self.committed_txns += 1
            self.replayed_txns[primary["id"]] = self.committed_txns
            if standby:
                if self.mode == "sync":
                    standby["lsn"] = standby["replay_lsn"] = primary["lsn"]
                    self.replayed_txns[standby["id"]] = self.committed_txns
                    self.last_replay_at = now
                else:
                    receive_at = now + self.rng.uniform(.15, .52)
                    if self.pending:
                        receive_at = max(receive_at, self.pending[-1]["receive_at"])
                    self.pending.append({"lsn": primary["lsn"], "txn": self.committed_txns,
                                         "receive_at": receive_at, "replay_at": receive_at + self.rng.uniform(.03, .08),
                                         "received": False, "written_at": now})

    def _replicate(self, now):
        standby = self._standby()
        if not standby:
            return
        for wal in self.pending:
            if wal["receive_at"] <= now and self.primary_id is not None:
                wal["received"] = True
                standby["lsn"] = max(standby["lsn"], wal["lsn"])
        # WAL replay is ordered even when receive/replay jitter differs per entry.
        while self.pending and self.pending[0]["received"] and self.pending[0]["replay_at"] <= now:
            wal = self.pending.popleft()
            standby["replay_lsn"] = wal["lsn"]
            self.replayed_txns[standby["id"]] = wal["txn"]
            self.last_replay_at = wal["written_at"]

    def tick(self, now):
        elapsed = max(0, now - self.last_tick)
        self.last_tick = now
        if self.fence_until is not None and now >= self.fence_until:
            node = next(n for n in self.nodes if n["role"] == "fenced")
            node["role"] = "rewinding"
            self.fence_until = None
            self._log("info", f"pg_rewind started for {node['id']}", now)
            self._emit("rewind_started", {"node_id": node["id"], "primary_id": self.primary_id}, now)
        if self.rewind_at is not None and now >= self.rewind_at and self.primary_id is not None:
            node = next(n for n in self.nodes if n["role"] in ("fenced", "rewinding"))
            primary = self._node(self.primary_id)
            node.update(role="standby", timeline=primary["timeline"], lsn=primary["lsn"],
                        replay_lsn=primary["lsn"], healthy=True)
            self.replayed_txns[node["id"]] = self.committed_txns
            self.last_replay_at = now
            self.rewind_at = self.fence_until = None
            self._log("info", f"{node['id']} rejoined as standby on timeline {node['timeline']}", now)
            self._emit("rejoined", {"node_id": node["id"], "primary_id": self.primary_id, "timeline": node["timeline"]}, now)
        self._replicate(now)
        if self.primary_id:
            self.credit += min(elapsed, 10) * 40
            count = int(self.credit + 1e-5)
            self.credit -= count
            # A stopped standby cannot cause unbounded WAL queue retention.
            self._write(min(count, max(0, 8192 - len(self.pending))), now)

    def action(self, action, mode=None, now=None):
        now = self.clock() if now is None else now
        self.tick(now)

        def invalid(message):
            raise APIError(409, "INVALID_TRANSITION", message)

        if action == "kill_primary":
            if self.primary_id is None:
                invalid("There is no healthy primary to kill")
            node = self._node(self.primary_id)
            node.update(role="down", healthy=False)
            self.incident = {"started_at": timestamp(now), "killed": node["id"]}
            self.killed_at = now
            self.primary_id = None
            self.credit = 0
            self._log("error", f"Primary {node['id']} is down; acknowledged writes stopped", now)
            self._emit("primary_down", {"node_id": node["id"], "primary_id": node["id"]}, now)
            message = f"Primary {node['id']} killed"
        elif action == "promote_standby":
            if self.primary_id is not None or self.incident is None:
                invalid("Cannot promote while the primary is healthy")
            node = self._standby()
            if node is None:
                invalid("There is no healthy standby to promote")
            old = self._node(self.incident["killed"])
            lost_txns = self.committed_txns - self.replayed_txns[node["id"]]
            lost_bytes = old["lsn"] - node["replay_lsn"]
            self.last_failover = {"at": timestamp(now), "from": old["id"], "to": node["id"], "mode": self.mode,
                                  "rpo_lost_txns": max(0, lost_txns), "rpo_lost_bytes": max(0, lost_bytes),
                                  "rto_ms": max(0, (now - self.killed_at) * 1000)}
            self.committed_txns = self.replayed_txns[node["id"]]
            node.update(role="primary", timeline=old["timeline"] + 1, lsn=node["replay_lsn"])
            self.primary_id = node["id"]
            self.pending.clear()
            self.incident = None
            self._log("warn", f"{node['id']} promoted; lost {lost_txns} acknowledged transactions", now)
            self._emit("promoted", dict(self.last_failover), now)
            message = f"Promoted {node['id']} on timeline {node['timeline']}"
        elif action == "rejoin_old_primary":
            if self.primary_id is None or self.last_failover is None or self.incident is not None:
                invalid("There is no old primary to rejoin after a promotion")
            node = self._node(self.last_failover["from"])
            if node["role"] != "down":
                invalid("The old primary is already rejoining or joined")
            node.update(role="fenced", healthy=True)
            self.fence_until, self.rewind_at = now + .1, now + 2.1
            self._log("warn", f"Split-brain prevented: fenced {node['id']} on its old timeline", now)
            self._emit("split_brain_prevented", {"node_id": node["id"], "primary_id": self.primary_id,
                                                 "old_timeline": node["timeline"]}, now)
            message = "Old primary fenced; pg_rewind will precede standby rejoin"
        elif action == "set_mode":
            if mode not in ("sync", "async"):
                invalid("set_mode requires sync or async")
            if self.primary_id is None or (mode == "sync" and self._standby() is None):
                invalid("Changing mode requires a healthy primary and sync requires a standby")
            if mode == "sync":
                primary, standby = self._node(self.primary_id), self._standby()
                standby["lsn"] = standby["replay_lsn"] = primary["lsn"]
                self.replayed_txns[standby["id"]] = self.committed_txns
                self.pending.clear()
                self.last_replay_at = now
            self.mode = mode
            self._log("info", f"Replication mode changed to {mode}", now)
            self._emit("mode_changed", {"mode": mode}, now)
            message = f"Replication mode is {mode}"
        elif action == "write_burst":
            if self.primary_id is None:
                invalid("Writes require a healthy primary")
            if self.mode == "sync" and self._standby() is None:
                invalid("Synchronous writes require a healthy standby")
            if len(self.pending) + 400 > 8192:
                invalid("WAL replication queue is full; wait for standby replay")
            self._write(400, now)
            self._log("info", "400 simulated transactions acknowledged", now)
            self._emit("write_burst", {"node_id": self.primary_id, "txns": 400}, now)
            message = "Acknowledged 400 simulated transactions"
        elif action == "reset":
            self._reset(now)
            self._emit("reset", {}, now)
            message = "HA simulation reset"
        else:
            invalid("Unknown HA action")
        return {"ok": True, "message": message, "state": self.state(now)}

    def state(self, now=None):
        now = self.clock() if now is None else now
        standby = self._standby()
        primary = self._node(self.primary_id) if self.primary_id else None
        source = primary or (self._node(self.incident["killed"]) if self.incident else None)
        lag = max(0, source["lsn"] - standby["replay_lsn"]) if source and standby else 0
        return deepcopy({"mode": self.mode, "nodes": self.nodes, "primary_id": self.primary_id,
                         "committed_txns": self.committed_txns, "lag_bytes": lag,
                         "lag_ms": max(0, (now - self.last_replay_at) * 1000) if lag else 0,
                         "commit_latency_ms_p50": 8.5 if self.mode == "sync" else 1.8,
                         "writes_per_sec": 40 if primary and (self.mode == "async" or standby) else 0,
                         "incident": self.incident, "last_failover": self.last_failover, "events": list(self.events)})
