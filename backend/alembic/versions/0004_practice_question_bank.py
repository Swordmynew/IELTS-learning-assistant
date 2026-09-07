"""Add user-isolated structured practice question bank."""

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0004_practice_question_bank"
down_revision = "0003_local_embedding_dimensions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("practice_questions"):
        return
    op.create_table(
        "practice_questions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("owner_id", sa.String(length=36), nullable=True),
        sa.Column("module", sa.String(length=32), nullable=False),
        sa.Column("task_type", sa.String(length=64), nullable=False),
        sa.Column("question_type", sa.String(length=64), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("passage", sa.Text(), nullable=True),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("correct_answer", sa.Text(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("source_name", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_practice_questions_owner_id", "practice_questions", ["owner_id"])
    op.create_index("ix_practice_questions_module", "practice_questions", ["module"])
    op.create_index("ix_practice_questions_task_type", "practice_questions", ["task_type"])
    op.create_index("ix_practice_questions_created_at", "practice_questions", ["created_at"])


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("practice_questions"):
        op.drop_table("practice_questions")
