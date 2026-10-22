"""Fill the database with a week of demo meals, students and ratings. Safe to run repeatedly.

    python -m scripts.seed_demo_data [--days 7] [--students 12]

Students are seed-student-<n>@hostel.example.com with password "demo-password-123".
One meal (yesterday's snacks) is deliberately rated badly so the complaint flag shows up.
"""

import argparse
import datetime as dt
import random
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.database import SessionLocal
from app.models import Meal, MealType, Rating, User
from app.services import refresh_flag

DEMO_PASSWORD = "demo-password-123"  # noqa: S105 - public demo credential

MENUS: dict[MealType, list[list[str]]] = {
    MealType.breakfast: [["Poha", "Tea"], ["Idli", "Sambar", "Coffee"], ["Aloo paratha", "Curd"]],
    MealType.lunch: [["Dal tadka", "Jeera rice", "Roti"], ["Rajma", "Rice", "Salad"]],
    MealType.snacks: [["Samosa", "Tea"], ["Bread pakora", "Coffee"], ["Bhel puri"]],
    MealType.dinner: [
        ["Paneer butter masala", "Roti"],
        ["Chole", "Rice"],
        ["Veg biryani", "Raita"],
    ],
}
COMMENTS = [None, None, "Tasty!", "Too salty", "Portion was small", "Cold when served", "Loved it"]


def ensure_students(db: Session, count: int) -> list[User]:
    password_hash = hash_password(DEMO_PASSWORD)
    students = []
    for n in range(1, count + 1):
        email = f"seed-student-{n}@hostel.example.com"
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                name=f"Student {n}",
                email=email,
                room_no=f"A-{100 + n}",
                password_hash=password_hash,
            )
            db.add(user)
        students.append(user)
    db.flush()
    return students


def ensure_meal(db: Session, day: dt.date, meal_type: MealType, rng: random.Random) -> Meal:
    menu = rng.choice(MENUS[meal_type])  # drawn even if unused, so the RNG stream stays stable
    meal = db.scalar(select(Meal).where(Meal.date == day, Meal.meal_type == meal_type))
    if meal is None:
        meal = Meal(date=day, meal_type=meal_type, menu_items=menu)
        db.add(meal)
        db.flush()
    return meal


def rate_meal(db: Session, meal: Meal, students: list[User], rng: random.Random, bad: bool) -> int:
    already = set(db.scalars(select(Rating.user_id).where(Rating.meal_id == meal.id)))
    added = 0
    for student in rng.sample(students, k=rng.randint(len(students) // 2, len(students))):
        if student.id in already:
            continue
        base = rng.randint(1, 2) if bad else rng.randint(2, 5)
        db.add(
            Rating(
                user_id=student.id,
                meal_id=meal.id,
                score=base,
                taste=max(1, min(5, base + rng.randint(-1, 1))),
                hygiene=max(1, min(5, base + rng.randint(-1, 1))),
                quantity=max(1, min(5, base + rng.randint(-1, 1))),
                comment=rng.choice(COMMENTS),
            )
        )
        added += 1
    db.flush()
    refresh_flag(db, meal)
    return added


def seed(days: int, student_count: int, seed_value: int = 42) -> tuple[int, int]:
    today = dt.datetime.now(dt.UTC).date()
    bad_meal = (today - dt.timedelta(days=1), MealType.snacks)
    meals = ratings = 0
    with SessionLocal() as db:
        students = ensure_students(db, student_count)
        for offset in range(days - 1, -1, -1):
            day = today - dt.timedelta(days=offset)
            for meal_type in MealType:
                # One RNG per meal, so reruns make the same choices and add nothing new.
                rng = random.Random(f"{seed_value}-{day}-{meal_type}")
                meal = ensure_meal(db, day, meal_type, rng)
                ratings += rate_meal(db, meal, students, rng, bad=(day, meal_type) == bad_meal)
                meals += 1
        db.commit()
    return meals, ratings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--students", type=int, default=12)
    args = parser.parse_args(argv)
    meals, ratings = seed(args.days, args.students)
    print(f"seeded {meals} meals and {ratings} new ratings; student password: {DEMO_PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
