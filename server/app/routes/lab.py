from fastapi import APIRouter, Request
from app.models import BenchInput

router = APIRouter()


@router.post("/api/lab/index-bench")
async def bench(body: BenchInput, request: Request):
    return await request.app.state.services.bench.run(body.rows, body.repeats)


@router.get("/api/lab/runs")
async def runs(request: Request):
    return {"runs": list(request.app.state.services.bench.runs)}
