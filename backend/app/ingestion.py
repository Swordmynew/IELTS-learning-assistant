from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import KnowledgeChunkRow, KnowledgeDocumentRow, SessionLocal
from app.services.embeddings import embed_text


def _chunk_text(text: str, target_words: int = 350) -> list[str]:
    paragraphs = [item.strip() for item in text.splitlines() if item.strip()]
    chunks: list[str] = []
    current: list[str] = []
    count = 0
    for paragraph in paragraphs:
        size = len(paragraph.split())
        if current and count + size > target_words:
            chunks.append("\n".join(current))
            current, count = [], 0
        current.append(paragraph)
        count += size
    if current:
        chunks.append("\n".join(current))
    return chunks


def _extract(path: Path) -> list[tuple[str, int | None]]:
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
            "PDF/DOCX ingestion requires the optional 'documents' dependency"
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
            extracted = _extract(path)
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
