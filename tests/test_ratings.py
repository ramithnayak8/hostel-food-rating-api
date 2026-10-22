from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

RATING = {"score": 4, "taste": 5, "hygiene": 3, "quantity": 4, "comment": "Good dal"}


def _ratings_metric(meal_type: str) -> float:
    return REGISTRY.get_sample_value("ratings_submitted_total", {"meal_type": meal_type}) or 0.0


def test_student_rates_meal(client: TestClient, student_headers, make_meal: Callable) -> None:
    meal = make_meal(meal_type="dinner")
    before = _ratings_metric("dinner")

    response = client.post(f"/meals/{meal['id']}/ratings", json=RATING, headers=student_headers)

    assert response.status_code == 201
    body = response.json()
    assert {key: body[key] for key in RATING} == RATING
    assert body["meal_id"] == meal["id"]
    assert body["rated_by"] is None
    assert _ratings_metric("dinner") == before + 1


def test_duplicate_rating_conflicts(
    client: TestClient, student_headers, make_meal: Callable
) -> None:
    meal = make_meal()
    client.post(f"/meals/{meal['id']}/ratings", json=RATING, headers=student_headers)

    response = client.post(f"/meals/{meal['id']}/ratings", json=RATING, headers=student_headers)

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "You have already rated this meal"


def test_different_students_can_rate_same_meal(
    register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    meal = make_meal()

    rate(meal["id"], register_student())
    rate(meal["id"], register_student())


@pytest.mark.parametrize(
    "override",
    [
        {"score": 0},
        {"score": 6},
        {"taste": -1},
        {"hygiene": 10},
        {"quantity": 0},
        {"score": "4"},
        {"score": 4.5},
        {"comment": "x" * 501},
        {"score": None},
    ],
)
def test_rating_validation(
    client: TestClient, student_headers, make_meal: Callable, override: dict
) -> None:
    meal = make_meal()

    response = client.post(
        f"/meals/{meal['id']}/ratings", json=RATING | override, headers=student_headers
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_missing_fields_rejected(client: TestClient, student_headers, make_meal: Callable) -> None:
    meal = make_meal()

    response = client.post(
        f"/meals/{meal['id']}/ratings", json={"score": 3}, headers=student_headers
    )

    assert response.status_code == 422
    missing = {tuple(d["loc"]) for d in response.json()["error"]["details"]}
    assert missing == {("body", "taste"), ("body", "hygiene"), ("body", "quantity")}


def test_comment_at_limit_is_accepted(
    client: TestClient, student_headers, make_meal: Callable
) -> None:
    meal = make_meal()

    response = client.post(
        f"/meals/{meal['id']}/ratings",
        json=RATING | {"comment": "x" * 500},
        headers=student_headers,
    )

    assert response.status_code == 201


def test_rating_missing_meal(client: TestClient, student_headers) -> None:
    assert (
        client.post("/meals/9999/ratings", json=RATING, headers=student_headers).status_code == 404
    )


def test_rating_requires_auth(client: TestClient, make_meal: Callable) -> None:
    meal = make_meal()

    assert client.post(f"/meals/{meal['id']}/ratings", json=RATING).status_code == 401
    assert client.get(f"/meals/{meal['id']}/ratings").status_code == 401


def test_students_see_ratings_without_identity(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    meal = make_meal()
    viewer = register_student()
    rate(meal["id"], register_student(name="Ravi", room_no="C-101"), score=2)

    page = client.get(f"/meals/{meal['id']}/ratings", headers=viewer).json()

    assert page["total"] == 1
    assert page["items"][0]["rated_by"] is None
    assert "email" not in str(page)


def test_admin_sees_rater_name_and_room_but_not_email(
    client: TestClient,
    admin_headers,
    register_student: Callable,
    make_meal: Callable,
    rate: Callable,
) -> None:
    meal = make_meal()
    rate(meal["id"], register_student(name="Ravi", room_no="C-101"))

    page = client.get(f"/meals/{meal['id']}/ratings", headers=admin_headers).json()

    assert page["items"][0]["rated_by"] == {"name": "Ravi", "room_no": "C-101"}
    assert "hostel.example.com" not in str(page)


def test_list_ratings_paginates(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    meal = make_meal()
    students = [register_student() for _ in range(3)]
    for headers in students:
        rate(meal["id"], headers)

    page = client.get(
        f"/meals/{meal['id']}/ratings", params={"limit": 2, "offset": 2}, headers=students[0]
    ).json()

    assert page["total"] == 3
    assert len(page["items"]) == 1


def test_list_ratings_missing_meal(client: TestClient, student_headers) -> None:
    assert client.get("/meals/9999/ratings", headers=student_headers).status_code == 404


def test_rating_rate_limited(
    client: TestClient, student_headers, make_meal: Callable, settings
) -> None:
    settings.rate_limit_ratings = "2/minute"
    meals = [make_meal(meal_type=meal_type) for meal_type in ("breakfast", "lunch", "dinner")]

    statuses = [
        client.post(
            f"/meals/{meal['id']}/ratings", json=RATING, headers=student_headers
        ).status_code
        for meal in meals
    ]

    assert statuses == [201, 201, 429]
