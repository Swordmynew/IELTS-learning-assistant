"""Authenticated source text and original-file access for document citations."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import get_settings
from app.db import KnowledgeChunkRow, KnowledgeDocumentRow, User, get_session

router = APIRouter(prefix="/api/v1/knowledge/documents")


async def document_for_user(session, user_id, document_id):
    row = await session.scalar(select(KnowledgeDocumentRow).where(
        KnowledgeDocumentRow.id == str(document_id),
        (KnowledgeDocumentRow.owner_id.is_(None)) | (KnowledgeDocumentRow.owner_id == user_id),
    ))
    if not row:
        raise HTTPException(404, "Document not found")
    return row


def original_path(document):
    root = get_settings().upload_dir.resolve()
    suffix = Path(document.filename).suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt", ".md"}:
        return None
    path = (root / f"{document.id}{suffix}").resolve()
    return path if path.parent == root and path.is_file() else None


@router.get("/{document_id}/chunks")
async def document_chunks(document_id: str, page: int | None = Query(default=None, ge=1), offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200), user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    document = await document_for_user(session, user.id, document_id)
    if document.status != "completed":
        raise HTTPException(409, "资料尚未完成解析")
    criteria = [KnowledgeChunkRow.document_id == document.id]
    if page is not None:
        criteria.append(KnowledgeChunkRow.page == page)
    rows = await session.scalars(select(KnowledgeChunkRow).where(*criteria).order_by(KnowledgeChunkRow.chunk_index).offset(offset).limit(limit))
    pages = list(await session.scalars(select(KnowledgeChunkRow.page).where(KnowledgeChunkRow.document_id == document.id, KnowledgeChunkRow.page.is_not(None)).distinct().order_by(KnowledgeChunkRow.page)))
    total = await session.scalar(select(func.count()).select_from(KnowledgeChunkRow).where(*criteria))
    return {"id": document.id, "title": document.title, "filename": document.filename, "page_numbers": pages,
            "original_available": original_path(document) is not None, "total": total, "offset": offset,
            "items": [{"id": row.id, "page": row.page, "chunk_index": row.chunk_index, "content": row.content} for row in rows]}


@router.get("/{document_id}/file")
async def document_file(document_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    document = await document_for_user(session, user.id, document_id)
    path = original_path(document)
    if not path:
        raise HTTPException(404, "没有本地原文件，可查看资料文字或外部来源")
    return FileResponse(path, filename=document.filename, content_disposition_type="inline", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
