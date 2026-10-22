"""Rating meals. One rating per user per meal."""

import logging

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.auth import CurrentUser
from app.deps import DbSession, PageParams, limiter, ratings_rate_limit
from app.metrics import MEALS_FLAGGED, RATINGS_SUBMITTED
from app.models import Rating, Role
from app.routers.meals import NOT_FOUND, get_meal_or_404
from app.schemas import ErrorResponse, Page, Rater, RatingCreate, RatingOut
from app.services import refresh_flag

logger = logging.getLogger("app.ratings")

router = APIRouter(prefix="/meals/{meal_id}/ratings", tags=["ratings"])


@router.post(
    "",
    response_model=RatingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Rate a meal",
    responses={
        **NOT_FOUND,
        409: {"model": ErrorResponse, "description": "Already rated"},
        429: {"model": ErrorResponse, "description": "Too many ratings"},
    },
)
@limiter.limit(ratings_rate_limit)
def rate_meal(
    request: Request, meal_id: int, payload: RatingCreate, db: DbSession, user: CurrentUser
) -> Rating:
    """Submit your rating: overall `score` plus `taste`, `hygiene` and `quantity`, each 1-5,
    and an optional comment (max 500 chars). Each user can rate a meal once.

    If the meal ends up with at least `FLAG_MIN_RATINGS` ratings averaging below
    `FLAG_THRESHOLD`, it is flagged for the warden.
    """
    meal = get_meal_or_404(db, meal_id)
    rating = Rating(user_id=user.id, meal_id=meal.id, **payload.model_dump())
    db.add(rating)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You have already rated this meal") from None

    newly_flagged = refresh_flag(db, meal)
    db.commit()
    db.refresh(rating)

    RATINGS_SUBMITTED.labels(meal_type=meal.meal_type.value).inc()
    if newly_flagged:
        MEALS_FLAGGED.labels(meal_type=meal.meal_type.value).inc()
        logger.warning("meal flagged", extra={"meal_id": meal.id, "meal_type": meal.meal_type})
    return rating


@router.get(
    "",
    response_model=Page[RatingOut],
    summary="List a meal's ratings",
    responses=NOT_FOUND,
)
def list_ratings(
    meal_id: int, db: DbSession, user: CurrentUser, page: PageParams
) -> Page[RatingOut]:
    """Ratings for one meal, newest first. Admins also see each rater's name and room;
    nobody sees email addresses."""
    get_meal_or_404(db, meal_id)
    total = db.scalar(select(func.count(Rating.id)).where(Rating.meal_id == meal_id)) or 0
    ratings = db.scalars(
        select(Rating)
        .options(joinedload(Rating.user))
        .where(Rating.meal_id == meal_id)
        .order_by(Rating.created_at.desc(), Rating.id.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()

    show_rater = user.role == Role.admin
    items = []
    for rating in ratings:
        item = RatingOut.model_validate(rating)
        if show_rater:
            item.rated_by = Rater(name=rating.user.name, room_no=rating.user.room_no)
        items.append(item)
    return Page[RatingOut](items=items, total=total, limit=page.limit, offset=page.offset)
