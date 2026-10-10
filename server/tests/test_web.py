import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def dist(tmp_path):
    folder = tmp_path / "dist"
    (folder / "assets").mkdir(parents=True)
    (folder / "index.html").write_text("<!doctype html><title>Bundled site</title>")
    (folder / "assets" / "x.js").write_text("console.log('bundled');")
    (folder / "assets" / "index-DFxIU-HL.js").write_text("console.log('hashed');")
    (folder / "assets" / "x.css").write_text("body { color: red; }")
    (folder / "sphere.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    (tmp_path / "secret.txt").write_text("outside dist secret")
    return folder


@pytest.fixture
def web_client(dist, monkeypatch):
    monkeypatch.setenv("DS_WEB_DIST", str(dist))
    with TestClient(create_app()) as client:
        yield client


def assert_not_found(response):
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"] == {
        "code": "NOT_FOUND", "message": "Not Found",
        "request_id": response.headers["X-Request-ID"], "details": None,
    }


@pytest.mark.parametrize("path", ["/", "/index.html", "/some/deep/route"])
def test_index_and_spa(web_client, dist, path):
    response = web_client.get(path, headers={"X-Request-ID": "static-request"})
    assert response.status_code == 200
    assert response.text == (dist / "index.html").read_text()
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["X-Request-ID"] == "static-request"


@pytest.mark.parametrize("path, content_type", [
    ("/assets/x.js", "javascript"), ("/assets/x.css", "text/css"), ("/sphere.svg", "image/svg+xml"),
])
def test_static_files(web_client, dist, path, content_type):
    response = web_client.get(path)
    assert response.status_code == 200
    assert response.content == (dist / path.lstrip("/")).read_bytes()
    assert content_type in response.headers["content-type"]
    assert response.headers["cache-control"] == "no-cache"


def test_hashed_asset_cache(web_client):
    response = web_client.get("/assets/index-DFxIU-HL.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize("path", ["/api/does-not-exist", "/api", "/metrics/unknown"])
@pytest.mark.parametrize("method", ["GET", "POST", "HEAD", "DELETE"])
def test_unknown_api_paths_are_not_spa(web_client, dist, path, method):
    # Even real files in the bundle cannot take over the API namespace.
    (dist / "api").mkdir(exist_ok=True)
    (dist / "api" / "does-not-exist").write_text("not an API")
    if method != "HEAD":
        assert_not_found(web_client.request(method, path))
    else:
        response = web_client.head(path)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/json")
        assert "X-Request-ID" in response.headers


def test_api_and_metrics_are_preserved(web_client):
    health = web_client.get("/api/health")
    assert health.status_code == 200
    assert health.headers["content-type"].startswith("application/json")
    assert health.json()["status"] == "ok"
    assert web_client.get("/api/sim/orders").status_code == 405
    assert web_client.post("/api/health").status_code == 405
    assert web_client.post("/metrics").status_code == 405
    for i in range(10):
        web_client.get(f"/some/deep/{i}")
        web_client.get(f"/assets/absent-{i}.js")
    metrics = web_client.get("/metrics")
    assert metrics.status_code == 200 and "# HELP" in metrics.text
    assert 'route="/{path:path}"' in metrics.text
    assert "/some/deep/" not in metrics.text and "/assets/absent-" not in metrics.text
    assert 'route="/api/health"' in metrics.text
    assert "X-Request-ID" in metrics.headers


@pytest.mark.parametrize("path", [
    "/%2e%2e/secret.txt", "/%2e%2e/server/app/main.py", "/..%2fsecret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt", "/%252e%252e%252fsecret.txt",
    "/%5c..%5csecret.txt", "/%00secret.txt",
])
def test_encoded_traversal(web_client, path):
    response = web_client.get(path)
    assert_not_found(response)
    assert "outside dist secret" not in response.text


def test_literal_traversal(web_client):
    # HTTP clients normalize literal dot segments. Send a raw ASGI scope to
    # exercise the server's handling of the original request path instead.
    async def exercise():
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                 "method": "GET", "scheme": "http", "path": "/../server/app/main.py",
                 "raw_path": b"/../server/app/main.py", "root_path": "", "query_string": b"",
                 "headers": [], "client": ("127.0.0.1", 1), "server": ("testserver", 80)}
        messages = []
        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}
        async def send(message):
            messages.append(message)
        await web_client.app(scope, receive, send)
        assert messages[0]["status"] == 404
        assert b"NOT_FOUND" in messages[1]["body"]
        assert b"outside dist secret" not in messages[1]["body"]
    web_client.portal.call(exercise)


def test_symlink_escape(web_client, dist):
    (dist / "secret.txt").symlink_to(dist.parent / "secret.txt")
    response = web_client.get("/secret.txt")
    assert_not_found(response)
    assert "outside dist secret" not in response.text


@pytest.mark.parametrize("bundle", ["missing", "empty"])
def test_no_bundle_keeps_original_routes(tmp_path, monkeypatch, caplog, bundle):
    directory = tmp_path / bundle
    if bundle == "empty":
        directory.mkdir()
    monkeypatch.setenv("DS_WEB_DIST", str(directory))
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        app = create_app()
    assert sum("Site is not bundled" in record.message for record in caplog.records) == 1
    assert all(getattr(route, "path", None) != "/{path:path}" for route in app.routes)
    with TestClient(app) as client:
        assert_not_found(client.get("/"))
        assert_not_found(client.get("/some/deep/route"))
        assert_not_found(client.get("/api/does-not-exist"))
        assert client.get("/api/health").status_code == 200


def test_default_bundle_is_relative_to_package(tmp_path, monkeypatch):
    monkeypatch.delenv("DS_WEB_DIST", raising=False)
    monkeypatch.chdir(tmp_path)
    index = Path(__file__).resolve().parents[2] / "web" / "dist" / "index.html"
    with TestClient(create_app()) as client:
        response = client.get("/")
        if index.is_file():
            assert response.status_code == 200
            assert response.content == index.read_bytes()
        else:
            assert_not_found(response)
