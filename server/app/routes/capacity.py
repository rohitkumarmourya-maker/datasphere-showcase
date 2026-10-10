from fastapi import APIRouter
from app.capacity import estimate_capacity
from app.models import CapacityInput

router = APIRouter()


@router.post("/api/capacity")
async def capacity(body: CapacityInput):
    return estimate_capacity(body.model_dump())
