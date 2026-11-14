"""User-owned fragments, source snapshots and review events."""

import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.coach_schemas import KnowledgeBookmark, KnowledgeCreate, KnowledgeReview
from app.db import (
    CoachRecord,
    KnowledgeChunkRow,
    KnowledgeDocumentRow,
    PracticeQuestionRow,
    User,
    get_session,
)
from app.routes.coach import owned
from app.schemas import RagQuery
from app.services.learning_memory import (
    TOPICS,
    event_stats,
    memory_catalog,
    record_event,
    topic_groups,
    topics_for,
)
from app.services.personal_knowledge import index_payload, knowledge_view
from app.services.search_repository import retrieve_sources

router = APIRouter(prefix="/api/v1")


async def related_records(session: AsyncSession, user_id: str, ids: list) -> list[CoachRecord]:
    return [await owned(session, user_id, str(item), "knowledge") for item in dict.fromkeys(ids)]


async def save_fragment(session: AsyncSession, user_id: str, key: str, data: dict) -> dict:
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    existing = await session.scalar(select(CoachRecord).where(
        CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge", CoachRecord.source_key == key
    ))
    if existing:
        if existing.payload.get("deleted") or existing.payload.get("request_digest") != digest:
            raise HTTPException(409, "This fragment already exists or its request ID was reused; edit the saved item")
        return knowledge_view(existing)
    row = CoachRecord(id=str(uuid4()), user_id=user_id, kind="knowledge", source_key=key)
    data = {
        **data, "category": "note", "status": "saved", "request_digest": digest,
        "source_link": data.get("source_link") or f"/resources?item={row.id}",
        "updated_at": datetime.now(UTC).isoformat(),
    }
    data["topic_tags"] = topics_for(data)
    data["topic_origin"] = data.get("topic_origin", "suggested")
    await index_payload(data)
    row.payload = data
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError:
        existing = await session.scalar(select(CoachRecord).where(
            CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge", CoachRecord.source_key == key
        ))
        if not existing:
            raise
        if existing.payload.get("deleted") or existing.payload.get("request_digest") != digest:
            raise HTTPException(409, "The fragment request conflicts with an existing record") from None
        return knowledge_view(existing)
    await record_event(session, row, key, event_type="capture")
    await session.commit()
    return knowledge_view(row)


@router.post("/knowledge/items", status_code=201)
async def create_fragment(body: KnowledgeCreate, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    related = await related_records(session, user.id, body.related_ids)
    data = body.model_dump(mode="json", exclude={"request_id"})
    data["topic_tags"] = sorted(set(body.topic_tags) | {tag for row in related for tag in topics_for(row.payload)})
    data.update(provenance="user-authored-note", source_summary="手工笔记", source_kind="manual", topic_origin="user" if body.topic_tags else "linked" if related else "suggested")
    return await save_fragment(session, user.id, f"note:{body.request_id}", data)


@router.get("/knowledge/topics")
async def topics(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    rows, events = await memory_catalog(session, user.id)
    return {"presets": [{"id": tag, "label": label} for tag, label in TOPICS.items()], "items": topic_groups(rows, events)}


@router.get("/knowledge/items/{item_id}/events")
async def events(item_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    await owned(session, user.id, item_id, "knowledge")
    _, events_by_item = await memory_catalog(session, user.id)
    return events_by_item.get(item_id, [])


@router.post("/knowledge/items/{item_id}/reviews")
async def review(item_id: str, body: KnowledgeReview, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    row = await owned(session, user.id, item_id, "knowledge")
    snapshot = {**row.payload, "content": body.note, "status": body.outcome, "provenance": "user-self-review"}
    created = await record_event(session, row, str(body.request_id), event_type="self_review", snapshot=snapshot)
    if created:
        row.payload = {**row.payload, "status": body.outcome, "state_source": "self_review", "updated_at": datetime.now(UTC).isoformat()}
        await session.commit()
    _, events_by_item = await memory_catalog(session, user.id)
    return {**knowledge_view(row), **event_stats(events_by_item.get(row.id, []))}


@router.post("/knowledge/bookmarks", status_code=201)
async def bookmark(body: KnowledgeBookmark, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    source_id = str(body.source_id)
    if body.chunk_id and body.source_type != "document":
        raise HTTPException(422, "chunk_id is only valid for document excerpts")
    related = await related_records(session, user.id, body.related_ids)
    source_url, page = None, None
    if body.source_type == "question":
        row = await session.scalar(select(PracticeQuestionRow).where(
            PracticeQuestionRow.id == source_id,
            (PracticeQuestionRow.owner_id.is_(None)) | (PracticeQuestionRow.owner_id == user.id),
        ))
        if not row:
            raise HTTPException(404, "Question not found")
        text = f"{row.prompt}\n{row.passage or ''}"
        title, module = row.prompt[:160], row.module
        link = f"/question-bank?module={row.module}&question={row.id}"
        provenance, summary = "practice-excerpt", "练习原文摘录"
    elif body.source_type == "writing_version":
        row = await owned(session, user.id, source_id, "writing_version")
        writing = await owned(session, user.id, row.parent_id, "writing_session")
        text, title, module = row.payload["essay"], writing.payload["prompt"][:160], "writing"
        link = f"/writing?session={writing.id}&version={row.id}"
        provenance, summary = "learner-writing-excerpt", "作文原文摘录"
    elif body.source_type == "conversation":
        row = await owned(session, user.id, source_id, "conversation")
        messages = row.payload.get("messages", [])
        if body.message_index is None or body.message_index >= len(messages):
            raise HTTPException(404, "Answer not found")
        message = messages[body.message_index]
        if message.get("context_stale") or message.get("mode") not in {"live", "cache"}:
            raise HTTPException(409, "Only current generated answers can be bookmarked")
        text, title, module = message["answer"], message["query"][:160], "general"
        link = f"/resources?conversation={row.id}"
        provenance, summary = "ai-answer-bookmark", "AI 答疑摘录"
    else:
        document = await session.scalar(select(KnowledgeDocumentRow).where(
            KnowledgeDocumentRow.id == source_id, KnowledgeDocumentRow.status == "completed",
            (KnowledgeDocumentRow.owner_id.is_(None)) | (KnowledgeDocumentRow.owner_id == user.id),
        ))
        if not document:
            raise HTTPException(404, "Document not found")
        chunks = list(await session.scalars(select(KnowledgeChunkRow).where(KnowledgeChunkRow.document_id == document.id).order_by(KnowledgeChunkRow.chunk_index)))
        if body.chunk_id:
            chunks = [chunk for chunk in chunks if chunk.id == body.chunk_id]
            if not chunks:
                raise HTTPException(404, "Source chunk not found in this document")
        text, title, module = "\n".join(chunk.content for chunk in chunks), document.title[:160], "general"
        source_url = document.source_url
        if body.excerpt:
            match = next((chunk for chunk in chunks if body.excerpt in chunk.content), None)
            page = match.page if match else None
        link = f"/resources?document={document.id}" + (f"&page={page}" if page else "")
        provenance, summary = "document-excerpt", "资料原文摘录"
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    excerpt = body.excerpt.replace("\r\n", "\n").replace("\r", "\n").strip() if body.excerpt else text[:8000].strip()
    if not excerpt or excerpt not in text:
        raise HTTPException(422, "The excerpt must occur verbatim in the selected source")
    key = "bookmark:" + hashlib.sha256((f"{body.source_type}:{source_id}:{body.message_index}:{excerpt}" + (f":chunk:{body.chunk_id}" if body.chunk_id else "")).encode()).hexdigest()
    data = {
        "title": body.title.strip() or title, "content": excerpt, "note": body.note,
        "module": module, "source_link": link, "source_url": source_url, "page": page,
        "source_kind": "bookmark", "source_summary": summary, "provenance": provenance,
        "source_ref": {"type": body.source_type, "id": source_id, "message_index": body.message_index, **({"chunk_id": body.chunk_id} if body.chunk_id else {})},
        "topic_tags": sorted(set(body.topic_tags) | {tag for row in related for tag in topics_for(row.payload)}),
        "related_ids": [str(item) for item in body.related_ids],
    }
    return await save_fragment(session, user.id, key, data)


@router.post("/rag/preview")
async def preview(body: RagQuery, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    citations, _, model = await retrieve_sources(session, user.id, body)
    return {"citations": [citation.model_dump() for citation in citations], "embedding_model": model, "generated": False}
