"""Test fixtures.

Uses the database in DATABASE_URL (CI points it at a Postgres service container). When the
variable is unset, falls back to in-memory SQLite so `pytest` works instantly on a laptop.
"""

import datetime as dt
import os
from collections.abc import Callable, Iterator

# Must happen before the app is imported: settings and the engine are built at import time.
# Real environment variables beat .env, so a developer's .env can't redirect the tests.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite://")
os.environ["ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-that-is-long-enough-for-hs256-0123456789"
os.environ["RATE_LIMIT_ENABLED"] = "true"
os.environ["RATE_LIMIT_AUTH"] = "1000/minute"
os.environ["RATE_LIMIT_RATINGS"] = "1000/minute"
os.environ["RATE_LIMIT_STORAGE_URI"] = "memory://"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ["LOG_LEVEL"] = "WARNING"

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import auth
from app.config import Settings, get_settings
from app.database import Base, SessionLocal, engine
from app.deps import limiter
from app.main import app
from app.models import Role, User

# Cheap argon2 parameters keep the suite fast; production uses the library defaults.
auth.password_hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)

STUDENT_PASSWORD = "student-pass-123"
ADMIN_EMAIL = "warden@hostel.example.com"
ADMIN_PASSWORD = "admin-pass-123"

Headers = dict[str, str]


@pytest.fixture(autouse=True)
def _fresh_schema() -> Iterator[None]:
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def _reset_rate_limits() -> Iterator[None]:
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def settings() -> Iterator[Settings]:
    """The live settings object; tests may tweak it, changes are undone afterwards."""
    current = get_settings()
    snapshot = current.model_dump()
    yield current
    for field, value in snapshot.items():
        setattr(current, field, value)


@pytest.fixture
def db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def bearer(token: str) -> Headers:
    return {"Authorization": f"Bearer {token}"}


def login(client: TestClient, email: str, password: str) -> Headers:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return bearer(response.json()["access_token"])


@pytest.fixture
def register_student(client: TestClient) -> Callable[..., Headers]:
    """Register a student and return auth headers for them."""
    counter = iter(range(1, 1000))

    def _register(
        email: str | None = None, name: str = "Asha Rao", room_no: str = "B-204"
    ) -> Headers:
        email = email or f"student{next(counter)}@hostel.example.com"
        response = client.post(
            "/auth/register",
            json={"name": name, "email": email, "room_no": room_no, "password": STUDENT_PASSWORD},
        )
        assert response.status_code == 201, response.text
        return login(client, email, STUDENT_PASSWORD)

    return _register


@pytest.fixture
def student_headers(register_student: Callable[..., Headers]) -> Headers:
    return register_student()


@pytest.fixture
def admin_headers(client: TestClient, db: Session) -> Headers:
    db.add(
        User(
            name="Hostel Warden",
            email=ADMIN_EMAIL,
            room_no="Office",
            role=Role.admin,
            password_hash=auth.hash_password(ADMIN_PASSWORD),
        )
    )
    db.commit()
    return login(client, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture
def make_meal(client: TestClient, admin_headers: Headers) -> Callable[..., dict]:
    def _make(
        date: dt.date | None = None,
        meal_type: str = "lunch",
        menu: list[str] | None = None,
    ) -> dict:
        response = client.post(
            "/meals",
            json={
                "date": str(date or dt.date(2026, 10, 20)),
                "meal_type": meal_type,
                "menu_items": menu or ["Dal", "Rice", "Roti"],
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def rate(client: TestClient) -> Callable[..., dict]:
    def _rate(meal_id: int, headers: Headers, score: int = 4, **overrides: object) -> dict:
        body = {"score": score, "taste": score, "hygiene": score, "quantity": score} | overrides
        response = client.post(f"/meals/{meal_id}/ratings", json=body, headers=headers)
        assert response.status_code == 201, response.text
        return response.json()

    return _rate
