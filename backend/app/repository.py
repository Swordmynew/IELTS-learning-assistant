from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import (
    LearnerProfileRow,
    StudyPlanRow,
    StudyTaskRow,
    User,
    VocabularyTestSessionRow,
    WritingAssessmentRow,
)
from app.schemas import (
    LearnerProfileRead,
    PlanStatus,
    SkillEstimate,
    StudyPlan,
    StudyTask,
    VocabularyTest,
    VocabularyTestStatus,
    WritingAssessment,
    WritingSubmission,
)


async def lock_planning_user(session: AsyncSession, user_id: str) -> None:
    # A database row write serializes profile edits, draft saves and approvals across workers.
    result = await session.execute(update(User).where(User.id == user_id).values(id=User.id).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(404, "User not found")


def profile_signature(profile: LearnerProfileRead, estimates: list[SkillEstimate]) -> str:
    data = {"profile": profile.model_dump(mode="json"), "estimates": sorted([item.model_dump(mode="json") for item in estimates], key=lambda item: item["skill"])}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


async def planning_context(session: AsyncSession, user_id: str) -> dict:
    stored = await get_profile(session, user_id)
    if not stored:
        raise HTTPException(409, "请先填写学习档案")
    active_id = await session.scalar(select(StudyPlanRow.id).where(StudyPlanRow.user_id == user_id, StudyPlanRow.status == "approved"))
    return {"profile_signature": profile_signature(*stored), "base_active_plan_id": active_id}


async def save_profile(
    session: AsyncSession,
    user_id: str,
    profile: LearnerProfileRead,
    estimates: list[SkillEstimate],
) -> None:
    await lock_planning_user(session, user_id)
    row = await session.scalar(select(LearnerProfileRow).where(LearnerProfileRow.user_id == user_id).execution_options(populate_existing=True))
    payload = profile.model_dump(mode="json")
    estimate_payload = [item.model_dump(mode="json") for item in estimates]
    if row:
        if row.payload != payload or row.estimates != estimate_payload:
            statuses = ["draft", "approved"] if any(row.payload.get(key) != payload.get(key) for key in ("exam_date", "minutes_by_weekday")) else ["draft"]
            await session.execute(update(StudyPlanRow).where(StudyPlanRow.user_id == user_id, StudyPlanRow.status.in_(statuses)).values(status="superseded"))
        row.payload = payload
        row.estimates = estimate_payload
    else:
        session.add(LearnerProfileRow(user_id=user_id, payload=payload, estimates=estimate_payload))
    await session.commit()


async def get_profile(
    session: AsyncSession, user_id: str
) -> tuple[LearnerProfileRead, list[SkillEstimate]] | None:
    row = await session.scalar(select(LearnerProfileRow).where(LearnerProfileRow.user_id == user_id).execution_options(populate_existing=True))
    if not row:
        return None
    return (
        LearnerProfileRead.model_validate(row.payload),
        [SkillEstimate.model_validate(item) for item in row.estimates],
    )


async def save_plan(session: AsyncSession, user_id: str, plan: StudyPlan, context: dict | None = None, *, commit: bool = True) -> None:
    await lock_planning_user(session, user_id)
    from app.services.learning_time import learning_today
    if plan.starts_on != learning_today():
        raise HTTPException(409, "学习日期已变化，请重新生成草案")
    current = await planning_context(session, user_id)
    if context is not None and current != context:
        raise HTTPException(409, "档案或正式计划已变化，请重新生成草案")
    row = StudyPlanRow(
        id=str(plan.id),
        user_id=user_id,
        status=plan.status.value,
        payload={**plan.model_dump(mode="json", exclude={"tasks"}), "planning_context": context or current},
    )
    row.tasks = [
        StudyTaskRow(
            id=str(task.id),
            user_id=user_id,
            scheduled_date=task.scheduled_date.isoformat(),
            completed=task.completed,
            payload=task.model_dump(mode="json"),
        )
        for task in plan.tasks
    ]
    session.add(row)
    if commit:
        await session.commit()
    else:
        await session.flush()


def plan_from_row(row: StudyPlanRow) -> StudyPlan:
    payload = dict(row.payload)
    payload["status"] = row.status
    payload["tasks"] = [
        {**task.payload, "completed": task.completed} for task in sorted(row.tasks, key=lambda item: item.scheduled_date)
    ]
    return StudyPlan.model_validate(payload)


async def get_plan(session: AsyncSession, user_id: str, plan_id: str) -> StudyPlanRow:
    row = await session.scalar(
        select(StudyPlanRow).where(StudyPlanRow.id == plan_id, StudyPlanRow.user_id == user_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")
    return row


async def get_active_plan(session: AsyncSession, user_id: str) -> StudyPlan | None:
    row = await session.scalar(
        select(StudyPlanRow)
        .where(StudyPlanRow.user_id == user_id, StudyPlanRow.status == PlanStatus.approved.value)
        .order_by(StudyPlanRow.created_at.desc())
    )
    return plan_from_row(row) if row else None


async def get_draft_plan(session: AsyncSession, user_id: str) -> StudyPlan | None:
    """Recover the latest actionable draft without treating it as an active plan."""
    from app.services.learning_time import learning_today

    row = await session.scalar(
        select(StudyPlanRow)
        .where(StudyPlanRow.user_id == user_id, StudyPlanRow.status == PlanStatus.draft.value)
        .order_by(StudyPlanRow.created_at.desc(), StudyPlanRow.id.desc())
        .limit(1)
    )
    if not row:
        return None
    plan = plan_from_row(row)
    stored = await get_profile(session, user_id)
    if not stored or stored[0].exam_date <= learning_today() or plan.starts_on != learning_today():
        return None
    if row.payload.get("planning_context") != await planning_context(session, user_id):
        return None
    return plan


async def approve_plan(session: AsyncSession, user_id: str, plan_id: str) -> StudyPlan:
    from app.services.learning_time import learning_today
    from app.services.planner import validate_plan

    try:
        await lock_planning_user(session, user_id)
        row = await get_plan(session, user_id, plan_id)
        await session.refresh(row, attribute_names=["status", "payload", "tasks"])
        plan = plan_from_row(row)
        stored = await get_profile(session, user_id)
        if not stored or plan.ends_on < learning_today() or stored[0].exam_date <= learning_today():
            raise HTTPException(409, "计划已过期，请更新档案并重新生成")
        if row.status == "superseded":
            raise HTTPException(409, "此草案已失效，请重新生成")
        errors = validate_plan(plan, stored[0])
        if errors:
            raise HTTPException(409, "计划不满足当前时间约束，请调整档案并重新生成")
        if row.status == "approved":
            await session.commit()
            return plan
        if row.status != "draft" or plan.starts_on < learning_today():
            raise HTTPException(409, "仅可启用当前有效草案")
        expected = row.payload.get("planning_context")
        if not expected or expected != await planning_context(session, user_id):
            raise HTTPException(409, "档案或正式计划已变化，请重新生成草案")
        await session.execute(update(StudyPlanRow).where(
            StudyPlanRow.user_id == user_id, StudyPlanRow.status == "approved", StudyPlanRow.id != plan_id
        ).values(status="superseded"))
        result = await session.execute(update(StudyPlanRow).where(
            StudyPlanRow.id == plan_id, StudyPlanRow.user_id == user_id, StudyPlanRow.status == "draft"
        ).values(status="approved"))
        if result.rowcount != 1:
            raise HTTPException(409, "草案状态已变化，请刷新")
        await session.commit()
        await session.refresh(row, attribute_names=["status", "tasks"])
        return plan_from_row(row)
    except Exception:
        await session.rollback()
        raise


async def complete_task(session: AsyncSession, user_id: str, task_id: str) -> StudyTask:
    return await set_task_completion(session, user_id, task_id, completed=True)


async def restore_task(session: AsyncSession, user_id: str, task_id: str) -> StudyTask:
    return await set_task_completion(session, user_id, task_id, completed=False)


async def set_task_completion(
    session: AsyncSession,
    user_id: str,
    task_id: str,
    *,
    completed: bool,
) -> StudyTask:
    await lock_planning_user(session, user_id)
    row = await session.scalar(
        select(StudyTaskRow)
        .join(StudyPlanRow, StudyTaskRow.plan_id == StudyPlanRow.id)
        .where(
            StudyTaskRow.id == task_id,
            StudyTaskRow.user_id == user_id,
            StudyPlanRow.status == PlanStatus.approved.value,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Active plan task not found")
    row.completed = completed
    row.completed_at = datetime.now(UTC) if completed else None
    await session.commit()
    return StudyTask.model_validate({**row.payload, "completed": completed})


async def save_assessment(
    session: AsyncSession,
    user_id: str,
    submission: WritingSubmission,
    assessment: WritingAssessment,
) -> None:
    from app.services.personal_knowledge import put_knowledge
    await put_knowledge(session, user_id, f"assessment:{assessment.id}", "写作反馈",
                        "\n".join(assessment.top_priorities), "writing", "writing",
                        f"/writing?assessment={assessment.id}", event_id=str(assessment.id))
    session.add(
        WritingAssessmentRow(
            id=str(assessment.id),
            user_id=user_id,
            submission=submission.model_dump(mode="json"),
            assessment=assessment.model_dump(mode="json"),
        )
    )
    await session.commit()


async def get_latest_assessment(session: AsyncSession, user_id: str) -> WritingAssessment | None:
    row = await session.scalar(
        select(WritingAssessmentRow)
        .where(WritingAssessmentRow.user_id == user_id)
        .order_by(WritingAssessmentRow.created_at.desc())
    )
    return WritingAssessment.model_validate(row.assessment) if row else None


async def get_latest_vocabulary_test(
    session: AsyncSession, user_id: str
) -> VocabularyTest | None:
    from app.services.vocabulary import vocabulary_test_from_row

    row = await session.scalar(
        select(VocabularyTestSessionRow)
        .where(VocabularyTestSessionRow.user_id == user_id)
        .order_by(VocabularyTestSessionRow.created_at.desc())
    )
    return vocabulary_test_from_row(row) if row else None


async def get_latest_completed_vocabulary_test(
    session: AsyncSession, user_id: str
) -> VocabularyTest | None:
    from app.services.vocabulary import vocabulary_test_from_row

    row = await session.scalar(
        select(VocabularyTestSessionRow)
        .where(
            VocabularyTestSessionRow.user_id == user_id,
            VocabularyTestSessionRow.status == VocabularyTestStatus.completed.value,
        )
        .order_by(VocabularyTestSessionRow.completed_at.desc())
    )
    return vocabulary_test_from_row(row) if row else None
