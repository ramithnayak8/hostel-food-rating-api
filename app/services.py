"""Business logic shared by the routers: aggregates and the complaint flag."""

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, Row, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Meal, MealType, Rating
from app.schemas import DayTrend, DishStats, MealStats, WeeklyStats

MEAL_ORDER = {meal_type: index for index, meal_type in enumerate(MealType)}
WEEK_DAYS = 7
TOP_N = 3


def _round(value: float | None) -> float | None:
    return None if value is None else round(float(value), 2)


def refresh_flag(db: Session, meal: Meal) -> bool:
    """Recompute `meal.flagged`; return True if the meal has just become flagged.

    The flag clears again if later ratings lift the average back over the threshold.
    """
    settings = get_settings()
    count, average = db.execute(
        select(func.count(Rating.id), func.avg(Rating.score)).where(Rating.meal_id == meal.id)
    ).one()
    should_flag = (
        count >= settings.flag_min_ratings
        and average is not None
        and float(average) < settings.flag_threshold
    )
    newly_flagged = should_flag and not meal.flagged
    meal.flagged = should_flag
    return newly_flagged


def _meal_stats_rows(db: Session, *conditions: ColumnElement[bool]) -> Sequence[Row]:
    statement = (
        select(
            Meal,
            func.count(Rating.id).label("rating_count"),
            func.sum(Rating.score).label("score_sum"),
            func.avg(Rating.score).label("avg_score"),
            func.avg(Rating.taste).label("avg_taste"),
            func.avg(Rating.hygiene).label("avg_hygiene"),
            func.avg(Rating.quantity).label("avg_quantity"),
        )
        .outerjoin(Rating, Rating.meal_id == Meal.id)
        .where(*conditions)
        .group_by(Meal.id)
    )
    return db.execute(statement).all()


def _to_meal_stats(row: Row) -> MealStats:
    meal: Meal = row.Meal
    return MealStats(
        meal_id=meal.id,
        date=meal.date,
        meal_type=meal.meal_type,
        menu_items=meal.menu_items,
        rating_count=row.rating_count,
        avg_score=_round(row.avg_score),
        avg_taste=_round(row.avg_taste),
        avg_hygiene=_round(row.avg_hygiene),
        avg_quantity=_round(row.avg_quantity),
        flagged=meal.flagged,
    )


def _chronological(stats: MealStats) -> tuple[dt.date, int]:
    return stats.date, MEAL_ORDER[stats.meal_type]


def daily_stats(db: Session, day: dt.date) -> list[MealStats]:
    rows = _meal_stats_rows(db, Meal.date == day)
    return sorted((_to_meal_stats(row) for row in rows), key=_chronological)


def flagged_meal_stats(db: Session) -> list[MealStats]:
    rows = _meal_stats_rows(db, Meal.flagged.is_(True))
    return sorted((_to_meal_stats(row) for row in rows), key=_chronological, reverse=True)


@dataclass
class _DishTally:
    name: str
    score_sum: int = 0
    rating_count: int = 0

    def stats(self) -> DishStats:
        return DishStats(
            name=self.name,
            avg_score=round(self.score_sum / self.rating_count, 2),
            rating_count=self.rating_count,
        )


def _tally_dishes(rows: Sequence[Row]) -> list[DishStats]:
    """Credit every rating's score to each menu item of the rated meal (names case-insensitive)."""
    tallies: dict[str, _DishTally] = {}
    for row in rows:
        if not row.rating_count:
            continue
        for item in row.Meal.menu_items:
            tally = tallies.setdefault(item.casefold(), _DishTally(name=item))
            tally.score_sum += row.score_sum
            tally.rating_count += row.rating_count
    return [tally.stats() for tally in tallies.values()]


def _day_trend(db: Session, start: dt.date, end: dt.date) -> list[DayTrend]:
    rows = db.execute(
        select(Meal.date, func.count(Rating.id), func.avg(Rating.score))
        .join(Rating, Rating.meal_id == Meal.id)
        .where(Meal.date.between(start, end))
        .group_by(Meal.date)
    ).all()
    by_day = {day: (count, average) for day, count, average in rows}
    trend = []
    for offset in range(WEEK_DAYS):
        day = start + dt.timedelta(days=offset)
        count, average = by_day.get(day, (0, None))
        trend.append(DayTrend(date=day, rating_count=count, avg_score=_round(average)))
    return trend


def weekly_stats(db: Session, end: dt.date) -> WeeklyStats:
    start = end - dt.timedelta(days=WEEK_DAYS - 1)
    rows = _meal_stats_rows(db, Meal.date.between(start, end))

    dishes = _tally_dishes(rows)
    best = max(dishes, key=lambda d: (d.avg_score, d.rating_count), default=None)
    worst = min(dishes, key=lambda d: (d.avg_score, -d.rating_count), default=None)

    rated = [_to_meal_stats(row) for row in rows if row.rating_count]
    top = sorted(rated, key=lambda m: (-(m.avg_score or 0), -m.rating_count, _chronological(m)))
    bottom = sorted(rated, key=lambda m: (m.avg_score or 0, -m.rating_count, _chronological(m)))

    return WeeklyStats(
        start_date=start,
        end_date=end,
        days=_day_trend(db, start, end),
        best_dish=best,
        worst_dish=worst,
        top_meals=top[:TOP_N],
        bottom_meals=bottom[:TOP_N],
    )
