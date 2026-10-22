import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app import __version__
from app.database import Base, engine
from app.routers import health


def test_liveness(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_readiness_when_database_up(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "up"}


def test_readiness_returns_503_when_database_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_execute(*_: object, **__: object) -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr("sqlalchemy.orm.Session.execute", broken_execute)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "down"}


def test_liveness_does_not_need_database(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "database_is_up", lambda _: pytest.fail("touched the DB"))

    assert client.get("/health").status_code == 200


def test_metrics_exposes_http_and_custom_metrics(client: TestClient) -> None:
    client.get("/meals")

    body = client.get("/metrics").text

    assert 'http_requests_total{handler="/meals",method="GET",status="200"}' in body
    assert "http_request_duration_highr_seconds_bucket" in body
    assert "http_requests_inprogress" in body
    assert "database_up 1.0" in body
    assert "flagged_meals 0.0" in body
    assert f'app_info{{env="test",version="{__version__}"}} 1.0' in body
    assert 'handler="/metrics"' not in body
    assert 'handler="/health"' not in body


def test_metrics_report_database_down(client: TestClient) -> None:
    Base.metadata.drop_all(engine)  # the collector's query now fails
    try:
        body = client.get("/metrics").text
    finally:
        Base.metadata.create_all(engine)

    assert "database_up 0.0" in body
    assert "flagged_meals " not in body


def test_metrics_needs_no_auth_and_is_not_rate_limited(client: TestClient, settings) -> None:
    settings.rate_limit_auth = "1/minute"
    settings.rate_limit_ratings = "1/minute"

    assert all(client.get("/metrics").status_code == 200 for _ in range(5))
