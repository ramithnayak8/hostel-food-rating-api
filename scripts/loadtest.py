"""Locust load test: students browsing menus and stats, and rating meals.

    pip install -r requirements-loadtest.txt
    locust -f scripts/loadtest.py --host http://localhost:8000                    # web UI on :8089
    locust -f scripts/loadtest.py --host http://localhost:8000 --headless -u 50 -r 5 -t 2m

Every simulated user registers and logs in once, so raise the auth limit for big runs
(e.g. RATE_LIMIT_AUTH=1000/minute; the kind overlay already does). Seed data first
(`python -m scripts.seed_demo_data`) so there are meals to rate.
"""

import random
import time
import uuid

from locust import HttpUser, between, task


class Student(HttpUser):
    wait_time = between(0.5, 2.0)

    def on_start(self) -> None:
        email = f"load-{uuid.uuid4().hex[:12]}@hostel.example.com"
        password = "load-test-password"  # noqa: S105 - throwaway account
        self.client.post(
            "/auth/register",
            json={"name": "Load Tester", "email": email, "room_no": "L-1", "password": password},
            name="/auth/register",
        )
        self.headers: dict[str, str] = {}
        for _ in range(10):
            response = self.client.post(
                "/auth/login", json={"email": email, "password": password}, name="/auth/login"
            )
            if response.status_code == 200:
                self.headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
                return
            time.sleep(6)  # rate limited; wait for the window to move

    @task(5)
    def browse_meals(self) -> None:
        self.client.get("/meals?limit=20", name="/meals")

    @task(3)
    def daily_stats(self) -> None:
        self.client.get("/stats/daily", name="/stats/daily")

    @task(2)
    def weekly_stats(self) -> None:
        self.client.get("/stats/weekly", name="/stats/weekly")

    @task(2)
    def rate_a_meal(self) -> None:
        meals = self.client.get("/meals?limit=50", name="/meals").json().get("items", [])
        if not meals or not self.headers:
            return
        meal_id = random.choice(meals)["id"]
        score = random.randint(1, 5)
        with self.client.post(
            f"/meals/{meal_id}/ratings",
            json={"score": score, "taste": score, "hygiene": score, "quantity": score},
            headers=self.headers,
            name="/meals/{meal_id}/ratings",
            catch_response=True,
        ) as response:
            if response.status_code in (201, 409):  # 409: this user already rated it
                response.success()

    @task(1)
    def health(self) -> None:
        self.client.get("/health", name="/health")
