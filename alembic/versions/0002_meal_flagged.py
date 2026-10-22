"""complaint flag: meals.flagged

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-22 00:00:01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meals",
        sa.Column("flagged", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    with op.batch_alter_table("meals") as batch_op:
        batch_op.drop_column("flagged")
