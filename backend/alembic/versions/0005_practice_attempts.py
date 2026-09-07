"""Add persisted practice attempts for grading and review."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0005_practice_attempts"
down_revision = "0004_practice_question_bank"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("practice_attempts"):
        return
    op.create_table(
        "practice_attempts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=36), nullable=False),
        sa.Column("submitted_answer", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["practice_questions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_practice_attempts_user_id", "practice_attempts", ["user_id"])
    op.create_index("ix_practice_attempts_question_id", "practice_attempts", ["question_id"])
    op.create_index("ix_practice_attempts_is_correct", "practice_attempts", ["is_correct"])
    op.create_index("ix_practice_attempts_created_at", "practice_attempts", ["created_at"])


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("practice_attempts"):
        op.drop_table("practice_attempts")
