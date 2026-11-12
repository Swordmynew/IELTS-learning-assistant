from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import KnowledgeChunkRow, KnowledgeDocumentRow, SessionLocal
from app.services.embeddings import embed_text


def _chunk_text(text: str, target_words: int = 350) -> list[str]:
    chunks, current = [], ""
    char_limit = target_words * 6
    for paragraph in (line.strip() for line in text.splitlines() if line.strip()):
        while paragraph:
            if len(paragraph) > char_limit:
                boundary = paragraph.rfind(" ", 0, char_limit)
                boundary = boundary if boundary >= char_limit // 2 else char_limit
            else:
                boundary = len(paragraph)
            piece, paragraph = paragraph[:boundary].strip(), paragraph[boundary:].strip()
            if current and (len(current) + len(piece) > char_limit or len(re.findall(r"\S+", current + " " + piece)) > target_words):
                chunks.append(current)
                current = ""
            current = (current + "\n" + piece).strip()
    if current:
        chunks.append(current)
    return chunks


def _extract_pdf(path: Path) -> list[tuple[str, int]]:
    from pypdf import PdfReader

    reader = PdfReader(path)
    if reader.is_encrypted and not reader.decrypt(""):
        raise RuntimeError("PDF 已加密，请先解密后上传")
    chunks = []
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if not text.strip() and len(page.images):
            raise RuntimeError(f"PDF 第 {number} 页需要 OCR；当前支持文本型 PDF")
        chunks.extend((chunk, number) for chunk in _chunk_text(text))
    if not chunks:
        raise RuntimeError("PDF 中没有可检索文字；扫描件需要先做 OCR")
    return chunks


def _extract(path: Path) -> list[tuple[str, int | None]]:
    if path.suffix.lower() == ".pdf":
        return _extract_pdf(path)
    if path.suffix.lower() in {".txt", ".md"}:
        return [(chunk, None) for chunk in _chunk_text(path.read_text(encoding="utf-8"))]
    os.environ.setdefault(
        "HF_HOME", str(get_settings().huggingface_cache_path.resolve())
    )
    try:
        from docling.document_converter import DocumentConverter
        from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    except ImportError as error:
        raise RuntimeError(
            "DOCX ingestion requires the optional 'documents' dependency"
        ) from error
    document = DocumentConverter().convert(source=str(path)).document
    chunks = HybridChunker().chunk(document)
    return [(item.text, None) for item in chunks if item.text.strip()]


async def _persist(document_id: str, path: Path) -> None:
    async with SessionLocal() as session:
        document = await session.scalar(
            select(KnowledgeDocumentRow).where(KnowledgeDocumentRow.id == document_id)
        )
        if not document:
            return
        try:
            extracted = await asyncio.to_thread(_extract, path)
            if not extracted:
                raise RuntimeError("文件中没有可检索文字")
            await session.execute(
                delete(KnowledgeChunkRow).where(KnowledgeChunkRow.document_id == document_id)
            )
            for index, (content, page) in enumerate(extracted):
                embedding, embedding_model = await embed_text(content, get_settings())
                session.add(
                    KnowledgeChunkRow(
                        document_id=document_id,
                        owner_id=document.owner_id,
                        content=content,
                        page=page,
                        chunk_index=index,
                        metadata_json={
                            "filename": document.filename,
                            "license": document.license_type,
                            "embedding_model": embedding_model,
                        },
                        embedding=embedding,
                    )
                )
            await session.flush()
            if session.bind and session.bind.dialect.name == "postgresql":
                from sqlalchemy import text

                for chunk in (
                    await session.scalars(
                        select(KnowledgeChunkRow).where(
                            KnowledgeChunkRow.document_id == document_id
                        )
                    )
                ).all():
                    await session.execute(
                        text(
                            "UPDATE knowledge_chunks SET embedding_vector = CAST(:embedding AS vector) "
                            "WHERE id = :chunk_id"
                        ),
                        {"embedding": str(chunk.embedding), "chunk_id": chunk.id},
                    )
            document.status = "completed"
            document.error = None
        except Exception as error:  # worker boundary: persist a user-visible failure
            await session.rollback()
            document = await session.get(KnowledgeDocumentRow, document_id, populate_existing=True)
            if not document:
                return
            document.status = "failed"
            document.error = str(error)[:1000]
        await session.commit()


def ingest_document(document_id: str, path_text: str) -> None:
    asyncio.run(_persist(document_id, Path(path_text)))


def enqueue_ingestion(document_id: str, path: Path) -> bool:
    try:
        from redis import Redis
        from rq import Queue

        connection = Redis.from_url(get_settings().redis_url, socket_connect_timeout=1)
        connection.ping()
        Queue("ingestion", connection=connection).enqueue(
            ingest_document,
            document_id,
            str(path),
            job_timeout=600,
            result_ttl=3600,
        )
        return True
    except Exception:
        return False
