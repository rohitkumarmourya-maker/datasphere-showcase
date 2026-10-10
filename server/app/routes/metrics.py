from fastapi import APIRouter, Request
from prometheus_client import CONTENT_TYPE_LATEST
from starlette.responses import Response

router = APIRouter()


@router.get("/metrics")
async def metrics(request: Request):
    s = request.app.state.services
    return Response(s.metrics.render(s.commerce, s.ha, s.bench), headers={"Content-Type": CONTENT_TYPE_LATEST})
