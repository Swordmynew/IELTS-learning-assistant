from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db import CoachRecord, User, get_session
from app.services.vocabulary_extraction import enqueue_extraction, job_view, writing_source
from app.services.word_deck import deck, edit_word, review_word, study_queue
from app.vocabulary_schemas import ExtractionRequest, WordEdit, WordReview

router = APIRouter(prefix="/api/v1/vocabulary")


@router.get("/deck")
async def get_deck(
    scope: Literal["all", "personal", "due", "new", "learned", "suspended"] = "all",
    q: str = Query(default="", max_length=100), offset: int = Query(default=0, ge=0), limit: int = Query(default=40, ge=1, le=100),
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    return await deck(session, user.id, scope, q, offset, limit)


@router.get("/study")
async def get_study_queue(
    limit: int = Query(default=20, ge=1, le=50), new_limit: int = Query(default=10, ge=0, le=30),
    scope: Literal["all", "personal", "due"] = "all",
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    return await study_queue(session, user.id, limit, new_limit, scope)


@router.post("/reviews")
async def record_review(body: WordReview, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await review_word(session, user.id, body)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Card changed; reload before saving") from None


@router.patch("/words")
async def update_word(body: WordEdit, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await edit_word(session, user.id, body)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Card changed; reload before saving") from None


@router.post("/extractions", status_code=202)
async def request_extraction(body: ExtractionRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return job_view(await enqueue_extraction(session, user.id, body.source_id, body.source_kind, body.request_type, retry=True))


@router.get("/extractions")
async def list_extractions(
    source_id: str = Query(min_length=1, max_length=100), source_kind: Literal["writing_version", "assessment"] = "writing_version",
    user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
):
    await writing_source(session, user.id, source_id, source_kind)
    rows = await session.scalars(select(CoachRecord).where(CoachRecord.user_id == user.id, CoachRecord.kind == "vocabulary_job").order_by(CoachRecord.created_at))
    return [job_view(row) for row in rows if row.payload["source_id"] == source_id and row.payload["source_kind"] == source_kind]
