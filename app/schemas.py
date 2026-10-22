"""Pydantic v2 request/response models."""

import datetime as dt
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
)

from app.models import MealType, Role

Score = Annotated[int, Field(ge=1, le=5, strict=True, examples=[4])]
MenuItem = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
NormalizedEmail = Annotated[EmailStr, AfterValidator(lambda email: email.strip().lower())]


class RequestModel(BaseModel):
    """Request bodies reject unknown fields, so e.g. a self-assigned `role` is a 422."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Errors -----------------------------------------------------------------------------------


class ErrorDetail(BaseModel):
    code: str = Field(examples=["not_found"])
    message: str = Field(examples=["Meal not found"])
    request_id: str | None = Field(default=None, examples=["5f0c2a9e8b5d4c1f"])
    details: list[dict[str, object]] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# --- Auth -------------------------------------------------------------------------------------


class UserCreate(RequestModel):
    name: str = Field(min_length=1, max_length=100, examples=["Asha Rao"])
    email: NormalizedEmail = Field(examples=["asha@hostel.example.com"])
    room_no: str = Field(min_length=1, max_length=20, examples=["B-204"])
    password: str = Field(min_length=8, max_length=128, examples=["correct-horse-battery"])


class LoginRequest(RequestModel):
    email: NormalizedEmail = Field(examples=["asha@hostel.example.com"])
    password: str = Field(min_length=1, max_length=128, examples=["correct-horse-battery"])


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth2 token type, not a secret
    expires_in: int = Field(description="Lifetime in seconds", examples=[3600])


class UserOut(ResponseModel):
    id: int
    name: str
    email: str
    room_no: str
    role: Role
    is_active: bool
    created_at: dt.datetime


# --- Meals ------------------------------------------------------------------------------------


class MealCreate(RequestModel):
    date: dt.date = Field(examples=["2026-10-22"])
    meal_type: MealType = Field(examples=["lunch"])
    menu_items: list[MenuItem] = Field(
        min_length=1, max_length=30, examples=[["Dal tadka", "Jeera rice", "Roti"]]
    )

    @field_validator("menu_items")
    @classmethod
    def _dedupe(cls, items: list[str]) -> list[str]:
        seen: set[str] = set()
        unique: list[str] = []
        for item in items:
            if item.casefold() not in seen:
                seen.add(item.casefold())
                unique.append(item)
        return unique


class MealOut(ResponseModel):
    id: int
    date: dt.date
    meal_type: MealType
    menu_items: list[str]
    flagged: bool
    created_at: dt.datetime


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


# --- Ratings ----------------------------------------------------------------------------------


class RatingCreate(RequestModel):
    score: Score
    taste: Score
    hygiene: Score
    quantity: Score
    comment: str | None = Field(default=None, max_length=500, examples=["Dal was cold."])


class Rater(BaseModel):
    """Who submitted a rating. Only ever shown to admins, and never includes the email."""

    name: str
    room_no: str


class RatingOut(ResponseModel):
    id: int
    meal_id: int
    score: int
    taste: int
    hygiene: int
    quantity: int
    comment: str | None
    created_at: dt.datetime
    rated_by: Rater | None = None


# --- Stats ------------------------------------------------------------------------------------


class MealStats(BaseModel):
    meal_id: int
    date: dt.date
    meal_type: MealType
    menu_items: list[str]
    rating_count: int
    avg_score: float | None
    avg_taste: float | None
    avg_hygiene: float | None
    avg_quantity: float | None
    flagged: bool


class DailyStats(BaseModel):
    date: dt.date
    meals: list[MealStats]


class DayTrend(BaseModel):
    date: dt.date
    rating_count: int
    avg_score: float | None


class DishStats(BaseModel):
    name: str
    avg_score: float
    rating_count: int


class WeeklyStats(BaseModel):
    start_date: dt.date
    end_date: dt.date
    days: list[DayTrend]
    best_dish: DishStats | None
    worst_dish: DishStats | None
    top_meals: list[MealStats]
    bottom_meals: list[MealStats]


class FlaggedMeal(MealStats):
    pass


# --- Health -----------------------------------------------------------------------------------


class Liveness(BaseModel):
    status: str = Field(examples=["ok"])
    version: str = Field(examples=["1.0.0"])


class Readiness(BaseModel):
    status: str = Field(examples=["ready"])
    database: str = Field(examples=["up"])
