"""initial schema: users, meals, ratings

Revision ID: 0001
Revises:
Create Date: 2026-10-22 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

user_role = sa.Enum("student", "admin", name="user_role")
meal_type = sa.Enum("breakfast", "lunch", "snacks", "dinner", name="meal_type")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("room_no", sa.String(length=20), nullable=False),
        sa.Column("role", user_role, server_default="student", nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "meals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("meal_type", meal_type, nullable=False),
        sa.Column(
            "menu_items",
            sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_meals")),
        sa.UniqueConstraint("date", "meal_type", name="uq_meals_date_meal_type"),
    )
    op.create_index(op.f("ix_meals_date"), "meals", ["date"], unique=False)

    op.create_table(
        "ratings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("meal_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("taste", sa.Integer(), nullable=False),
        sa.Column("hygiene", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("comment", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("score BETWEEN 1 AND 5", name="ck_ratings_score"),
        sa.CheckConstraint("taste BETWEEN 1 AND 5", name="ck_ratings_taste"),
        sa.CheckConstraint("hygiene BETWEEN 1 AND 5", name="ck_ratings_hygiene"),
        sa.CheckConstraint("quantity BETWEEN 1 AND 5", name="ck_ratings_quantity"),
        sa.ForeignKeyConstraint(
            ["meal_id"], ["meals.id"], name="fk_ratings_meal_id_meals", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_ratings_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ratings")),
        sa.UniqueConstraint("user_id", "meal_id", name="uq_ratings_user_meal"),
    )
    op.create_index(op.f("ix_ratings_meal_id"), "ratings", ["meal_id"], unique=False)
    op.create_index(op.f("ix_ratings_user_id"), "ratings", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ratings_user_id"), table_name="ratings")
    op.drop_index(op.f("ix_ratings_meal_id"), table_name="ratings")
    op.drop_table("ratings")
    op.drop_index(op.f("ix_meals_date"), table_name="meals")
    op.drop_table("meals")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
    meal_type.drop(op.get_bind(), checkfirst=True)
    user_role.drop(op.get_bind(), checkfirst=True)
