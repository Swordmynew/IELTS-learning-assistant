from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.coach_schemas import (
    CoachQuestion,
    Feedback,
    Hint,
    KnowledgeEdit,
    KnowledgeMerge,
    SessionCreate,
    TutorAnswer,
    VersionCreate,
)
from app.db import CoachRecord, LearnerProfileRow, User, WritingAssessmentRow, get_session
from app.schemas import RagQuery
from app.services.coach_model import generate
from app.services.coach_prompts import TUTOR_GROUNDING
from app.services.personal_knowledge import backfill, index_payload, knowledge_view, put_knowledge
from app.services.rag import retrieve_official_rubric
from app.services.search_repository import retrieve_sources
from app.services.vocabulary_extraction import enqueue_safely
from app.services.writing import normalize_assessment, validate_assessment

router = APIRouter(prefix="/api/v1")


@router.get("/coach/demo")
async def demo(user: User = Depends(current_user)):
    from app.services.coach_demo import DEMO

    return DEMO


@router.get("/writing/assessments/{assessment_id}")
async def historical_assessment(
    assessment_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await session.scalar(
        select(WritingAssessmentRow).where(
            WritingAssessmentRow.user_id == user.id, WritingAssessmentRow.id == assessment_id
        )
    )
    if not row:
        raise HTTPException(404, "Assessment not found")
    return {"submission": row.submission, "assessment": row.assessment}


@router.get("/vocabulary/tests/{test_id}/review")
async def vocabulary_review(
    test_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    from app.services.vocabulary import ITEMS_BY_ID, get_vocabulary_test

    row = await get_vocabulary_test(session, user.id, test_id)
    if row.status != "completed":
        raise HTTPException(409, "Complete this test before reviewing answers")
    records = []
    for response in row.responses:
        item = ITEMS_BY_ID.get(response["item_id"])
        if item:
            options = [*item.options, "以上都不是"]
            records.append(
                {
                    "word": item.surface,
                    "selected": options[response["selected_option"]],
                    "meaning": options[item.correct_index],
                    "correct": response["correct"],
                }
            )
    return records


async def owned(session: AsyncSession, user_id: str, record_id: str, kind: str) -> CoachRecord:
    row = await session.scalar(
        select(CoachRecord).where(
            CoachRecord.id == record_id, CoachRecord.user_id == user_id, CoachRecord.kind == kind
        )
    )
    if not row or row.payload.get("deleted"):
        raise HTTPException(404, "Record not found")
    return row


def view(row: CoachRecord) -> dict:
    return {
        "id": row.id,
        "parent_id": row.parent_id,
        "created_at": row.created_at.isoformat(),
        **row.payload,
    }


@router.post("/knowledge/backfill")
async def backfill_knowledge(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    return {"processed": await backfill(session, user.id)}


@router.get("/knowledge/items")
async def list_knowledge(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    rows = await session.scalars(
        select(CoachRecord)
        .where(CoachRecord.user_id == user.id, CoachRecord.kind == "knowledge")
        .order_by(CoachRecord.created_at.desc())
    )
    return [knowledge_view(row) for row in rows if not row.payload.get("deleted")]


@router.patch("/knowledge/items/{item_id}")
async def update_knowledge(
    item_id: str,
    body: KnowledgeEdit,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned(session, user.id, item_id, "knowledge")
    data = {**row.payload, **body.model_dump(), "updated_at": datetime.now(UTC).isoformat()}
    await index_payload(data)
    row.payload = data
    await session.commit()
    return knowledge_view(row)


@router.delete("/knowledge/items/{item_id}", status_code=204)
async def delete_knowledge(
    item_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    row = await owned(session, user.id, item_id, "knowledge")
    row.payload = {"deleted": True}
    await session.commit()


@router.post("/knowledge/items/{item_id}/merge")
async def merge_knowledge(
    item_id: str,
    body: KnowledgeMerge,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    target = await owned(session, user.id, item_id, "knowledge")
    others = [
        await owned(session, user.id, item, "knowledge")
        for item in set(body.source_ids)
        if item != item_id
    ]
    if any(row.payload.get("category") != target.payload.get("category") for row in others):
        raise HTTPException(400, "Only records of the same type can be merged")
    data = dict(target.payload)
    merged = dict(data.get("merged_records", {}))
    for row in others:
        merged[row.source_key] = {
            "title": row.payload["title"],
            "content": row.payload["content"],
            "source_link": row.payload["source_link"],
            "status": row.payload.get("status"),
            "note": row.payload.get("note", ""),
            "source_summary": knowledge_view(row).get("source_summary", ""),
        }
        merged.update(row.payload.get("merged_records", {}))
    data["merged_records"] = merged
    data["merged_sources"] = [*data.get("merged_sources", []), *[r.source_key for r in others]]
    data["updated_at"] = datetime.now(UTC).isoformat()
    await index_payload(data)
    target.payload = data
    for row in others:
        row.payload = {"deleted": True, "merged_into": target.id}
    await session.commit()
    return knowledge_view(target)


@router.get("/knowledge/conversations")
async def conversations(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    rows = await session.scalars(
        select(CoachRecord)
        .where(CoachRecord.user_id == user.id, CoachRecord.kind == "conversation")
        .order_by(CoachRecord.created_at.desc())
    )
    return [view(row) for row in rows]


@router.post("/writing/sessions", status_code=201)
async def create_session(
    body: SessionCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = CoachRecord(user_id=user.id, kind="writing_session", payload={"prompt": body.prompt})
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return view(row)


@router.get("/writing/sessions")
async def list_sessions(
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    rows = await session.scalars(
        select(CoachRecord)
        .where(CoachRecord.user_id == user.id, CoachRecord.kind == "writing_session")
        .order_by(CoachRecord.created_at.desc())
    )
    return [view(row) for row in rows]


@router.get("/writing/sessions/{session_id}")
async def get_writing_session(
    session_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned(session, user.id, session_id, "writing_session")
    versions = await session.scalars(
        select(CoachRecord)
        .where(
            CoachRecord.user_id == user.id,
            CoachRecord.kind == "writing_version",
            CoachRecord.parent_id == session_id,
        )
        .order_by(CoachRecord.created_at)
    )
    return {**view(row), "versions": [view(version) for version in versions]}


@router.post("/writing/sessions/{session_id}/versions", status_code=201)
async def create_version(
    session_id: str,
    body: VersionCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    await owned(session, user.id, session_id, "writing_session")
    latest = await session.scalar(
        select(CoachRecord)
        .where(
            CoachRecord.user_id == user.id,
            CoachRecord.kind == "writing_version",
            CoachRecord.parent_id == session_id,
        )
        .order_by(CoachRecord.created_at.desc())
    )
    if latest and latest.payload["essay"] == body.essay:
        return view(latest)
    row = CoachRecord(
        user_id=user.id,
        kind="writing_version",
        parent_id=session_id,
        payload={"essay": body.essay, "status": "pending", "feedback": None},
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return view(row)


@router.post("/writing/versions/{version_id}/assess")
async def assess_version(
    version_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    version = await owned(session, user.id, version_id, "writing_version")
    if version.payload.get("feedback"):
        await enqueue_safely(session, user.id, version.id)
        return view(version)
    writing = await owned(session, user.id, version.parent_id, "writing_session")
    prior = list(
        await session.scalars(
            select(CoachRecord)
            .where(
                CoachRecord.user_id == user.id,
                CoachRecord.kind == "writing_version",
                CoachRecord.parent_id == writing.id,
                CoachRecord.created_at < version.created_at,
            )
            .order_by(CoachRecord.created_at.desc())
        )
    )
    previous = next((item for item in prior if item.payload.get("feedback")), None)
    essay = version.payload["essay"]
    citations = retrieve_official_rubric("writing task response coherence lexical grammar")
    personal_citations, personal_hits, _ = await retrieve_sources(
        session, user.id, RagQuery(query=f"{writing.payload['prompt']} {essay}"[:2000])
    )
    matched = [
        hit
        for hit, citation in zip(personal_hits, personal_citations, strict=True)
        if citation.source_type not in ("public", "document")
        and not (citation.source_link or "").startswith(f"/writing?session={writing.id}")
    ][:3]
    context = {
        "prompt": writing.payload["prompt"],
        "essay": essay,
        "public_rubric": [c.model_dump() for c in citations],
        "personal_learning": [{"id": h.chunk_id, "content": h.content} for h in matched],
        "previous": {
            "essay": previous.payload["essay"],
            "issues": previous.payload["feedback"]["data"]["issues"],
        }
        if previous
        else None,
    }
    previous_issue_ids = (
        [issue["id"] for issue in context["previous"]["issues"]] if previous else []
    )
    context["required_comparison_ids"] = previous_issue_ids
    allowed_personal = {hit.chunk_id for hit in matched}
    allowed_citations = {c.source_id for c in citations}

    def validate(value: Feedback) -> Feedback:
        if len(value.assessment.criteria) != 4 or any(
            not criterion.evidence for criterion in value.assessment.criteria
        ):
            raise ValueError("Exactly four criteria with essay evidence are required")
        for issue in value.issues:
            if issue.quote not in essay or set(issue.source_ids) - allowed_citations:
                raise ValueError("Invalid issue evidence")
        if len({issue.id for issue in value.issues}) != len(value.issues):
            raise ValueError("Duplicate issue IDs")
        if set(value.personal_source_ids) - allowed_personal:
            raise ValueError("Invalid personal citation")
        if value.personal_note and not value.personal_source_ids:
            raise ValueError("Personal advice requires evidence")
        if previous:
            old_issues = {
                issue["id"]: issue for issue in previous.payload["feedback"]["data"]["issues"]
            }
            if {i.issue_id for i in value.improvements} != set(old_issues) or len(
                value.improvements
            ) != len(old_issues):
                raise ValueError("Each previous issue requires a comparison")
            for item in value.improvements:
                if (
                    item.old_quote != old_issues[item.issue_id]["quote"]
                    or item.new_quote not in essay
                ):
                    raise ValueError("Comparison quotes must be exact")
                if item.status == "improved" and item.new_quote in previous.payload["essay"]:
                    raise ValueError("Unchanged quote cannot establish improvement")
        elif value.improvements:
            raise ValueError("Initial version cannot compare a prior version")
        value.assessment = normalize_assessment(value.assessment, essay, citations)
        if validate_assessment(value.assessment, essay):
            raise ValueError("Invalid assessment")
        return value

    result = await generate(
        session,
        user.id,
        "writing",
        context,
        Feedback,
        "Assess Task 2 against public_rubric only. Return up to three issues with exact essay quotes, goals and public source IDs. "
        "On revision compare every previous issue using exact old and new quotations. "
        f"The improvements array must contain exactly {len(previous_issue_ids)} entries with issue_id values {previous_issue_ids}, including unresolved issues. "
        "Copy each previous issue's quote exactly into old_quote; choose new_quote from the current essay. "
        "Assign current issue IDs issue_1, issue_2, issue_3. "
        "Personal notes inform learning advice and require personal_source_ids. Ground observations in the learner's original examples.",
        validate,
    )
    if not result:
        version.payload = {**version.payload, "status": "unavailable"}
        await session.commit()
        await enqueue_safely(session, user.id, version.id)
        return {
            **view(version),
            "mode": "offline",
            "message": "模型暂不可用，稿件已保存。可重试或打开独立示例。",
        }
    result.data["assessment"]["model_used"] = result.model
    result.data["assessment"]["id"] = version.id
    result.citations = [
        citation
        for citation in personal_citations
        if citation.source_id in result.data["personal_source_ids"]
    ]
    version.payload = {
        **version.payload,
        "status": "assessed",
        "feedback": result.model_dump(mode="json"),
    }
    session.add(
        WritingAssessmentRow(
            id=version.id,
            user_id=user.id,
            submission={
                "task_type": "writing_task_2",
                "prompt": writing.payload["prompt"],
                "essay": essay,
            },
            assessment=result.data["assessment"],
        )
    )
    if not writing.payload.get("profile_updated") and not prior:
        from app.repository import get_profile
        from app.schemas import Skill, SkillEstimate
        from app.services.writing import round_band

        stored = await get_profile(session, user.id)
        if stored:
            profile, estimates = stored
            scores = dict(profile.current_scores)
            scores[Skill.writing] = round_band(
                0.7 * scores[Skill.writing]
                + 0.3 * result.data["assessment"]["estimated_overall_band"]
            )
            estimates_by_skill = {item.skill: item for item in estimates}
            estimates_by_skill[Skill.writing] = SkillEstimate(
                skill=Skill.writing,
                band=scores[Skill.writing],
                confidence=0.6,
                days_since_practice=0,
            )
            profile_row = await session.scalar(
                select(LearnerProfileRow).where(LearnerProfileRow.user_id == user.id)
            )
            profile_row.payload = profile.model_copy(update={"current_scores": scores}).model_dump(
                mode="json"
            )
            profile_row.estimates = [
                item.model_dump(mode="json") for item in estimates_by_skill.values()
            ]
            writing.payload = {**writing.payload, "profile_updated": True}
    for issue in result.data["issues"]:
        await put_knowledge(
            session,
            user.id,
            f"writing:{version.id}:{issue['id']}",
            issue["criterion"],
            f"原句：{issue['quote']}\nAI 反馈：{issue['explanation']}\n目标：{issue['goal']}",
            "writing",
            "writing",
            f"/writing?session={writing.id}&version={version.id}",
            event_id=version.id,
        )
    if previous:
        for improvement in result.data["improvements"]:
            old_note = await session.scalar(
                select(CoachRecord).where(
                    CoachRecord.user_id == user.id,
                    CoachRecord.kind == "knowledge",
                    CoachRecord.source_key == f"writing:{previous.id}:{improvement['issue_id']}",
                )
            )
            if old_note and not old_note.payload.get("deleted"):
                old_note.payload = {
                    **old_note.payload,
                    "status": improvement["status"],
                    "updated_at": datetime.now(UTC).isoformat(),
                }
    await session.commit()
    await enqueue_safely(session, user.id, version.id)
    return view(version)


@router.post("/writing/versions/{version_id}/issues/{issue_id}/hints/{level}")
async def hint(
    version_id: str,
    issue_id: str,
    level: int,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    if level not in (1, 2, 3):
        raise HTTPException(400, "Hint level must be 1, 2 or 3")
    version = await owned(session, user.id, version_id, "writing_version")
    feedback = version.payload.get("feedback")
    issue = next(
        (x for x in (feedback or {}).get("data", {}).get("issues", []) if x["id"] == issue_id), None
    )
    if not issue:
        raise HTTPException(404, "Issue not found")
    result = await generate(
        session,
        user.id,
        "hint",
        {"issue": issue, "level": level},
        Hint,
        "Give only the requested hint: 1 a thinking question; 2 a direction; 3 a short local rewrite example.",
        prefer_cache=True,
    )
    if not result:
        raise HTTPException(503, "模型暂不可用，可重试或查看离线示例")
    return result


@router.post("/writing/versions/{version_id}/questions")
async def ask_writing(
    version_id: str,
    body: CoachQuestion,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    version = await owned(session, user.id, version_id, "writing_version")
    writing = await owned(session, user.id, version.parent_id, "writing_session")
    conversation = await session.scalar(
        select(CoachRecord).where(
            CoachRecord.user_id == user.id,
            CoachRecord.kind == "conversation",
            CoachRecord.parent_id == version.id,
        )
    )
    history = conversation.payload.get("messages", []) if conversation else []
    citations, hits, _ = await retrieve_sources(
        session,
        user.id,
        RagQuery(query=" ".join([*[m["query"] for m in history[-2:]], body.query])[-2000:]),
    )
    allowed = {c.source_id for c in citations}

    def validate(value: TutorAnswer) -> TutorAnswer:
        if set(value.source_ids) - allowed or (value.sufficient and not value.source_ids):
            raise ValueError("Invalid source")
        return value

    result = await generate(
        session,
        user.id,
        "writing_question",
        {
            "question": body.query,
            "prompt": writing.payload["prompt"],
            "essay": version.payload["essay"],
            "history": history[-6:],
            "feedback": version.payload.get("feedback"),
            "sources": [
                {**c.model_dump(), "full_text": hit.content}
                for c, hit in zip(citations, hits, strict=True)
            ],
        },
        TutorAnswer,
        "Answer the student's question about this essay. " + TUTOR_GROUNDING,
        validate,
    )
    if not result:
        return {
            "mode": "offline",
            "answer": "模型暂不可用，可重试或打开独立示例。",
            "citations": [],
        }
    data = TutorAnswer.model_validate(result.data)
    answer = data.answer if data.sufficient else "当前资料不足以回答这个问题。"
    selected = (
        [c.model_dump() for c in citations if c.source_id in data.source_ids]
        if data.sufficient
        else []
    )
    messages = [
        *history,
        {
            "query": body.query,
            "answer": answer,
            "citations": selected,
            "mode": result.mode,
            "generated_at": result.generated_at,
        },
    ]
    if conversation:
        conversation.payload = {"messages": messages}
    else:
        session.add(
            CoachRecord(
                user_id=user.id,
                kind="conversation",
                parent_id=version.id,
                payload={"messages": messages},
            )
        )
    await session.commit()
    return {
        "mode": result.mode,
        "answer": answer,
        "citations": selected,
        "generated_at": result.generated_at,
    }
