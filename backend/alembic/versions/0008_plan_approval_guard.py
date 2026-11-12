"""Enforce one approved plan per user; normalize legacy duplicates deterministically."""

import sqlalchemy as sa

from alembic import op

revision = "0008_plan_approval_guard"
down_revision = "0007_personal_coach"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, user_id FROM study_plans WHERE status = 'approved' ORDER BY created_at DESC, id DESC")).mappings()
    seen = set()
    duplicates = []
    for row in rows:
        if row["user_id"] in seen:
            duplicates.append(row["id"])
        seen.add(row["user_id"])
    for plan_id in duplicates:
        bind.execute(sa.text("UPDATE study_plans SET status = 'superseded' WHERE id = :id"), {"id": plan_id})
    if "uq_study_plans_one_approved" not in {index["name"] for index in sa.inspect(bind).get_indexes("study_plans")}:
        op.create_index("uq_study_plans_one_approved", "study_plans", ["user_id"], unique=True,
                        sqlite_where=sa.text("status = 'approved'"), postgresql_where=sa.text("status = 'approved'"))


def downgrade():
    op.drop_index("uq_study_plans_one_approved", table_name="study_plans")
