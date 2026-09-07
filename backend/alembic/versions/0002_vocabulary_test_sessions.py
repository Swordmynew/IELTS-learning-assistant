"""Add adaptive vocabulary-test sessions."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0002_vocabulary_test_sessions"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("vocabulary_test_sessions"):
        return
    op.create_table(
        "vocabulary_test_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("theta", sa.Float(), nullable=False),
        sa.Column("standard_error", sa.Float(), nullable=False),
        sa.Column("administered", sa.JSON(), nullable=False),
        sa.Column("responses", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_vocabulary_test_sessions_user_id",
        "vocabulary_test_sessions",
        ["user_id"],
    )
    op.create_index(
        "ix_vocabulary_test_sessions_status",
        "vocabulary_test_sessions",
        ["status"],
    )
    op.create_index(
        "ix_vocabulary_test_sessions_created_at",
        "vocabulary_test_sessions",
        ["created_at"],
    )


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("vocabulary_test_sessions"):
        op.drop_table("vocabulary_test_sessions")
