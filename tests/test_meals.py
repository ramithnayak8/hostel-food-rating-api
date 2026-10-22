import datetime as dt
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

MEAL = {"date": "2026-10-20", "meal_type": "lunch", "menu_items": ["Dal", "Rice"]}


def test_admin_creates_meal(client: TestClient, admin_headers) -> None:
    response = client.post("/meals", json=MEAL, headers=admin_headers)

    assert response.status_code == 201
    body = response.json()
    assert body["menu_items"] == ["Dal", "Rice"]
    assert body["flagged"] is False
    assert body["id"] > 0


def test_menu_items_are_trimmed_and_deduplicated(client: TestClient, admin_headers) -> None:
    payload = MEAL | {"menu_items": [" Dal ", "dal", "Rice"]}

    response = client.post("/meals", json=payload, headers=admin_headers)

    assert response.json()["menu_items"] == ["Dal", "Rice"]


def test_student_cannot_create_meal(client: TestClient, student_headers) -> None:
    response = client.post("/meals", json=MEAL, headers=student_headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_anonymous_cannot_create_meal(client: TestClient) -> None:
    assert client.post("/meals", json=MEAL).status_code == 401


def test_duplicate_date_and_type_conflicts(client: TestClient, admin_headers) -> None:
    client.post("/meals", json=MEAL, headers=admin_headers)

    response = client.post("/meals", json=MEAL, headers=admin_headers)

    assert response.status_code == 409
    assert "already exists" in response.json()["error"]["message"]


@pytest.mark.parametrize(
    "override",
    [
        {"menu_items": []},
        {"menu_items": [""]},
        {"meal_type": "brunch"},
        {"date": "20-10-2026"},
        {"unexpected": True},
    ],
)
def test_invalid_meal_payloads(client: TestClient, admin_headers, override: dict) -> None:
    response = client.post("/meals", json=MEAL | override, headers=admin_headers)

    assert response.status_code == 422


def test_list_meals_is_public_and_filters(client: TestClient, make_meal: Callable) -> None:
    make_meal(date=dt.date(2026, 10, 20), meal_type="breakfast")
    make_meal(date=dt.date(2026, 10, 20), meal_type="dinner")
    make_meal(date=dt.date(2026, 10, 21), meal_type="breakfast")

    everything = client.get("/meals").json()
    by_date = client.get("/meals", params={"date": "2026-10-20"}).json()
    by_both = client.get("/meals", params={"date": "2026-10-20", "meal_type": "dinner"}).json()

    assert everything["total"] == 3
    assert everything["items"][0]["date"] == "2026-10-21"  # newest first
    assert by_date["total"] == 2
    assert [meal["meal_type"] for meal in by_both["items"]] == ["dinner"]


def test_list_meals_paginates(client: TestClient, make_meal: Callable) -> None:
    for day in range(1, 6):
        make_meal(date=dt.date(2026, 10, day))

    page = client.get("/meals", params={"limit": 2, "offset": 2}).json()

    assert page["total"] == 5
    assert page["limit"] == 2
    assert page["offset"] == 2
    assert [meal["date"] for meal in page["items"]] == ["2026-10-03", "2026-10-02"]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
def test_pagination_bounds(client: TestClient, params: dict) -> None:
    assert client.get("/meals", params=params).status_code == 422


def test_get_meal_and_404(client: TestClient, make_meal: Callable) -> None:
    meal = make_meal()

    assert client.get(f"/meals/{meal['id']}").json() == meal
    missing = client.get("/meals/9999")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_admin_replaces_meal(client: TestClient, admin_headers, make_meal: Callable) -> None:
    meal = make_meal()
    replacement = {"date": "2026-10-21", "meal_type": "dinner", "menu_items": ["Biryani"]}

    response = client.put(f"/meals/{meal['id']}", json=replacement, headers=admin_headers)

    assert response.status_code == 200
    assert response.json() | {"created_at": None} == {
        "id": meal["id"],
        "flagged": False,
        "created_at": None,
        **replacement,
    }


def test_replace_into_existing_slot_conflicts(
    client: TestClient, admin_headers, make_meal: Callable
) -> None:
    make_meal(meal_type="lunch")
    dinner = make_meal(meal_type="dinner")

    response = client.put(
        f"/meals/{dinner['id']}",
        json={"date": "2026-10-20", "meal_type": "lunch", "menu_items": ["X"]},
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_replace_missing_meal(client: TestClient, admin_headers) -> None:
    assert client.put("/meals/9999", json=MEAL, headers=admin_headers).status_code == 404


def test_student_cannot_replace_or_delete(
    client: TestClient, student_headers, make_meal: Callable
) -> None:
    meal = make_meal()

    assert client.put(f"/meals/{meal['id']}", json=MEAL, headers=student_headers).status_code == 403
    assert client.delete(f"/meals/{meal['id']}", headers=student_headers).status_code == 403


def test_delete_meal_cascades_ratings(
    client: TestClient, admin_headers, student_headers, make_meal: Callable, rate: Callable, db
) -> None:
    from app.models import Rating

    meal = make_meal()
    rate(meal["id"], student_headers)

    response = client.delete(f"/meals/{meal['id']}", headers=admin_headers)

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/meals/{meal['id']}").status_code == 404
    assert db.query(Rating).count() == 0
    assert client.delete(f"/meals/{meal['id']}", headers=admin_headers).status_code == 404
