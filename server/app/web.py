"""Optional bundled SPA, registered after and kept separate from API routes."""
import logging
import os
from pathlib import Path
import re
from urllib.parse import unquote

from fastapi import Request
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse
from starlette.routing import Match


class WebRoute(APIRoute):
    def matches(self, scope):
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/") or path == "/metrics" or path.startswith("/metrics/"):
            return Match.NONE, {}
        return super().matches(scope)


def add_web_routes(app):
    configured = os.environ.get("DS_WEB_DIST")
    dist = Path(configured) if configured is not None else Path(__file__).resolve().parents[2] / "web" / "dist"
    dist = dist.resolve()
    index = (dist / "index.html").resolve()
    if not index.is_relative_to(dist) or not index.is_file():
        logging.getLogger("uvicorn.error").info("Site is not bundled (no index.html in %s)", dist)
        return

    async def site(request: Request, path: str):
        # Inspect the original URL too: decoding once can conceal double-encoded
        # dot segments. Reject them rather than treating traversal as an SPA URL.
        raw_path = request.scope.get("raw_path", request.scope["path"].encode()).decode("latin1")
        while True:
            if "\\" in raw_path or "\x00" in raw_path or ".." in raw_path.split("/"):
                raise HTTPException(404, "Not Found")
            decoded = unquote(raw_path)
            if decoded == raw_path:
                break
            raw_path = decoded
        try:
            target = (dist / path).resolve()
            if not target.is_relative_to(dist):
                raise HTTPException(404, "Not Found")
            if not target.is_file():
                target = (dist / "index.html").resolve()
            if not target.is_relative_to(dist) or not target.is_file():
                raise HTTPException(404, "Not Found")
        except (OSError, ValueError, RuntimeError):
            raise HTTPException(404, "Not Found") from None
        cache = "no-cache"
        relative = target.relative_to(dist)
        if relative.parts[0] == "assets" and re.search(r"-[A-Za-z0-9_-]{8,}\.[^.]+$", relative.name):
            cache = "public, max-age=31536000, immutable"
        if target.name == "index.html":
            cache = "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})

    app.router.add_api_route("/{path:path}", site, methods=["GET"], include_in_schema=False,
                             route_class_override=WebRoute)
