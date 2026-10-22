import datetime as dt
from collections.abc import Callable

from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

DAY = dt.date(2026, 10, 20)


def test_daily_stats_math(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    lunch = make_meal(date=DAY, meal_type="lunch")
    breakfast = make_meal(date=DAY, meal_type="breakfast")
    make_meal(date=DAY + dt.timedelta(days=1), meal_type="lunch")  # other day: excluded
    first, second, third = (register_student() for _ in range(3))
    rate(lunch["id"], first, score=5, taste=4, hygiene=3, quantity=2)
    rate(lunch["id"], second, score=4, taste=4, hygiene=4, quantity=4)
    rate(lunch["id"], third, score=4, taste=5, hygiene=2, quantity=3)

    body = client.get("/stats/daily", params={"date": str(DAY)}).json()

    assert body["date"] == str(DAY)
    assert [meal["meal_type"] for meal in body["meals"]] == ["breakfast", "lunch"]
    unrated, rated = body["meals"]
    assert unrated["meal_id"] == breakfast["id"]
    assert unrated["rating_count"] == 0
    assert unrated["avg_score"] is None
    assert rated["rating_count"] == 3
    assert rated["avg_score"] == 4.33
    assert rated["avg_taste"] == 4.33
    assert rated["avg_hygiene"] == 3.0
    assert rated["avg_quantity"] == 3.0


def test_daily_stats_defaults_to_today(client: TestClient) -> None:
    body = client.get("/stats/daily").json()

    assert body["date"] == str(dt.datetime.now(dt.UTC).date())
    assert body["meals"] == []


def test_weekly_stats_empty_window(client: TestClient) -> None:
    body = client.get("/stats/weekly", params={"end_date": str(DAY)}).json()

    assert body["start_date"] == "2026-10-14"
    assert len(body["days"]) == 7
    assert all(day["rating_count"] == 0 and day["avg_score"] is None for day in body["days"])
    assert body["best_dish"] is None
    assert body["worst_dish"] is None
    assert body["top_meals"] == body["bottom_meals"] == []


def test_weekly_trend_dishes_and_rankings(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    alice, bob = register_student(), register_student()
    monday = make_meal(date=DAY - dt.timedelta(days=2), meal_type="lunch", menu=["Dal", "Rice"])
    tuesday = make_meal(
        date=DAY - dt.timedelta(days=1), meal_type="dinner", menu=["Paneer", "rice"]
    )
    today = make_meal(date=DAY, meal_type="breakfast", menu=["Poha"])
    stale = make_meal(date=DAY - dt.timedelta(days=7), menu=["Old dish"])  # outside the window
    rate(monday["id"], alice, score=2)
    rate(monday["id"], bob, score=4)
    rate(tuesday["id"], alice, score=5)
    rate(today["id"], alice, score=1)
    rate(stale["id"], alice, score=5)

    body = client.get("/stats/weekly", params={"end_date": str(DAY)}).json()

    trend = {day["date"]: day for day in body["days"]}
    assert trend[str(DAY - dt.timedelta(days=2))] == {
        "date": str(DAY - dt.timedelta(days=2)),
        "rating_count": 2,
        "avg_score": 3.0,
    }
    assert trend[str(DAY)]["avg_score"] == 1.0
    assert trend[str(DAY - dt.timedelta(days=6))]["rating_count"] == 0
    # Rice appears on Monday (2, 4) and Tuesday as "rice" (5): mean of 2, 4, 5.
    assert body["best_dish"] == {"name": "Paneer", "avg_score": 5.0, "rating_count": 1}
    assert body["worst_dish"] == {"name": "Poha", "avg_score": 1.0, "rating_count": 1}
    assert [meal["meal_id"] for meal in body["top_meals"]] == [
        tuesday["id"],
        monday["id"],
        today["id"],
    ]
    assert [meal["meal_id"] for meal in body["bottom_meals"]] == [
        today["id"],
        monday["id"],
        tuesday["id"],
    ]


def test_weekly_dish_names_merge_case_insensitively(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    student = register_student()
    first = make_meal(date=DAY - dt.timedelta(days=1), menu=["Rice"])
    second = make_meal(date=DAY, menu=["RICE", "Curd"])
    rate(first["id"], student, score=2)
    rate(second["id"], student, score=5)

    body = client.get("/stats/weekly", params={"end_date": str(DAY)}).json()

    assert body["best_dish"] == {"name": "Curd", "avg_score": 5.0, "rating_count": 1}
    assert body["worst_dish"] == {"name": "Rice", "avg_score": 3.5, "rating_count": 2}


# --- Complaint flag ----------------------------------------------------------------------------


def _flag_metric(meal_type: str) -> float:
    return REGISTRY.get_sample_value("meals_flagged_total", {"meal_type": meal_type}) or 0.0


def test_meal_flagged_after_three_low_ratings(
    client: TestClient,
    admin_headers,
    register_student: Callable,
    make_meal: Callable,
    rate: Callable,
) -> None:
    meal = make_meal(meal_type="snacks")
    before = _flag_metric("snacks")
    rate(meal["id"], register_student(), score=1)
    rate(meal["id"], register_student(), score=2)
    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is False  # only 2 ratings

    rate(meal["id"], register_student(), score=2)  # avg 1.67 over 3 ratings

    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is True
    flagged = client.get("/admin/flagged-meals", headers=admin_headers).json()
    assert [(m["meal_id"], m["rating_count"], m["avg_score"]) for m in flagged] == [
        (meal["id"], 3, 1.67)
    ]
    assert _flag_metric("snacks") == before + 1
    assert "flagged_meals 1.0" in client.get("/metrics").text


def test_average_of_exactly_threshold_is_not_flagged(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    meal = make_meal()
    for score in (1, 2, 3):  # avg 2.0, not below 2.0
        rate(meal["id"], register_student(), score=score)

    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is False


def test_flag_clears_when_average_recovers(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable
) -> None:
    meal = make_meal()
    for _ in range(3):
        rate(meal["id"], register_student(), score=1)
    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is True

    for _ in range(3):
        rate(meal["id"], register_student(), score=5)  # avg 3.0

    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is False


def test_flag_respects_configured_thresholds(
    client: TestClient, register_student: Callable, make_meal: Callable, rate: Callable, settings
) -> None:
    settings.flag_min_ratings = 1
    settings.flag_threshold = 3.0
    meal = make_meal()

    rate(meal["id"], register_student(), score=2)

    assert client.get(f"/meals/{meal['id']}").json()["flagged"] is True


def test_flagged_meals_is_admin_only(client: TestClient, student_headers) -> None:
    assert client.get("/admin/flagged-meals").status_code == 401
    assert client.get("/admin/flagged-meals", headers=student_headers).status_code == 403
