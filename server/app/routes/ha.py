from fastapi import APIRouter, Request
from app.models import HAInput

router = APIRouter()


@router.get("/api/ha/state")
async def state(request: Request):
    return request.app.state.services.ha.state()


@router.post("/api/ha/action")
async def action(body: HAInput, request: Request):
    return request.app.state.services.ha.action(body.action, body.mode)
