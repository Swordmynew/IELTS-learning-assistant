"""Add profile fields and preferences to user accounts."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0006_user_accounts"
down_revision = "0005_practice_attempts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "display_name" not in columns:
        op.add_column("users", sa.Column("display_name", sa.String(length=80), nullable=True))
    if "preferences" not in columns:
        op.add_column(
            "users",
            sa.Column("preferences", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        )


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "preferences" in columns:
        op.drop_column("users", "preferences")
    if "display_name" in columns:
        op.drop_column("users", "display_name")
