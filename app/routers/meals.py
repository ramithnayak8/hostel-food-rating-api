"""Meal menus. Anyone can read; only admins can write."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import AdminUser
from app.deps import DbSession, PageParams
from app.models import Meal, MealType
from app.schemas import ErrorResponse, MealCreate, MealOut, Page

router = APIRouter(prefix="/meals", tags=["meals"])

NOT_FOUND = {404: {"model": ErrorResponse, "description": "Meal not found"}}
CONFLICT = {409: {"model": ErrorResponse, "description": "Meal already exists for date + type"}}
ADMIN_ONLY = {
    401: {"model": ErrorResponse, "description": "Not authenticated"},
    403: {"model": ErrorResponse, "description": "Admin access required"},
}


def get_meal_or_404(db: Session, meal_id: int) -> Meal:
    meal = db.get(Meal, meal_id)
    if meal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meal not found")
    return meal


def _commit_or_conflict(db: Session, payload: MealCreate) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A {payload.meal_type} meal already exists for {payload.date}",
        ) from None


@router.get("", response_model=Page[MealOut], summary="List meals")
def list_meals(
    db: DbSession,
    page: PageParams,
    date: Annotated[dt.date | None, Query(description="Only meals on this day")] = None,
    meal_type: Annotated[MealType | None, Query(description="Only this meal type")] = None,
) -> Page[MealOut]:
    """List meals, newest first. Filter by `date` and/or `meal_type`; paginate with
    `limit` (max 100) and `offset`."""
    statement = select(Meal)
    if date is not None:
        statement = statement.where(Meal.date == date)
    if meal_type is not None:
        statement = statement.where(Meal.meal_type == meal_type)

    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    meals = db.scalars(
        statement.order_by(Meal.date.desc(), Meal.id.desc()).limit(page.limit).offset(page.offset)
    ).all()
    return Page[MealOut](
        items=[MealOut.model_validate(meal) for meal in meals],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )


@router.post(
    "",
    response_model=MealOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a meal (admin)",
    responses={**ADMIN_ONLY, **CONFLICT},
)
def create_meal(payload: MealCreate, db: DbSession, _: AdminUser) -> Meal:
    """Publish the menu for one meal. There can only be one meal per (date, meal_type)."""
    meal = Meal(**payload.model_dump())
    db.add(meal)
    _commit_or_conflict(db, payload)
    db.refresh(meal)
    return meal


@router.get("/{meal_id}", response_model=MealOut, summary="Get a meal", responses=NOT_FOUND)
def get_meal(meal_id: int, db: DbSession) -> Meal:
    """Fetch one meal by ID."""
    return get_meal_or_404(db, meal_id)


@router.put(
    "/{meal_id}",
    response_model=MealOut,
    summary="Replace a meal (admin)",
    responses={**ADMIN_ONLY, **NOT_FOUND, **CONFLICT},
)
def replace_meal(meal_id: int, payload: MealCreate, db: DbSession, _: AdminUser) -> Meal:
    """Replace a meal's date, type and menu. Existing ratings are kept."""
    meal = get_meal_or_404(db, meal_id)
    for field, value in payload.model_dump().items():
        setattr(meal, field, value)
    _commit_or_conflict(db, payload)
    return meal


@router.delete(
    "/{meal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete a meal (admin)",
    responses={**ADMIN_ONLY, **NOT_FOUND},
)
def delete_meal(meal_id: int, db: DbSession, _: AdminUser) -> Response:
    """Delete a meal and, via ON DELETE CASCADE, all of its ratings."""
    db.delete(get_meal_or_404(db, meal_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
