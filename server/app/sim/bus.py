import asyncio
from collections import deque
from datetime import datetime, timezone
import time
import uuid


def timestamp(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def short_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class EventBus:
    """Each subscriber has independent, bounded, drop-oldest delivery."""

    def __init__(self, clock=time.time, queue_size=128):
        self.clock, self.queue_size = clock, queue_size
        self.seq = 0
        self.queues: set[asyncio.Queue] = set()
        self.recent = deque(maxlen=8192)
        self.closed = False

    def emit(self, kind, data, now=None):
        if self.closed:
            return
        now = self.clock() if now is None else now
        self.seq += 1
        event = {"seq": self.seq, "ts": timestamp(now), "type": kind, "data": data}
        self.recent.append(now)
        for queue in tuple(self.queues):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

    def subscribe(self):
        queue = asyncio.Queue(maxsize=self.queue_size)
        if self.closed:
            queue.put_nowait(None)
        else:
            self.queues.add(queue)
        return queue

    def unsubscribe(self, queue):
        self.queues.discard(queue)

    def rate(self, now):
        while self.recent and self.recent[0] < now - 60:
            self.recent.popleft()
        return len(self.recent) / 60

    def close(self):
        self.closed = True
        for queue in tuple(self.queues):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(None)
        self.queues.clear()
