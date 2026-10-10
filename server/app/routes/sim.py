import re
from fastapi import APIRouter, Header, Request
from starlette.responses import JSONResponse
from app.errors import APIError
from app.models import ChaosInput, OrderInput, TrafficInput

router = APIRouter()


@router.get("/api/sim/state")
async def state(request: Request):
    return request.app.state.services.commerce.state()


@router.post("/api/sim/orders")
async def orders(body: OrderInput, request: Request, idempotency_key: str | None = Header(default=None)):
    key = idempotency_key if idempotency_key is not None else body.idempotency_key
    if key is not None and not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", key):
        raise APIError(422, "VALIDATION_ERROR", "Invalid Idempotency-Key",
                       {"fields": [{"field": "header.Idempotency-Key", "message": "Use 8..64 letters, digits, underscores or hyphens", "type": "string_pattern_mismatch"}]})
    result = await request.app.state.services.commerce.place_order(body.sku, body.qty, body.customer_id, key)
    return JSONResponse(result, status_code=200 if result["replayed"] else 201)


@router.post("/api/sim/chaos")
async def chaos(body: ChaosInput, request: Request):
    return await request.app.state.services.commerce.chaos(body.action, body.count)


@router.post("/api/sim/traffic")
async def traffic(body: TrafficInput, request: Request):
    return await request.app.state.services.commerce.set_traffic(body.enabled, body.orders_per_min)
