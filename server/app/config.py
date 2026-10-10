import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    autostart: bool = True
    host: str = "127.0.0.1"
    port: int = 8710

    @classmethod
    def from_env(cls):
        host = os.getenv("DS_HOST", "127.0.0.1")
        if host not in ("127.0.0.1", "0.0.0.0"):
            raise ValueError("DS_HOST must be 127.0.0.1 or 0.0.0.0")
        port = int(os.getenv("PORT", os.getenv("DS_PORT", "8710")))
        if not 1 <= port <= 65535:
            raise ValueError("DS_PORT must be between 1 and 65535")
        return cls(os.getenv("DS_SIM_AUTOSTART", "1") != "0", host, port)


CORS_ORIGINS = ["http://localhost:5180", "http://127.0.0.1:5180"]
