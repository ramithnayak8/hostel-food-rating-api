import datetime as dt

import jwt
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User
from tests.conftest import STUDENT_PASSWORD, bearer, login

REGISTRATION = {
    "name": "Asha Rao",
    "email": "Asha@Hostel.Example.com",
    "room_no": "B-204",
    "password": STUDENT_PASSWORD,
}


def test_register_creates_student_with_normalized_email(client: TestClient) -> None:
    response = client.post("/auth/register", json=REGISTRATION)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "asha@hostel.example.com"
    assert body["role"] == "student"
    assert body["is_active"] is True
    assert "password" not in body
    assert "password_hash" not in body


def test_register_duplicate_email_is_case_insensitive(client: TestClient) -> None:
    client.post("/auth/register", json=REGISTRATION)

    response = client.post(
        "/auth/register", json=REGISTRATION | {"email": "ASHA@hostel.example.com"}
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_register_cannot_self_assign_admin(client: TestClient, db: Session) -> None:
    response = client.post("/auth/register", json=REGISTRATION | {"role": "admin"})

    assert response.status_code == 422
    assert db.scalar(select(User)) is None


def test_register_enforces_password_policy(client: TestClient) -> None:
    response = client.post("/auth/register", json=REGISTRATION | {"password": "short"})

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "password"]


def test_register_rejects_invalid_email(client: TestClient) -> None:
    response = client.post("/auth/register", json=REGISTRATION | {"email": "not-an-email"})

    assert response.status_code == 422


def test_login_returns_working_token(client: TestClient) -> None:
    client.post("/auth/register", json=REGISTRATION)

    response = client.post(
        "/auth/login", json={"email": "ASHA@hostel.example.com", "password": STUDENT_PASSWORD}
    )

    assert response.status_code == 200
    token = response.json()
    assert token["token_type"] == "bearer"
    assert token["expires_in"] == 3600
    me = client.get("/auth/me", headers=bearer(token["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == "asha@hostel.example.com"


def test_login_errors_do_not_reveal_which_part_was_wrong(client: TestClient) -> None:
    client.post("/auth/register", json=REGISTRATION)

    wrong_password = client.post(
        "/auth/login", json={"email": REGISTRATION["email"], "password": "wrong-password"}
    )
    unknown_email = client.post(
        "/auth/login", json={"email": "nobody@hostel.example.com", "password": "whatever-123"}
    )

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["error"]["message"] == "Invalid credentials"
    assert unknown_email.json()["error"]["message"] == "Invalid credentials"


def test_inactive_user_cannot_log_in_or_use_token(client: TestClient, db: Session) -> None:
    client.post("/auth/register", json=REGISTRATION)
    headers = login(client, REGISTRATION["email"], STUDENT_PASSWORD)
    user = db.scalar(select(User))
    user.is_active = False
    db.commit()

    assert client.get("/auth/me", headers=headers).status_code == 401
    response = client.post(
        "/auth/login", json={"email": REGISTRATION["email"], "password": STUDENT_PASSWORD}
    )
    assert response.status_code == 401


def test_protected_route_requires_token(client: TestClient) -> None:
    response = client.get("/auth/me")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"]["message"] == "Not authenticated"


def test_tampered_and_expired_tokens_are_rejected(client: TestClient, settings) -> None:
    client.post("/auth/register", json=REGISTRATION)
    token = login(client, REGISTRATION["email"], STUDENT_PASSWORD)["Authorization"].split()[1]

    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    past = dt.datetime.now(dt.UTC) - dt.timedelta(hours=2)
    expired = jwt.encode(
        {"sub": "1", "role": "student", "iat": past, "exp": past + dt.timedelta(minutes=5)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    wrong_key = jwt.encode(
        {"sub": "1", "role": "admin", "iat": dt.datetime.now(dt.UTC), "exp": 9999999999},
        "some-other-secret-that-is-also-long-enough",
        algorithm="HS256",
    )

    for bad in (tampered, expired, wrong_key, "not-a-jwt"):
        assert client.get("/auth/me", headers=bearer(bad)).status_code == 401


def test_token_for_deleted_user_is_rejected(client: TestClient, db: Session) -> None:
    client.post("/auth/register", json=REGISTRATION)
    headers = login(client, REGISTRATION["email"], STUDENT_PASSWORD)
    db.delete(db.scalar(select(User)))
    db.commit()

    assert client.get("/auth/me", headers=headers).status_code == 401


def test_login_upgrades_outdated_password_hash(client: TestClient, db: Session) -> None:
    client.post("/auth/register", json=REGISTRATION)
    user = db.scalar(select(User))
    weaker = PasswordHasher(time_cost=1, memory_cost=512, parallelism=1)
    user.password_hash = weaker.hash(STUDENT_PASSWORD)
    db.commit()

    login(client, REGISTRATION["email"], STUDENT_PASSWORD)

    db.refresh(user)
    assert "m=1024" in user.password_hash  # rehashed with the current parameters
    assert login(client, REGISTRATION["email"], STUDENT_PASSWORD)


def test_corrupted_password_hash_fails_closed(client: TestClient, db: Session) -> None:
    client.post("/auth/register", json=REGISTRATION)
    user = db.scalar(select(User))
    user.password_hash = "not-an-argon2-hash"
    db.commit()

    response = client.post(
        "/auth/login", json={"email": REGISTRATION["email"], "password": STUDENT_PASSWORD}
    )

    assert response.status_code == 401


def test_login_rate_limited(client: TestClient, settings) -> None:
    settings.rate_limit_auth = "3/minute"
    body = {"email": "nobody@hostel.example.com", "password": "whatever-123"}

    statuses = [client.post("/auth/login", json=body).status_code for _ in range(4)]

    assert statuses == [401, 401, 401, 429]
    limited = client.post("/auth/login", json=body)
    assert limited.json()["error"]["code"] == "rate_limited"
    assert limited.headers["Retry-After"] == "60"
