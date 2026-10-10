import asyncio
import json
import time
from fastapi import APIRouter, Request
from starlette.responses import StreamingResponse

router = APIRouter()


def sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'), allow_nan=False)}\n\n"


async def stream_events(services, request):
    queue = services.bus.subscribe()
    state_at = time.monotonic()
    ping_at = state_at + 15
    try:
        if services.bus.closed:
            return
        yield sse("state", {"sim": services.commerce.state(), "ha": services.ha.state()})
        state_at += 1
        while not services.bus.closed:
            if await request.is_disconnected():
                break
            now = time.monotonic()
            if now >= state_at:
                yield sse("state", {"sim": services.commerce.state(), "ha": services.ha.state()})
                state_at = now + 1
            if now >= ping_at:
                yield ": ping\n\n"
                ping_at = now + 15
            timeout = max(.001, min(state_at, ping_at) - time.monotonic())
            try:
                event = await asyncio.wait_for(queue.get(), timeout=timeout)
            except TimeoutError:
                continue
            if event is None:
                break
            yield sse("sim", event)
    finally:
        services.bus.unsubscribe(queue)


@router.get("/api/sim/stream")
async def stream(request: Request):
    return StreamingResponse(stream_events(request.app.state.services, request), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
