from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import (
    LearnerProfileRow,
    StudyPlanRow,
    StudyTaskRow,
    VocabularyTestSessionRow,
    WritingAssessmentRow,
)
from app.schemas import (
    LearnerProfileCreate,
    PlanStatus,
    SkillEstimate,
    StudyPlan,
    StudyTask,
    VocabularyTest,
    VocabularyTestStatus,
    WritingAssessment,
    WritingSubmission,
)


async def save_profile(
    session: AsyncSession,
    user_id: str,
    profile: LearnerProfileCreate,
    estimates: list[SkillEstimate],
) -> None:
    row = await session.scalar(select(LearnerProfileRow).where(LearnerProfileRow.user_id == user_id))
    payload = profile.model_dump(mode="json")
    estimate_payload = [item.model_dump(mode="json") for item in estimates]
    if row:
        row.payload = payload
        row.estimates = estimate_payload
    else:
        session.add(LearnerProfileRow(user_id=user_id, payload=payload, estimates=estimate_payload))
    await session.commit()


async def get_profile(
    session: AsyncSession, user_id: str
) -> tuple[LearnerProfileCreate, list[SkillEstimate]] | None:
    row = await session.scalar(select(LearnerProfileRow).where(LearnerProfileRow.user_id == user_id))
    if not row:
        return None
    return (
        LearnerProfileCreate.model_validate(row.payload),
        [SkillEstimate.model_validate(item) for item in row.estimates],
    )


async def save_plan(session: AsyncSession, user_id: str, plan: StudyPlan) -> None:
    row = StudyPlanRow(
        id=str(plan.id),
        user_id=user_id,
        status=plan.status.value,
        payload=plan.model_dump(mode="json", exclude={"tasks"}),
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
    await session.commit()


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


async def approve_plan(session: AsyncSession, user_id: str, plan_id: str) -> StudyPlan:
    row = await get_plan(session, user_id, plan_id)
    await session.execute(
        update(StudyPlanRow)
        .where(
            StudyPlanRow.user_id == user_id,
            StudyPlanRow.status == PlanStatus.approved.value,
            StudyPlanRow.id != plan_id,
        )
        .values(status=PlanStatus.superseded.value)
    )
    row.status = PlanStatus.approved.value
    await session.commit()
    await session.refresh(row, attribute_names=["tasks"])
    return plan_from_row(row)


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
