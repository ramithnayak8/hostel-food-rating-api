"""Registration, login and the current user."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import contains_eager

from app.auth import CurrentUser, authenticate, create_access_token, hash_password
from app.deps import DbSession, PageParams, auth_rate_limit, limiter
from app.models import Meal, Rating, Role, User
from app.schemas import (
    ErrorResponse,
    LoginRequest,
    MyRating,
    Page,
    Token,
    UserCreate,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

RATE_LIMITED = {429: {"model": ErrorResponse, "description": "Too many attempts"}}


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a student account",
    responses={409: {"model": ErrorResponse, "description": "Email taken"}, **RATE_LIMITED},
)
@limiter.limit(auth_rate_limit)
def register(request: Request, payload: UserCreate, db: DbSession) -> User:
    """Create a **student** account. Emails are case-insensitive and stored lowercased.

    Admin accounts cannot be self-registered; they are created with `scripts/create_admin.py`.
    Passwords must be at least 8 characters.
    """
    user = User(
        name=payload.name,
        email=payload.email,
        room_no=payload.room_no,
        role=Role.student,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists"
        ) from None
    db.refresh(user)
    return user


@router.post(
    "/login",
    response_model=Token,
    summary="Log in and receive a JWT",
    responses={401: {"model": ErrorResponse, "description": "Invalid credentials"}, **RATE_LIMITED},
)
@limiter.limit(auth_rate_limit)
def login(request: Request, payload: LoginRequest, db: DbSession) -> Token:
    """Exchange email + password (JSON body) for a bearer token.

    Use the token as `Authorization: Bearer <token>`; in Swagger, click **Authorize** and paste it.
    """
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token, expires_in = create_access_token(user)
    return Token(access_token=token, expires_in=expires_in)


@router.get("/me", response_model=UserOut, summary="Current user")
def me(user: CurrentUser) -> User:
    """Return the account the bearer token belongs to."""
    return user


@router.get("/me/ratings", response_model=Page[MyRating], summary="My ratings")
def my_ratings(
    user: CurrentUser,
    db: DbSession,
    page: PageParams,
    date: Annotated[dt.date | None, Query(description="Only ratings of meals on this day")] = None,
) -> Page[MyRating]:
    """The current user's own ratings, newest first, each with its meal. Filter by the meal's
    `date` to see which of a day's meals you have already rated."""
    statement = select(Rating).join(Rating.meal).where(Rating.user_id == user.id)
    if date is not None:
        statement = statement.where(Meal.date == date)

    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    ratings = db.scalars(
        statement.options(contains_eager(Rating.meal))
        .order_by(Rating.created_at.desc(), Rating.id.desc())
        .limit(page.limit)
        .offset(page.offset)
    ).all()
    return Page[MyRating](
        items=[MyRating.model_validate(rating) for rating in ratings],
        total=total,
        limit=page.limit,
        offset=page.offset,
    )
