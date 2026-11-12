"""Migration rehearsal on disposable SQLite only."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_approval_guard_upgrade_downgrade_and_duplicate_cleanup(tmp_path):
    database = tmp_path / "migration.db"
    environment = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{database}", "PYTHONNOUSERSITE": "1", "PYTHONUTF8": "1"}
    backend = Path(__file__).resolve().parents[1]

    def migrate(*args):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=backend, env=environment, capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert result.returncode == 0, result.stderr[-2500:]

    migrate("upgrade", "0007_personal_coach")
    with sqlite3.connect(database) as connection:
        connection.execute("DROP INDEX IF EXISTS uq_study_plans_one_approved")
        connection.execute("INSERT INTO users (id,email,password_hash,preferences,is_demo,created_at) VALUES ('migration-user','synthetic@example.com','unused','{}',0,'2026-11-01')")
        for plan_id, timestamp in [("old-plan", "2026-11-01"), ("new-plan", "2026-11-02")]:
            connection.execute("INSERT INTO study_plans (id,user_id,status,payload,created_at) VALUES (?,?, 'approved','{}',?)", (plan_id, "migration-user", timestamp))
    migrate("upgrade", "head")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT id FROM study_plans WHERE status='approved'").fetchall() == [("new-plan",)]
        assert connection.execute("SELECT status FROM study_plans WHERE id='old-plan'").fetchone() == ("superseded",)
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0008_plan_approval_guard"
        try:
            connection.execute("INSERT INTO study_plans (id,user_id,status,payload,created_at) VALUES ('collision','migration-user','approved','{}','2026-11-03')")
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError("Database allowed two approved plans")
    migrate("downgrade", "0007_personal_coach")
    migrate("upgrade", "head")
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT count(*) FROM study_plans").fetchone()[0] == 2
