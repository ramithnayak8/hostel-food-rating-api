"""SQLAlchemy ORM models. Constraints live in the database as well as in the Pydantic schemas."""

import datetime as dt
import enum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# JSONB on Postgres, plain JSON on SQLite (used by the laptop test fallback).
JsonList = JSON().with_variant(JSONB(), "postgresql")


class Role(enum.StrEnum):
    student = "student"
    admin = "admin"


class MealType(enum.StrEnum):
    breakfast = "breakfast"
    lunch = "lunch"
    snacks = "snacks"
    dinner = "dinner"


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    room_no: Mapped[str] = mapped_column(String(20))
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", values_callable=_enum_values),
        default=Role.student,
        server_default=Role.student.value,
    )
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    ratings: Mapped[list["Rating"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Meal(Base):
    __tablename__ = "meals"
    __table_args__ = (UniqueConstraint("date", "meal_type", name="uq_meals_date_meal_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    meal_type: Mapped[MealType] = mapped_column(
        Enum(MealType, name="meal_type", values_callable=_enum_values)
    )
    menu_items: Mapped[list[str]] = mapped_column(JsonList)
    # Complaint flag: maintained by app.services.refresh_flag after every rating.
    flagged: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    ratings: Mapped[list["Rating"]] = relationship(
        back_populates="meal", cascade="all, delete-orphan", passive_deletes=True
    )


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint("user_id", "meal_id", name="uq_ratings_user_meal"),
        CheckConstraint("score BETWEEN 1 AND 5", name="ck_ratings_score"),
        CheckConstraint("taste BETWEEN 1 AND 5", name="ck_ratings_taste"),
        CheckConstraint("hygiene BETWEEN 1 AND 5", name="ck_ratings_hygiene"),
        CheckConstraint("quantity BETWEEN 1 AND 5", name="ck_ratings_quantity"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    meal_id: Mapped[int] = mapped_column(ForeignKey("meals.id", ondelete="CASCADE"), index=True)
    score: Mapped[int]
    taste: Mapped[int]
    hygiene: Mapped[int]
    quantity: Mapped[int]
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="ratings")
    meal: Mapped[Meal] = relationship(back_populates="ratings")
