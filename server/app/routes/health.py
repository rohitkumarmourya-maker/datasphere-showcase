from fastapi import APIRouter, Request
from app.sim.bus import timestamp

router = APIRouter()


@router.get("/api/health")
async def health(request: Request):
    services = request.app.state.services
    return {"status": "ok", "version": "1.0.0", "started_at": timestamp(services.started_at),
            "uptime_s": max(0, services.clock() - services.started_at),
            "simulation": {"running": services.running}}
