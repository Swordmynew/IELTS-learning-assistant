"""Synthetic constraint, persistence and workflow regressions; no external services."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.db import Base, StudyPlanRow, User
from app.main import app
from app.repository import approve_plan, save_plan, save_profile
from app.schemas import LearnerProfileCreate, Skill, StudyTask, TaskType
from app.services.learning_time import learning_today
from app.services.planner import (
    _candidates,
    _cp_sat_schedule,
    _greedy_schedule,
    build_week_plan,
    validate_plan,
)


def learner(days=30, minutes=90):
    return LearnerProfileCreate(exam_date=learning_today() + timedelta(days=days),
        current_scores={skill: 5.5 for skill in Skill}, target_scores={skill: 7 for skill in Skill},
        minutes_by_weekday={day: minutes for day in range(1, 8)}, preferred_skills=[Skill.writing])


@pytest.mark.parametrize("days", [1, 2, 4, 7, 30])
@pytest.mark.parametrize("minutes", [0, 30, 60, 120])
@pytest.mark.parametrize("algorithm", [_greedy_schedule, _cp_sat_schedule])
def test_both_schedulers_stop_before_exam(days, minutes, algorithm):
    profile = learner(days, minutes)
    start = learning_today()
    tasks, conflicts = algorithm(profile, _candidates(profile, [], None), start)
    assert all(start <= task.scheduled_date < min(profile.exam_date, start + timedelta(days=7)) for task in tasks)
    for day in {task.scheduled_date for task in tasks}:
        assert sum(task.duration_minutes for task in tasks if task.scheduled_date == day) <= minutes
    if days == 1 and minutes == 0:
        assert tasks == [] and conflicts


def test_validator_catches_out_of_range_task_and_oversized_plan():
    profile = learner(days=1, minutes=120)
    plan = build_week_plan(profile)
    assert plan.starts_on == plan.ends_on == learning_today()
    assert validate_plan(plan, profile) == []
    plan.tasks.append(StudyTask(scheduled_date=profile.exam_date, skill="reading", task_type=TaskType.reading_drill, title="Synthetic out-of-range", objective="test boundary", duration_minutes=30, priority=0.5))
    assert any("outside" in error for error in validate_plan(plan, profile))
    plan.ends_on = profile.exam_date
    assert any("range" in error for error in validate_plan(plan, profile))


def test_learning_date_is_shanghai_date_across_utc_midnight(monkeypatch):
    monkeypatch.setattr(get_settings(), "learning_timezone", "Asia/Shanghai")
    assert learning_today(datetime(2026, 11, 11, 16, 1, tzinfo=UTC)).isoformat() == "2026-11-12"
    assert learning_today(datetime(2026, 11, 11, 15, 59, tzinfo=UTC)).isoformat() == "2026-11-11"
    with pytest.raises(ValueError):
        learning_today(datetime(2026, 11, 11))


@pytest.mark.asyncio
@pytest.mark.parametrize("same_draft", [False, True])
async def test_database_serializes_parallel_approvals(tmp_path, same_draft):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'approvals.db'}", connect_args={"timeout": 30})
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("PRAGMA journal_mode=WAL"))
            await connection.run_sync(Base.metadata.create_all)
        user_id = str(uuid4())
        async with factory() as session:
            session.add(User(id=user_id, email=f"{uuid4()}@example.com", password_hash="synthetic-unused-hash"))
            await session.commit()
            await save_profile(session, user_id, learner(), [])
            plans = [build_week_plan(learner()) for _ in range(2)]
            for plan in plans:
                await save_plan(session, user_id, plan)

        async def approve(index):
            async with factory() as session:
                try:
                    result = await approve_plan(session, user_id, str(plans[0 if same_draft else index % 2].id))
                    return result.status.value
                except HTTPException as error:
                    return error.status_code

        results = await asyncio.gather(*(approve(index) for index in range(8)))
        if same_draft:
            assert results == ["approved"] * 8
        else:
            assert "approved" in results and 409 in results
            assert all(result in {"approved", 409} for result in results)
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(StudyPlanRow).where(StudyPlanRow.user_id == user_id, StudyPlanRow.status == "approved")) == 1
    finally:
        await engine.dispose()


def account(client):
    response = client.post("/api/v1/auth/register", json={"email": f"{uuid4()}@example.com", "password": "SyntheticPlanning123"})
    assert response.status_code == 201
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert client.post("/api/v1/diagnostics", headers=headers, json=learner().model_dump(mode="json")).status_code == 200
    return headers


def events(response):
    assert response.status_code == 200
    return [json.loads(frame.removeprefix("data: ")) for frame in response.text.strip().split("\n\n") if frame]


def test_profile_edit_rejects_old_drafts_and_removes_invalid_active_plan():
    with TestClient(app) as client:
        headers = account(client)
        first = client.post("/api/v1/plans/generate", headers=headers).json()
        second = client.post("/api/v1/plans/generate", headers=headers).json()
        assert client.post(f"/api/v1/plans/{first['id']}/approve", headers=headers, json={"approved": True}).status_code == 200
        assert client.post(f"/api/v1/plans/{second['id']}/approve", headers=headers, json={"approved": True}).status_code == 409
        changed = learner(minutes=30)
        assert client.post("/api/v1/diagnostics", headers=headers, json=changed.model_dump(mode="json")).status_code == 200
        assert client.get("/api/v1/dashboard", headers=headers).json()["active_plan"] is None
        assert client.post(f"/api/v1/plans/{first['id']}/approve", headers=headers, json={"approved": True}).status_code == 409
        assert client.post(f"/api/v1/tasks/{first['tasks'][0]['id']}/complete", headers=headers).status_code == 404


def test_approved_plan_replay_and_foreign_plan_access():
    with TestClient(app) as client:
        headers, other = account(client), account(client)
        plan = client.post("/api/v1/plans/generate", headers=headers).json()
        for _ in range(2):
            assert client.post(f"/api/v1/plans/{plan['id']}/approve", headers=headers, json={"approved": True}).status_code == 200
        assert client.post(f"/api/v1/plans/{plan['id']}/approve", headers=other, json={"approved": True}).status_code == 404


def test_infeasible_pre_exam_draft_cannot_be_approved():
    with TestClient(app) as client:
        headers = account(client)
        assert client.post("/api/v1/diagnostics", headers=headers, json=learner(days=1, minutes=30).model_dump(mode="json")).status_code == 200
        response = client.post("/api/v1/plans/generate", headers=headers)
        assert response.status_code == 201
        plan = response.json()
        assert plan["conflicts"] and plan["starts_on"] == plan["ends_on"]
        assert all(task["scheduled_date"] < learner(days=1).exam_date.isoformat() for task in plan["tasks"])
        assert client.post(f"/api/v1/plans/{plan['id']}/approve", headers=headers, json={"approved": True}).status_code == 409


def test_stream_emits_executed_nodes_and_persisted_plan_then_replays():
    with TestClient(app) as client:
        headers = account(client)
        headers["Idempotency-Key"] = str(uuid4())
        stream = events(client.post("/api/v1/agent/runs/stream", headers=headers))
        assert [event["node"] for event in stream if event.get("node")] == ["intake", "diagnose", "retrieve", "plan", "validate"]
        complete = stream[-1]
        assert complete["status"] == "completed" and complete["plan_id"] == complete["plan"]["id"]
        recovered = client.get("/api/v1/dashboard", headers=headers).json()
        assert recovered["draft_plan"] == complete["plan"]
        assert recovered["active_plan"] is None
        run = client.get(f"/api/v1/agent/runs/{complete['run_id']}", headers=headers).json()
        assert run["status"] == "waiting_for_approval" and run["finished_at"]
        assert run["trace"][-1]["plan_id"] == complete["plan_id"]
        replay = events(client.post("/api/v1/agent/runs/stream", headers=headers))
        assert len(replay) == 1 and replay[0]["replayed"] and replay[0]["plan_id"] == complete["plan_id"]
        other = account(client)
        assert client.get(f"/api/v1/agent/runs/{complete['run_id']}", headers=other).status_code == 404
        assert client.get("/api/v1/dashboard", headers=other).json()["draft_plan"] is None


def test_dashboard_recovers_latest_draft_without_replacing_active_plan():
    with TestClient(app) as client:
        headers = account(client)
        active = client.post("/api/v1/plans/generate", headers=headers).json()
        assert client.post(f"/api/v1/plans/{active['id']}/approve", headers=headers, json={"approved": True}).status_code == 200
        client.post("/api/v1/plans/generate", headers=headers)
        latest = client.post("/api/v1/plans/generate", headers=headers).json()
        for _ in range(2):
            recovered = client.get("/api/v1/dashboard", headers=headers).json()
            assert recovered["draft_plan"] == latest
            assert recovered["active_plan"]["id"] == active["id"]
            assert recovered["total_tasks"] == len(active["tasks"])
        assert client.post(f"/api/v1/plans/{latest['id']}/approve", headers=headers, json={"approved": True}).status_code == 200
        recovered = client.get("/api/v1/dashboard", headers=headers).json()
        assert recovered["active_plan"]["id"] == latest["id"]
        assert recovered["draft_plan"] is None


def test_dashboard_does_not_restore_invalidated_or_previous_day_drafts(monkeypatch):
    with TestClient(app) as client:
        headers = account(client)
        client.post("/api/v1/plans/generate", headers=headers)
        assert client.get("/api/v1/dashboard", headers=headers).json()["draft_plan"] is not None
        assert client.post("/api/v1/diagnostics", headers=headers, json=learner(minutes=30).model_dump(mode="json")).status_code == 200
        assert client.get("/api/v1/dashboard", headers=headers).json()["draft_plan"] is None
        client.post("/api/v1/plans/generate", headers=headers)
        tomorrow = learning_today() + timedelta(days=1)
        monkeypatch.setattr("app.services.learning_time.learning_today", lambda: tomorrow)
        assert client.get("/api/v1/dashboard", headers=headers).json()["draft_plan"] is None


def test_stream_failure_has_no_fake_completion_or_saved_plan(monkeypatch):
    class BrokenGraph:
        def stream(self, state, **kwargs):
            yield {"intake": {"trace": ["intake"]}}
            raise RuntimeError("Synthetic workflow failure")

    monkeypatch.setattr("app.services.planning_runs.build_planning_graph", BrokenGraph)
    with TestClient(app) as client:
        headers = account(client)
        stream = events(client.post("/api/v1/agent/runs/stream", headers=headers))
        assert [event.get("node") for event in stream[:-1]] == ["intake"]
        assert stream[-1]["status"] == "failed" and not any(event["status"] == "completed" for event in stream)
        run = client.get(f"/api/v1/agent/runs/{stream[0]['run_id']}", headers=headers).json()
        assert run["status"] == "failed" and not any(event.get("plan_id") for event in run["trace"])


def test_idempotency_keys_are_scoped_by_user():
    with TestClient(app) as client:
        first, second = account(client), account(client)
        key = str(uuid4())
        responses = [client.post("/api/v1/plans/generate", headers={**headers, "Idempotency-Key": key}) for headers in [first, second]]
        assert all(response.status_code == 201 for response in responses)
        assert responses[0].json()["id"] != responses[1].json()["id"]


@pytest.mark.asyncio
async def test_profile_changed_during_generation_cannot_save_stale_plan(tmp_path):
    from app.db import AgentRunRow
    from app.services.planning_runs import generate_stored_plan

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'snapshot.db'}", connect_args={"timeout": 30})
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = str(uuid4())
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            session.add(User(id=user_id, email=f"{uuid4()}@example.com", password_hash="synthetic-unused"))
            await session.commit()
            await save_profile(session, user_id, learner(), [])

        async def change_profile(event):
            if event.get("node") == "intake":
                async with factory() as session:
                    await save_profile(session, user_id, learner(minutes=30), [])

        async with factory() as session:
            with pytest.raises(HTTPException) as error:
                await generate_stored_plan(session, user_id, str(uuid4()), change_profile)
            assert error.value.status_code == 409
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(StudyPlanRow).where(StudyPlanRow.user_id == user_id)) == 0
            run = await session.scalar(select(AgentRunRow).where(AgentRunRow.user_id == user_id))
            assert run.status == "failed"
    finally:
        await engine.dispose()


def test_expired_stored_profile_remains_readable_but_cannot_generate():
    from app.db import LearnerProfileRow, SessionLocal

    with TestClient(app) as client:
        headers = account(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

        async def expire():
            async with SessionLocal() as session:
                row = await session.scalar(select(LearnerProfileRow).where(LearnerProfileRow.user_id == user_id))
                row.payload = {**row.payload, "exam_date": (learning_today() - timedelta(days=1)).isoformat()}
                await session.commit()

        client.portal.call(expire)
        response = client.get("/api/v1/dashboard", headers=headers)
        assert response.status_code == 200
        assert response.json()["learning_today"] == learning_today().isoformat()
        assert client.post("/api/v1/plans/generate", headers=headers).status_code == 409
        invalid = learner().model_dump(mode="json")
        invalid["exam_date"] = (learning_today() - timedelta(days=1)).isoformat()
        assert client.post("/api/v1/diagnostics", headers=headers, json=invalid).status_code == 422
