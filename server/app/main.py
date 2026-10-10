import asyncio
from contextlib import asynccontextmanager
import time
import signal
import threading

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS, Settings
from app.errors import APIError, api_error_handler, http_error_handler, validation_error_handler
from app.lab.bench import Benchmark
from app.metrics import Metrics, RequestMiddleware
from app.routes import capacity, ha, health, lab, metrics, sim, stream
from app.sim.bus import EventBus
from app.sim.commerce import Commerce
from app.sim.ha import HA
from app.web import add_web_routes


class Services:
    def __init__(self, settings, clock):
        self.settings, self.clock = settings, clock
        self.started_at = clock()
        self.bus = EventBus(clock)
        self.commerce = Commerce(self.bus, clock)
        self.ha = HA(self.bus, clock)
        self.bench, self.metrics = Benchmark(), Metrics()
        self.running = False
        self.tasks = []
        self.signal_handlers = {}

    async def commerce_loop(self):
        last_relay = float("-inf")
        while True:
            now = self.clock()
            if now - last_relay >= .4:
                await self.commerce.relay_tick(now)
                last_relay = now
            await self.commerce.consumer_tick(now)
            await self.commerce.traffic_tick(now)
            await self.commerce.restock_tick(now)
            await asyncio.sleep(.1)

    async def ha_loop(self):
        while True:
            self.ha.tick(self.clock())
            await asyncio.sleep(.1)

    async def start(self):
        # Uvicorn waits for HTTP streams before sending lifespan shutdown. Close
        # our fan-out on its termination signal so active SSE clients can finish.
        # Chain only Uvicorn's installed handlers; leave embedding hosts alone.
        if threading.current_thread() is threading.main_thread():
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                previous = signal.getsignal(sig)
                if callable(previous) and getattr(previous, "__module__", "") == "uvicorn.server":
                    def handler(signum, frame, previous=previous):
                        loop.call_soon_threadsafe(self.bus.close)
                        previous(signum, frame)
                    self.signal_handlers[sig] = (previous, handler)
                    signal.signal(sig, handler)
        if self.settings.autostart:
            self.running = True
            self.tasks = [asyncio.create_task(self.commerce_loop(), name="commerce"),
                          asyncio.create_task(self.ha_loop(), name="ha")]

    async def stop(self):
        self.running = False
        self.bus.close()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
        for sig, (previous, handler) in self.signal_handlers.items():
            if signal.getsignal(sig) is handler:
                signal.signal(sig, previous)
        self.signal_handlers.clear()
        if self.bench.worker is not None:
            await asyncio.shield(self.bench.worker)


def create_app(settings=None, clock=time.time):
    services = Services(settings or Settings.from_env(), clock)

    @asynccontextmanager
    async def lifespan(app):
        await services.start()
        try:
            yield
        finally:
            await services.stop()

    app = FastAPI(title="DataSphere Showcase", version="1.0.0", lifespan=lifespan,
                  redirect_slashes=False, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.services = services
    app.add_exception_handler(APIError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "Idempotency-Key", "X-Request-ID"],
                       expose_headers=["X-Request-ID"])
    app.add_middleware(RequestMiddleware, metrics=services.metrics)
    for module in (health, sim, ha, lab, capacity, stream, metrics):
        app.include_router(module.router)
    add_web_routes(app)
    return app


app = create_app()
