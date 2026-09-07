from __future__ import annotations

import asyncio
import json
import unicodedata
from datetime import date
from pathlib import Path
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.workflow import generate_plan_with_trace
from app.auth import create_access_token, current_user, hash_password, verify_password
from app.config import Settings, get_settings
from app.db import (
    AgentRunRow,
    KnowledgeDocumentRow,
    PracticeAttemptRow,
    PracticeQuestionRow,
    User,
    get_session,
)
from app.ingestion import enqueue_ingestion, ingest_document
from app.repository import (
    approve_plan,
    complete_task,
    get_active_plan,
    get_latest_assessment,
    get_latest_completed_vocabulary_test,
    get_latest_vocabulary_test,
    get_plan,
    get_profile,
    plan_from_row,
    restore_task,
    save_assessment,
    save_plan,
    save_profile,
)
from app.schemas import (
    AuthCredentials,
    DashboardSummary,
    DiagnosticRequest,
    KnowledgeDocumentSummary,
    PasswordChange,
    PlanApproval,
    PracticeQuestion,
    PracticeQuestionPage,
    PracticeQuestionPreview,
    QuestionAttemptCreate,
    QuestionAttemptResult,
    QuestionBankProgress,
    QuestionImportItem,
    QuestionImportResult,
    RagAnswer,
    RagQuery,
    RegisterRequest,
    Skill,
    SkillEstimate,
    StudyPlan,
    StudyTask,
    TokenResponse,
    UserAccount,
    UserAccountUpdate,
    UserPreferences,
    VocabularyTest,
    VocabularyTestAnswer,
    WritingAssessment,
    WritingSubmission,
)
from app.services.question_bank import parse_question_file
from app.services.search_repository import hybrid_search
from app.services.vocabulary import (
    answer_vocabulary_item,
    get_vocabulary_test,
    start_vocabulary_test,
    vocabulary_test_from_row,
)
from app.services.writing import get_writing_grader, round_band, validate_assessment

router = APIRouter(prefix="/api/v1")


def _token_response(user: User, settings: Settings) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user, settings),
        user_id=UUID(user.id),
        demo=user.is_demo,
    )


def _user_account(user: User) -> UserAccount:
    return UserAccount(
        id=UUID(user.id),
        email=user.email,
        display_name=user.display_name,
        demo=user.is_demo,
        created_at=user.created_at,
        preferences=UserPreferences.model_validate(user.preferences or {}),
    )


@router.post("/auth/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    if await session.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(status_code=409, detail="Email is already registered")
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        display_name=(body.display_name or body.email.split("@", 1)[0]).strip(),
        preferences=UserPreferences().model_dump(),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return _token_response(user, settings)


@router.post("/auth/login", response_model=TokenResponse)
async def login(
    body: AuthCredentials,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    user = await session.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return _token_response(user, settings)


@router.post("/auth/demo", response_model=TokenResponse)
async def demo_session(
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    email = "demo@ielts-coach.local"
    user = await session.scalar(select(User).where(User.email == email))
    if not user:
        user = User(
            email=email,
            password_hash=hash_password("demo-account"),
            display_name="演示用户",
            preferences=UserPreferences().model_dump(),
            is_demo=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    elif not user.display_name:
        user.display_name = "演示用户"
        user.preferences = UserPreferences().model_dump()
        await session.commit()
        await session.refresh(user)
    profile = await get_profile(session, user.id)
    if not profile:
        from datetime import timedelta

        demo_profile = DiagnosticRequest(
            exam_date=date.today() + timedelta(days=60),
            current_scores={skill: 5.5 for skill in Skill},
            target_scores={skill: 7.0 for skill in Skill},
            minutes_by_weekday={1: 60, 2: 45, 3: 60, 4: 45, 5: 60, 6: 120, 7: 90},
            preferred_skills=[Skill.writing],
        )
        await save_profile(session, user.id, demo_profile, [])
    return _token_response(user, settings)


@router.get("/auth/me", response_model=UserAccount)
async def account(user: User = Depends(current_user)) -> UserAccount:
    return _user_account(user)


@router.patch("/auth/me", response_model=UserAccount)
async def update_account(
    body: UserAccountUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> UserAccount:
    if "display_name" in body.model_fields_set:
        user.display_name = body.display_name.strip() if body.display_name else None
    await session.commit()
    await session.refresh(user)
    return _user_account(user)


@router.post("/auth/change-password", status_code=204)
async def change_password(
    body: PasswordChange,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    if user.is_demo:
        raise HTTPException(status_code=403, detail="Demo account password cannot be changed")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    await session.commit()


@router.get("/settings", response_model=UserPreferences)
async def get_preferences(user: User = Depends(current_user)) -> UserPreferences:
    return UserPreferences.model_validate(user.preferences or {})


@router.put("/settings", response_model=UserPreferences)
async def update_preferences(
    body: UserPreferences,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> UserPreferences:
    user.preferences = body.model_dump()
    await session.commit()
    return body


@router.post("/diagnostics", response_model=DiagnosticRequest)
async def record_diagnostic(
    body: DiagnosticRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DiagnosticRequest:
    profile = body.model_copy(update={"estimates": []})
    await save_profile(session, user.id, profile, body.estimates)
    return body


@router.post("/plans/generate", response_model=StudyPlan, status_code=201)
async def generate_plan(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> StudyPlan:
    if idempotency_key:
        existing = await session.scalar(
            select(AgentRunRow).where(
                AgentRunRow.user_id == user.id,
                AgentRunRow.idempotency_key == idempotency_key,
            )
        )
        if existing and existing.trace and existing.trace[-1].get("plan_id"):
            row = await get_plan(session, user.id, existing.trace[-1]["plan_id"])
            return plan_from_row(row)
    stored = await get_profile(session, user.id)
    if not stored:
        raise HTTPException(status_code=409, detail="Complete a diagnostic before generating a plan")
    profile, estimates = stored
    vocabulary_test = await get_latest_completed_vocabulary_test(session, user.id)
    vocabulary = vocabulary_test.result if vocabulary_test else None
    plan, trace = await asyncio.to_thread(
        generate_plan_with_trace, profile, estimates, vocabulary
    )
    await save_plan(session, user.id, plan)
    run = AgentRunRow(
        user_id=user.id,
        workflow="weekly-planning",
        status="waiting_for_approval",
        idempotency_key=idempotency_key,
        trace=[*[{"node": node} for node in trace], {"plan_id": str(plan.id)}],
    )
    session.add(run)
    await session.commit()
    return plan


@router.post("/plans/{plan_id}/approve", response_model=StudyPlan)
async def set_plan_approval(
    plan_id: UUID,
    body: PlanApproval,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StudyPlan:
    row = await get_plan(session, user.id, str(plan_id))
    if not body.approved:
        return plan_from_row(row)
    return await approve_plan(session, user.id, str(plan_id))


@router.get("/plans/today", response_model=list[StudyTask])
async def today_tasks(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> list[StudyTask]:
    plan = await get_active_plan(session, user.id)
    return [task for task in plan.tasks if task.scheduled_date == date.today()] if plan else []


@router.post("/tasks/{task_id}/complete", response_model=StudyTask)
async def mark_task_complete(
    task_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StudyTask:
    return await complete_task(session, user.id, str(task_id))


@router.post("/tasks/{task_id}/restore", response_model=StudyTask)
async def restore_plan_task(
    task_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StudyTask:
    return await restore_task(session, user.id, str(task_id))


@router.post("/writing/assessments", response_model=WritingAssessment, status_code=201)
async def assess_writing(
    body: WritingSubmission,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> WritingAssessment:
    grader = get_writing_grader(settings)
    assessment = await grader.grade(body)
    errors = validate_assessment(assessment, body.essay)
    if errors:
        raise HTTPException(status_code=502, detail={"message": "Invalid model assessment", "errors": errors})
    await save_assessment(session, user.id, body, assessment)
    stored = await get_profile(session, user.id)
    if stored:
        profile, estimates = stored
        scores = dict(profile.current_scores)
        scores[Skill.writing] = round_band(
            0.7 * scores[Skill.writing] + 0.3 * assessment.estimated_overall_band
        )
        updated = profile.model_copy(update={"current_scores": scores})
        by_skill = {item.skill: item for item in estimates}
        by_skill[Skill.writing] = SkillEstimate(
            skill=Skill.writing,
            band=scores[Skill.writing],
            confidence=min(1.0, by_skill.get(Skill.writing, SkillEstimate(skill=Skill.writing, band=scores[Skill.writing], confidence=0.5)).confidence + 0.1),
            recent_error_rate=max(
                0.0,
                min(1.0, (profile.target_scores[Skill.writing] - scores[Skill.writing]) / 3),
            ),
            days_since_practice=0,
        )
        await save_profile(session, user.id, updated, list(by_skill.values()))
    return assessment


@router.post("/vocabulary/tests", response_model=VocabularyTest, status_code=201)
async def create_vocabulary_test(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> VocabularyTest:
    return await start_vocabulary_test(session, user.id)


@router.get("/vocabulary/tests/{test_id}", response_model=VocabularyTest)
async def read_vocabulary_test(
    test_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> VocabularyTest:
    row = await get_vocabulary_test(session, user.id, str(test_id))
    return vocabulary_test_from_row(row)


@router.post("/vocabulary/tests/{test_id}/responses", response_model=VocabularyTest)
async def submit_vocabulary_response(
    test_id: UUID,
    body: VocabularyTestAnswer,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> VocabularyTest:
    return await answer_vocabulary_item(session, user.id, str(test_id), body)


@router.get("/dashboard", response_model=DashboardSummary)
async def dashboard(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> DashboardSummary:
    stored = await get_profile(session, user.id)
    plan = await get_active_plan(session, user.id)
    completed = sum(task.completed for task in plan.tasks) if plan else 0
    total = len(plan.tasks) if plan else 0
    return DashboardSummary(
        profile=stored[0] if stored else None,
        active_plan=plan,
        completed_tasks=completed,
        total_tasks=total,
        latest_assessment=await get_latest_assessment(session, user.id),
        latest_vocabulary_test=await get_latest_vocabulary_test(session, user.id),
    )


@router.post("/knowledge/documents", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(status_code=415, detail="Only PDF, DOCX, TXT and Markdown are supported")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds upload limit")
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    document = KnowledgeDocumentRow(
        owner_id=user.id,
        title=Path(file.filename or "document").stem,
        filename=Path(file.filename or "document").name,
        license_type="user-private",
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    path = settings.upload_dir / f"{document.id}{suffix}"
    path.write_bytes(data)
    if not enqueue_ingestion(document.id, path):
        background_tasks.add_task(ingest_document, document.id, str(path))
    return {"id": document.id, "status": "queued"}


@router.get("/knowledge/documents", response_model=list[KnowledgeDocumentSummary])
async def list_documents(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[KnowledgeDocumentSummary]:
    rows = (
        await session.scalars(
            select(KnowledgeDocumentRow)
            .where(
                (KnowledgeDocumentRow.owner_id.is_(None))
                | (KnowledgeDocumentRow.owner_id == user.id)
            )
            .order_by(KnowledgeDocumentRow.created_at.desc())
        )
    ).all()
    return [
        KnowledgeDocumentSummary(
            id=row.id,
            title=row.title,
            filename=row.filename,
            source_url=row.source_url,
            license_type=row.license_type,
            status=row.status,
            error=row.error,
            is_private=row.owner_id is not None,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/knowledge/documents/{document_id}")
async def document_status(
    document_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | None]:
    row = await session.scalar(
        select(KnowledgeDocumentRow).where(
            KnowledgeDocumentRow.id == str(document_id),
            KnowledgeDocumentRow.owner_id == user.id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": row.id, "status": row.status, "error": row.error}


@router.get("/knowledge/documents/{document_id}/status")
async def document_status_alias(
    document_id: UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | None]:
    return await document_status(document_id, user, session)


@router.post("/rag/query", response_model=RagAnswer)
async def rag_query(
    body: RagQuery,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> RagAnswer:
    return await hybrid_search(session, user.id, body)


@router.get("/question-bank/questions", response_model=PracticeQuestionPage)
async def list_practice_questions(
    module: Skill | None = None,
    task_type: str | None = Query(default=None, max_length=64),
    incorrect_only: bool = False,
    search: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=50),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PracticeQuestionPage:
    access_filter = (PracticeQuestionRow.owner_id.is_(None)) | (
        PracticeQuestionRow.owner_id == user.id
    )
    filters = [access_filter]
    if module:
        filters.append(PracticeQuestionRow.module == module.value)
    if task_type:
        filters.append(PracticeQuestionRow.task_type == task_type)
    if search:
        filters.append(PracticeQuestionRow.prompt.ilike(f"%{search.strip()}%"))
    all_rows = list(
        await session.scalars(
            select(PracticeQuestionRow)
            .where(*filters)
            .order_by(PracticeQuestionRow.created_at.desc())
        )
    )
    question_ids = [row.id for row in all_rows]
    attempts = list(
        await session.scalars(
            select(PracticeAttemptRow)
            .where(
                PracticeAttemptRow.user_id == user.id,
                PracticeAttemptRow.question_id.in_(question_ids),
            )
            .order_by(PracticeAttemptRow.created_at.desc())
        )
    ) if question_ids else []
    latest_attempts: dict[str, bool] = {}
    for attempt in attempts:
        latest_attempts.setdefault(attempt.question_id, attempt.is_correct)
    if incorrect_only:
        all_rows = [row for row in all_rows if latest_attempts.get(row.id) is False]
    total = len(all_rows)
    rows = all_rows[(page - 1) * page_size : page * page_size]
    items = [
        PracticeQuestionPreview(
            id=row.id,
            module=row.module,
            task_type=row.task_type,
            question_type=row.question_type,
            prompt=row.prompt,
            passage=row.passage,
            options=row.options,
            tags=row.tags,
            source_name=row.source_name,
            is_public=row.owner_id is None,
            has_answer=bool(row.correct_answer),
            last_attempt_correct=latest_attempts.get(row.id),
            created_at=row.created_at,
        )
        for row in rows
    ]
    return PracticeQuestionPage(
        items=items, total=total, page=page, page_size=page_size
    )


def _normalise_practice_answer(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().strip().split())


@router.post(
    "/question-bank/questions/{question_id}/attempts",
    response_model=QuestionAttemptResult,
    status_code=201,
)
async def submit_practice_attempt(
    question_id: UUID,
    body: QuestionAttemptCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> QuestionAttemptResult:
    row = await session.scalar(
        select(PracticeQuestionRow).where(
            PracticeQuestionRow.id == str(question_id),
            (PracticeQuestionRow.owner_id.is_(None))
            | (PracticeQuestionRow.owner_id == user.id),
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Question not found")
    if not row.correct_answer:
        raise HTTPException(
            status_code=409,
            detail="This question requires writing or speaking feedback and cannot be auto-graded",
        )
    accepted_answers = {
        _normalise_practice_answer(answer)
        for answer in row.correct_answer.split("|")
        if answer.strip()
    }
    is_correct = _normalise_practice_answer(body.answer) in accepted_answers
    previous_count = await session.scalar(
        select(func.count()).select_from(PracticeAttemptRow).where(
            PracticeAttemptRow.user_id == user.id,
            PracticeAttemptRow.question_id == row.id,
        )
    )
    attempt = PracticeAttemptRow(
        user_id=user.id,
        question_id=row.id,
        submitted_answer=body.answer.strip(),
        is_correct=is_correct,
    )
    session.add(attempt)
    await session.commit()
    stored_profile = await get_profile(session, user.id)
    profile_updated = False
    if stored_profile:
        profile, estimates = stored_profile
        skill = Skill(row.module)
        recent_results = list(
            await session.scalars(
                select(PracticeAttemptRow.is_correct)
                .join(
                    PracticeQuestionRow,
                    PracticeQuestionRow.id == PracticeAttemptRow.question_id,
                )
                .where(
                    PracticeAttemptRow.user_id == user.id,
                    PracticeQuestionRow.module == row.module,
                )
                .order_by(PracticeAttemptRow.created_at.desc())
                .limit(20)
            )
        )
        by_skill = {estimate.skill: estimate for estimate in estimates}
        previous = by_skill.get(skill)
        by_skill[skill] = SkillEstimate(
            skill=skill,
            band=previous.band if previous else profile.current_scores[skill],
            confidence=min(0.9, (previous.confidence if previous else 0.5) + 0.02),
            recent_error_rate=1 - sum(recent_results) / len(recent_results),
            days_since_practice=0,
        )
        await save_profile(session, user.id, profile, list(by_skill.values()))
        profile_updated = True
    return QuestionAttemptResult(
        question_id=row.id,
        submitted_answer=attempt.submitted_answer,
        is_correct=is_correct,
        correct_answer=row.correct_answer.replace("|", " / "),
        explanation=row.explanation,
        attempt_number=(previous_count or 0) + 1,
        profile_updated=profile_updated,
    )


@router.get("/question-bank/progress", response_model=QuestionBankProgress)
async def question_bank_progress(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> QuestionBankProgress:
    accessible_rows = list(
        await session.scalars(
            select(PracticeQuestionRow).where(
                (PracticeQuestionRow.owner_id.is_(None))
                | (PracticeQuestionRow.owner_id == user.id)
            )
        )
    )
    accessible = {row.id: row for row in accessible_rows}
    attempts = list(
        await session.scalars(
            select(PracticeAttemptRow)
            .where(
                PracticeAttemptRow.user_id == user.id,
                PracticeAttemptRow.question_id.in_(list(accessible)),
            )
            .order_by(PracticeAttemptRow.created_at.desc())
        )
    ) if accessible else []
    latest: dict[str, bool] = {}
    for attempt in attempts:
        latest.setdefault(attempt.question_id, attempt.is_correct)
    correct = sum(latest.values())
    by_module = {skill: {"attempted": 0, "correct": 0} for skill in Skill}
    for question_id, result in latest.items():
        skill = Skill(accessible[question_id].module)
        by_module[skill]["attempted"] += 1
        by_module[skill]["correct"] += int(result)
    return QuestionBankProgress(
        total_questions=len(accessible),
        attempted_questions=len(latest),
        correct_questions=correct,
        incorrect_questions=len(latest) - correct,
        accuracy=correct / len(latest) if latest else 0,
        by_module=by_module,
    )


@router.post("/question-bank/questions", response_model=PracticeQuestion, status_code=201)
async def create_practice_question(
    body: QuestionImportItem,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PracticeQuestion:
    row = PracticeQuestionRow(owner_id=user.id, **body.model_dump(mode="json"))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return PracticeQuestion(
        **body.model_dump(mode="json"),
        id=row.id,
        is_public=False,
        created_at=row.created_at,
    )


@router.post("/question-bank/import", response_model=QuestionImportResult, status_code=201)
async def import_practice_questions(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> QuestionImportResult:
    filename = Path(file.filename or "questions").name
    if Path(filename).suffix.lower() not in {".json", ".csv"}:
        raise HTTPException(status_code=415, detail="Only JSON and CSV question banks are supported")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Question bank exceeds upload limit")
    try:
        questions = parse_question_file(filename, data)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    rows = [
        PracticeQuestionRow(
            owner_id=user.id,
            **question.model_dump(mode="json"),
        )
        for question in questions
    ]
    session.add_all(rows)
    await session.commit()
    return QuestionImportResult(imported=len(rows), ids=[row.id for row in rows])


@router.post("/agent/runs/stream")
async def stream_agent_run(user: User = Depends(current_user)) -> StreamingResponse:
    async def events():
        for node, message in (
            ("intake", "读取学习目标与时间约束"),
            ("diagnose", "计算四项能力差距"),
            ("retrieve", "检索 IELTS 官方评分依据"),
            ("plan", "生成候选学习任务"),
            ("validate", "执行硬约束校验并等待用户审批"),
        ):
            yield f"data: {json.dumps({'node': node, 'message': message}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.05)
        yield f"data: {json.dumps({'status': 'completed', 'user_id': user.id})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
