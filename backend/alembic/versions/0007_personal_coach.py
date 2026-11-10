"""Add personal learning, writing versions, conversations and response caches."""

import sqlalchemy as sa
from alembic import op

revision = "0007_personal_coach"
down_revision = "0006_user_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "coach_records" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "coach_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("parent_id", sa.String(36), nullable=True),
        sa.Column("source_key", sa.String(200), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "kind", "source_key", name="uq_coach_source"),
    )
    for column in ("user_id", "kind", "parent_id"):
        op.create_index(f"ix_coach_records_{column}", "coach_records", [column])


def downgrade() -> None:
    op.drop_table("coach_records")
