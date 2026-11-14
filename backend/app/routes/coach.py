from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.coach_schemas import (
    CoachQuestion,
    Hint,
    KnowledgeEdit,
    KnowledgeMerge,
    SessionCreate,
    TutorAnswer,
    VersionCreate,
)
from app.db import CoachRecord, User, WritingAssessmentRow, get_session
from app.schemas import RagQuery
from app.services.coach_model import generate, generation_failure_message
from app.services.coach_prompts import TUTOR_GROUNDING, WRITING_FEEDBACK
from app.services.learning_memory import (
    event_stats,
    invalidate_memory,
    memory_catalog,
    record_event,
    topics_for,
    usable_history,
)
from app.services.personal_knowledge import backfill, index_payload, knowledge_view, put_knowledge
from app.services.rag import retrieve_official_rubric
from app.services.retrieval_context import bounded_history, pack_evidence, retrieval_question
from app.services.search_repository import retrieve_sources
from app.services.tutor_citations import render_tutor_answer, validate_tutor_answer
from app.services.vocabulary_extraction import enqueue_safely
from app.services.writing_feedback import WritingFeedbackDraft, bind_writing_feedback

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
    rows, events = await memory_catalog(session, user.id)
    return [{**knowledge_view(row), **event_stats(events.get(row.id, []))} for row in rows]


@router.patch("/knowledge/items/{item_id}")
async def update_knowledge(
    item_id: str,
    body: KnowledgeEdit,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned(session, user.id, item_id, "knowledge")
    updates = body.model_dump(mode="json", exclude_unset=True)
    if any(value is None for key, value in updates.items() if key != "source_url"):
        raise HTTPException(422, "Only source_url may be cleared with null")
    if ("content" in updates or "source_url" in updates) and row.payload.get("source_kind") != "manual":
        raise HTTPException(409, "Original practice and bookmark snapshots are immutable; edit your note")
    if "related_ids" in updates:
        for related_id in updates["related_ids"]:
            if related_id == item_id:
                raise HTTPException(422, "A record cannot link to itself")
            await owned(session, user.id, related_id, "knowledge")
    if "topic_tags" in updates:
        updates["topic_origin"] = "user"
    data = {**row.payload, **updates, "updated_at": datetime.now(UTC).isoformat()}
    await index_payload(data)
    row.payload = data
    await invalidate_memory(session, user.id, {row.id})
    await session.commit()
    return knowledge_view(row)


@router.delete("/knowledge/items/{item_id}", status_code=204)
async def delete_knowledge(
    item_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
):
    row = await owned(session, user.id, item_id, "knowledge")
    row.payload = {"deleted": True}
    await invalidate_memory(session, user.id, {row.id})
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
            "item_id": row.id,
            "title": row.payload["title"],
            "content": row.payload["content"],
            "source_link": row.payload["source_link"],
            "status": row.payload.get("status"),
            "note": row.payload.get("note", ""),
            "source_summary": knowledge_view(row).get("source_summary", ""),
        }
        merged.update(row.payload.get("merged_records", {}))
    data["merged_records"] = merged
    data["topic_tags"] = sorted(set(topics_for(target.payload)) | {tag for row in others for tag in topics_for(row.payload)})
    data["merged_sources"] = [*data.get("merged_sources", []), *[r.source_key for r in others]]
    data["updated_at"] = datetime.now(UTC).isoformat()
    await index_payload(data)
    target.payload = data
    for row in others:
        row.payload = {"deleted": True, "merged_into": target.id}
    await invalidate_memory(session, user.id, {target.id, *[row.id for row in others]})
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
        "personal_learning": [
            {"id": h.chunk_id, "content": h.content,
             "provenance": next(c.provenance for c in personal_citations if c.source_id == h.chunk_id),
             "source_type": next(c.source_type for c in personal_citations if c.source_id == h.chunk_id),
             "memory_status": next(c.memory_status for c in personal_citations if c.source_id == h.chunk_id),
             "memory_state_source": next(c.memory_state_source for c in personal_citations if c.source_id == h.chunk_id)}
            for h in matched
        ],
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

    def validate(value: WritingFeedbackDraft) -> WritingFeedbackDraft:
        bind_writing_feedback(value, essay, citations, allowed_personal, context["previous"])
        return value

    failure = {}
    result = await generate(
        session,
        user.id,
        "writing",
        context,
        WritingFeedbackDraft,
        WRITING_FEEDBACK,
        validate,
        failure=failure,
    )
    if not result:
        reason = failure.get("reason", "generation_failed")
        message = generation_failure_message(reason) + "稿件已保存，可重试。"
        version.payload = {**version.payload, "status": "unavailable", "failure_reason": reason,
                           "failure_message": message}
        await session.commit()
        await enqueue_safely(session, user.id, version.id)
        return {
            **view(version),
            "mode": "offline",
            "message": message,
        }
    result.data = bind_writing_feedback(
        WritingFeedbackDraft.model_validate(result.data), essay, citations, allowed_personal,
        context["previous"],
    ).model_dump(mode="json")
    result.data["assessment"]["model_used"] = result.model
    result.data["assessment"]["id"] = version.id
    result.citations = [
        citation
        for citation in personal_citations
        if citation.source_id in result.data["personal_source_ids"]
    ]
    version.payload = {
        **{key: value for key, value in version.payload.items()
           if key not in ("failure_reason", "failure_message")},
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
        from app.repository import get_profile, lock_planning_user, save_profile
        from app.schemas import Skill, SkillEstimate
        from app.services.writing import round_band

        await lock_planning_user(session, user.id)
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
            await save_profile(session, user.id, profile.model_copy(update={"current_scores": scores}), list(estimates_by_skill.values()))
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
                    "state_source": "writing_revision",
                    "updated_at": datetime.now(UTC).isoformat(),
                }
                await record_event(session, old_note, version.id, event_type="revision")
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
    failure = {}
    result = await generate(
        session,
        user.id,
        "hint",
        {"issue": issue, "level": level},
        Hint,
        "Give only the requested hint: 1 a thinking question; 2 a direction; 3 a short local rewrite example.",
        prefer_cache=True,
        failure=failure,
    )
    if not result:
        raise HTTPException(503, generation_failure_message(failure.get("reason")))
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
    reference_history = conversation.payload.get("messages", []) if conversation else []
    history = usable_history(reference_history)
    citations, hits, _ = await retrieve_sources(
        session,
        user.id,
        RagQuery(query=(retrieval_question(body.query, reference_history) + " " + version.payload["essay"])[:2000], module="writing"),
    )
    citations, evidence = pack_evidence(citations, hits, body.query)
    def validate(value: TutorAnswer) -> TutorAnswer:
        return validate_tutor_answer(value, citations)

    failure = {}
    result = await generate(
        session,
        user.id,
        "writing_question",
        {
            "question": body.query,
            "prompt": writing.payload["prompt"],
            "essay": version.payload["essay"],
            "history": bounded_history(history),
            "feedback": version.payload.get("feedback"),
            "sources": evidence,
        },
        TutorAnswer,
        "Answer the student's question about this essay. " + TUTOR_GROUNDING,
        validate,
        failure=failure,
    )
    if not result:
        return {
            "mode": "offline",
            "answer": generation_failure_message(failure.get("reason")),
            "citations": [],
            "failure_reason": failure.get("reason", "generation_failed"),
        }
    data = TutorAnswer.model_validate(result.data)
    response_mode = result.mode if data.sufficient else "insufficient"
    system_message_key = None if data.sufficient else "rag.insufficientEvidence"
    retrieved_sources = [] if data.sufficient else [c.model_dump() for c in citations]
    answer = render_tutor_answer(data, citations) if data.sufficient else "当前资料不足以回答这个问题。"
    selected = (
        [c.model_dump() for c in citations if c.source_id in data.source_ids]
        if data.sufficient
        else []
    )
    messages = [
        *reference_history,
        {
            "query": body.query,
            "context_source_ids": [c.source_id for c in citations],
            "answer": answer,
            "citations": selected,
            "mode": response_mode,
            "system_message_key": system_message_key,
            "generation_mode": result.mode,
            "retrieved_sources": retrieved_sources,
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
        "mode": response_mode,
        "system_message_key": system_message_key,
        "generation_mode": result.mode,
        "retrieved_sources": retrieved_sources,
        "answer": answer,
        "citations": selected,
        "generated_at": result.generated_at,
    }
