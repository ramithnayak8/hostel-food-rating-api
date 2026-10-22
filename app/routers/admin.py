"""Admin-only views."""

from fastapi import APIRouter

from app.auth import AdminUser
from app.deps import DbSession
from app.routers.meals import ADMIN_ONLY
from app.schemas import FlaggedMeal
from app.services import flagged_meal_stats

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/flagged-meals",
    response_model=list[FlaggedMeal],
    summary="Meals flagged for complaints",
    responses=ADMIN_ONLY,
)
def list_flagged_meals(db: DbSession, _: AdminUser) -> list[FlaggedMeal]:
    """Meals whose average score fell below `FLAG_THRESHOLD` with at least `FLAG_MIN_RATINGS`
    ratings, newest first."""
    return [FlaggedMeal(**stats.model_dump()) for stats in flagged_meal_stats(db)]
