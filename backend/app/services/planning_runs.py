"""Persistent weekly-planning execution shared by JSON and SSE endpoints."""

import asyncio
import hashlib
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select

from app.agents.workflow import build_planning_graph
from app.db import AgentRunRow
from app.repository import (
    get_plan,
    get_profile,
    lock_planning_user,
    plan_from_row,
    planning_context,
    save_plan,
)
from app.schemas import StudyPlan
from app.services.learning_time import learning_today
from app.services.word_deck import deck

NODE_MESSAGES = {
    "intake": "已读取学习目标与时间约束",
    "diagnose": "已计算能力差距",
    "retrieve": "已读取评分标准参考",
    "plan": "已生成考前学习任务",
    "validate": "已检查时间与任务约束",
}


async def generate_stored_plan(session, user_id: str, idempotency_key: str | None = None, emit=None) -> StudyPlan:
    async def report(event):
        if emit:
            await emit(event)

    await lock_planning_user(session, user_id)
    stored = await get_profile(session, user_id)
    if not stored or stored[0].exam_date <= learning_today():
        await session.rollback()
        raise HTTPException(409, "请先填写有效的考试日期与学习档案")
    context = await planning_context(session, user_id)
    key = "plan:" + hashlib.sha256(f"{user_id}:{idempotency_key}".encode()).hexdigest() if idempotency_key else None
    if key:
        existing = await session.scalar(select(AgentRunRow).where(
            AgentRunRow.user_id == user_id,
            or_(AgentRunRow.idempotency_key == key, AgentRunRow.idempotency_key == idempotency_key),
        ))
        if existing:
            terminal = next((event for event in reversed(existing.trace) if event.get("plan_id")), None)
            if not terminal:
                await session.rollback()
                raise HTTPException(409, "该请求正在执行或已失败，请刷新后重新生成")
            row = await get_plan(session, user_id, terminal["plan_id"])
            old_context = row.payload.get("planning_context", {})
            if row.status == "superseded" or old_context.get("profile_signature") != context["profile_signature"]:
                await session.rollback()
                raise HTTPException(409, "该请求对应的草案已失效，请使用新请求重新生成")
            plan = plan_from_row(row)
            await session.commit()
            await report({"status": "completed", "replayed": True, "run_id": existing.id, "plan_id": str(plan.id), "plan": plan.model_dump(mode="json")})
            return plan
    profile, estimates = stored
    vocabulary_learning = (await deck(session, user_id, limit=1))["counts"]
    start = learning_today()
    run = AgentRunRow(id=str(uuid4()), user_id=user_id, workflow="weekly-planning", status="running", idempotency_key=key, trace=[])
    session.add(run)
    await session.commit()
    run_id = run.id
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    state = {
        "profile": profile.model_dump(mode="json"),
        "estimates": [item.model_dump(mode="json") for item in estimates],
        "vocabulary_learning": vocabulary_learning, "starts_on": start.isoformat(), "trace": [],
    }

    def worker():
        try:
            for patch in build_planning_graph().stream(state, stream_mode="updates"):
                loop.call_soon_threadsafe(queue.put_nowait, ("update", patch))
        except Exception as error:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", error))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, ("done", None))

    execution = asyncio.create_task(asyncio.to_thread(worker))
    try:
        while True:
            kind, payload = await queue.get()
            if kind == "done":
                break
            if kind == "error":
                raise payload
            for node, patch in payload.items():
                state.update(patch)
                event = {"node": node, "status": "node_completed", "message": NODE_MESSAGES[node], "run_id": run_id}
                run.trace = [*run.trace, event]
                await session.commit()
                await report(event)
        await execution
        plan = StudyPlan.model_validate(state["plan"])
        plan.conflicts = list(dict.fromkeys([*plan.conflicts, *state.get("validation_errors", [])]))
        await save_plan(session, user_id, plan, context, commit=False)
        run.status = "waiting_for_approval"
        run.finished_at = datetime.now(UTC)
        run.trace = [*run.trace, {"plan_id": str(plan.id), "conflicts": plan.conflicts}]
        await session.commit()
        await report({"status": "completed", "run_id": run_id, "plan_id": str(plan.id), "plan": plan.model_dump(mode="json")})
        return plan
    except BaseException as error:
        await session.rollback()
        record = await session.get(AgentRunRow, run_id, populate_existing=True)
        if record:
            record.status = "cancelled" if isinstance(error, asyncio.CancelledError) else "failed"
            record.finished_at = datetime.now(UTC)
            record.trace = [*record.trace, {"status": record.status, "error_type": type(error).__name__}]
            await session.commit()
        if isinstance(error, (HTTPException, asyncio.CancelledError)):
            raise
        raise HTTPException(500, "规划执行失败，请重新生成") from error
    finally:
        if not execution.done():
            execution.cancel()
