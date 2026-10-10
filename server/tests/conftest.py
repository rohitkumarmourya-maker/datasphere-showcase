import os
import pytest
from fastapi.testclient import TestClient

os.environ["DS_SIM_AUTOSTART"] = "0"

from app.main import create_app


class FakeClock:
    def __init__(self):
        self.now = 1_791_632_000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds
        return self.now


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def client(clock, monkeypatch, tmp_path):
    monkeypatch.setenv("DS_WEB_DIST", str(tmp_path / "not-bundled"))
    with TestClient(create_app(clock=clock)) as client:
        yield client


def tick(client, clock, method, seconds=0):
    now = clock.advance(seconds)
    sim = client.app.state.services.commerce
    return client.portal.call(getattr(sim, method), now)
