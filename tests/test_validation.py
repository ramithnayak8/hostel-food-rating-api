"""Cross-cutting behaviour: error envelope, middleware, settings validation."""

import asyncio
import logging
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.types import Message

from app.config import DEV_JWT_SECRET, Settings
from app.logging_config import RequestIdFilter, configure_logging
from app.main import app
from app.middleware import BodySizeLimitMiddleware, BodyTooLargeError


def test_not_found_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/does-not-exist", headers={"X-Request-ID": "trace-123"})

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "not_found", "message": "Not Found", "request_id": "trace-123"}
    }
    assert response.headers["X-Request-ID"] == "trace-123"


def test_method_not_allowed_keeps_allow_header(client: TestClient) -> None:
    response = client.patch("/meals")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"
    assert "GET" in response.headers["Allow"]


def test_validation_error_envelope(client: TestClient) -> None:
    response = client.get("/meals", params={"date": "yesterday"})

    error = response.json()["error"]
    assert response.status_code == 422
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == ["query", "date"]
    assert error["request_id"] == response.headers["X-Request-ID"]


def test_malformed_json_body(client: TestClient) -> None:
    response = client.post(
        "/auth/login", content=b"{not json", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422


def test_generated_request_id_and_invalid_one_replaced(client: TestClient) -> None:
    generated = client.get("/health").headers["X-Request-ID"]
    replaced = client.get("/health", headers={"X-Request-ID": "bad id with spaces"}).headers[
        "X-Request-ID"
    ]

    assert len(generated) == 32
    assert replaced != "bad id with spaces"
    assert len(replaced) == 32


def test_security_headers(client: TestClient) -> None:
    headers = client.get("/health").headers

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "no-referrer"


def test_cors_allows_configured_origin_only(client: TestClient) -> None:
    allowed = client.options(
        "/meals",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    denied = client.get("/meals", headers={"Origin": "https://evil.example.com"})

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-origin" not in denied.headers


def test_oversized_body_rejected(client: TestClient, settings) -> None:
    payload = {"email": "a@b.co", "password": "x" * (settings.max_request_body_bytes + 10)}

    response = client.post("/auth/login", json=payload)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_streamed_body_over_limit_rejected() -> None:
    """Chunked bodies have no Content-Length, so the limit is enforced while reading."""
    reached_app: list[bool] = []

    async def downstream(scope, receive, send) -> None:
        while (await receive()).get("more_body"):
            pass
        reached_app.append(True)

    chunks: Iterator[Message] = iter(
        [{"type": "http.request", "body": b"x" * 1024, "more_body": True}] * 3
    )

    async def receive() -> Message:
        return next(chunks)

    async def send(_: Message) -> None:
        raise AssertionError("no response expected from the middleware itself")

    middleware = BodySizeLimitMiddleware(downstream, max_bytes=2048)
    scope = {"type": "http", "method": "POST", "path": "/", "headers": []}
    with pytest.raises(BodyTooLargeError):
        asyncio.run(middleware(scope, receive, send))
    assert reached_app == []


def test_unhandled_exception_returns_generic_500() -> None:
    boom_app: FastAPI = app

    @boom_app.get("/_test/boom", include_in_schema=False)
    def boom() -> None:
        raise RuntimeError("secret internals")

    with TestClient(boom_app, raise_server_exceptions=False) as client:
        response = client.get("/_test/boom", headers={"X-Request-ID": "boom-1"})

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "Internal server error",
            "request_id": "boom-1",
        }
    }
    assert "secret internals" not in response.text


def test_docs_served_by_default(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert "/meals/{meal_id}/ratings" in schema["paths"]
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"


# --- Settings ----------------------------------------------------------------------------------


def test_production_rejects_default_or_short_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(env="production", jwt_secret=DEV_JWT_SECRET)
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(env="production", jwt_secret="too-short")

    assert Settings(env="production", jwt_secret="x" * 32).is_production


def test_docs_only_disabled_in_production_when_opted_out() -> None:
    secret = "x" * 40
    assert Settings(env="production", jwt_secret=secret, docs_enabled=True).docs_available
    assert not Settings(env="production", jwt_secret=secret, docs_enabled=False).docs_available
    assert Settings(env="development", docs_enabled=False).docs_available


def test_settings_parse_cors_and_database_url() -> None:
    settings = Settings(
        cors_origins=" http://a.example , http://b.example,,",
        database_url="postgres://u:p@db:5432/x",
    )

    assert settings.cors_origins == ["http://a.example", "http://b.example"]
    assert settings.database_url == "postgresql+psycopg://u:p@db:5432/x"


def test_logs_are_json_with_request_id(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    record = logging.LogRecord("app.test", logging.INFO, __file__, 1, "hello", None, None)
    RequestIdFilter().filter(record)
    logging.getLogger().handlers[0].handle(record)
    configure_logging("WARNING")

    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert '"message": "hello"' in line
    assert '"level": "INFO"' in line
    assert '"request_id"' in line
    assert '"timestamp"' in line
