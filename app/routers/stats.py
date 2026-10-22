"""Aggregated rating statistics."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import DbSession
from app.schemas import DailyStats, WeeklyStats
from app.services import daily_stats, weekly_stats

router = APIRouter(prefix="/stats", tags=["stats"])


def _today() -> dt.date:
    return dt.datetime.now(dt.UTC).date()


@router.get("/daily", response_model=DailyStats, summary="Per-meal averages for one day")
def get_daily_stats(
    db: DbSession,
    date: Annotated[
        dt.date | None, Query(description="Day to report (default: today, UTC)")
    ] = None,
) -> DailyStats:
    """For every meal on `date`: rating count and average score, taste, hygiene and quantity
    (rounded to 2 decimals; null when a meal has no ratings yet)."""
    day = date or _today()
    return DailyStats(date=day, meals=daily_stats(db, day))


@router.get("/weekly", response_model=WeeklyStats, summary="7-day trend and best/worst dishes")
def get_weekly_stats(
    db: DbSession,
    end_date: Annotated[
        dt.date | None, Query(description="Last day of the 7-day window (default: today, UTC)")
    ] = None,
) -> WeeklyStats:
    """Seven days ending at `end_date`:

    * **days** - per-day rating count and average score (every day present, null when unrated)
    * **best_dish / worst_dish** - every rating's score is credited to each menu item of the
      rated meal; a dish's average is the mean of those credits across the window (names are
      matched case-insensitively). Ties go to the dish with more ratings.
    * **top_meals / bottom_meals** - up to 3 rated meals with the highest / lowest average score.
    """
    return weekly_stats(db, end_date or _today())
