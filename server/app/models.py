from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


Key = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class OrderInput(Input):
    sku: str = Field(min_length=1, max_length=128)
    qty: int = Field(ge=1, le=20, strict=True)
    customer_id: str | None = Field(default=None, min_length=1, max_length=64)
    idempotency_key: Key | None = None


class ChaosInput(Input):
    action: str = Field(min_length=1, max_length=64)
    count: int | None = Field(default=None, ge=1, le=50, strict=True)


class TrafficInput(Input):
    enabled: bool = Field(strict=True)
    orders_per_min: int = Field(ge=0, le=120, strict=True)


class HAInput(Input):
    action: str = Field(min_length=1, max_length=64)
    mode: str | None = Field(default=None, pattern=r"^(sync|async)$")


class BenchInput(Input):
    rows: int = Field(default=100000, ge=5000, le=300000, strict=True)
    repeats: int = Field(default=30, ge=5, le=60, strict=True)


class CapacityInput(Input):
    records_per_day: int = Field(ge=0, le=1_000_000_000, strict=True)
    avg_record_bytes: int = Field(ge=16, le=1_000_000, strict=True)
    events_per_record: float = Field(ge=0, le=50, strict=True)
    avg_event_bytes: int = Field(ge=16, le=1_000_000, strict=True)
    index_overhead_pct: float = Field(ge=0, le=300, strict=True)
    replication_factor: int = Field(ge=1, le=7, strict=True)
    backup_full_copies: int = Field(ge=0, le=60, strict=True)
    retention_days: int = Field(ge=1, le=3650, strict=True)
    archive_compression_ratio: float = Field(ge=1, le=20, strict=True)
    monthly_growth_pct: float = Field(ge=-50, le=200, strict=True)
    threshold_gb: float = Field(gt=0, strict=True)
