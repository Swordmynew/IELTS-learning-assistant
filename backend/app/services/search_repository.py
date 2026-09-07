from __future__ import annotations

import math

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import KnowledgeChunkRow, KnowledgeDocumentRow
from app.schemas import Citation, RagAnswer, RagQuery
from app.services.embeddings import embed_text
from app.services.rag import SearchHit, keyword_rank, reciprocal_rank_fusion, to_citation


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left)) or 1
    right_norm = math.sqrt(sum(value * value for value in right)) or 1
    return numerator / (left_norm * right_norm)


async def _portable_search(
    session: AsyncSession, user_id: str, query: RagQuery, vector: list[float]
) -> list[Citation]:
    rows = (
        await session.execute(
            select(KnowledgeChunkRow, KnowledgeDocumentRow)
            .join(KnowledgeDocumentRow, KnowledgeDocumentRow.id == KnowledgeChunkRow.document_id)
            .where(
                (KnowledgeChunkRow.owner_id.is_(None)) | (KnowledgeChunkRow.owner_id == user_id)
            )
        )
    ).all()
    hits = [
        SearchHit(
            chunk_id=chunk.id,
            title=document.title,
            content=chunk.content,
            source_url=document.source_url,
            page=chunk.page,
            score=_cosine(vector, chunk.embedding or []),
        )
        for chunk, document in rows
    ]
    dense = sorted(hits, key=lambda item: item.score, reverse=True)[:20]
    sparse = keyword_rank(query.query, hits)[:20]
    return [to_citation(item) for item in reciprocal_rank_fusion([dense, sparse], limit=query.limit)]


async def _postgres_search(
    session: AsyncSession, user_id: str, query: RagQuery, vector: list[float]
) -> list[Citation]:
    sql = text(
        """
        WITH dense AS (
          SELECT kc.id, row_number() OVER (ORDER BY kc.embedding_vector <=> CAST(:embedding AS vector)) AS rank
          FROM knowledge_chunks kc
          WHERE (kc.owner_id IS NULL OR kc.owner_id = :user_id) AND kc.embedding_vector IS NOT NULL
          ORDER BY kc.embedding_vector <=> CAST(:embedding AS vector)
          LIMIT 20
        ), sparse AS (
          SELECT kc.id, row_number() OVER (
            ORDER BY ts_rank_cd(kc.search_tsv, websearch_to_tsquery('english', :query)) DESC
          ) AS rank
          FROM knowledge_chunks kc
          WHERE (kc.owner_id IS NULL OR kc.owner_id = :user_id)
            AND kc.search_tsv @@ websearch_to_tsquery('english', :query)
          ORDER BY ts_rank_cd(kc.search_tsv, websearch_to_tsquery('english', :query)) DESC
          LIMIT 20
        ), fused AS (
          SELECT id, SUM(score) AS score FROM (
            SELECT id, 1.0 / (60 + rank) AS score FROM dense
            UNION ALL
            SELECT id, 1.0 / (60 + rank) AS score FROM sparse
          ) ranks GROUP BY id ORDER BY score DESC LIMIT :limit
        )
        SELECT kc.id, kd.title, kd.source_url, kc.page, kc.content, fused.score
        FROM fused
        JOIN knowledge_chunks kc ON kc.id = fused.id
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        ORDER BY fused.score DESC
        """
    )
    result = await session.execute(
        sql,
        {
            "embedding": str(vector),
            "query": query.query,
            "user_id": user_id,
            "limit": query.limit,
        },
    )
    rows = result.mappings().all()
    maximum = max((float(row["score"]) for row in rows), default=1)
    return [
        Citation(
            source_id=row["id"],
            title=row["title"],
            url=row["source_url"],
            page=row["page"],
            excerpt=row["content"][:320],
            score=float(row["score"]) / maximum,
        )
        for row in rows
    ]


async def hybrid_search(session: AsyncSession, user_id: str, query: RagQuery) -> RagAnswer:
    vector, model = await embed_text(query.query, get_settings())
    dialect = session.bind.dialect.name if session.bind else "unknown"
    if dialect == "postgresql":
        citations = await _postgres_search(session, user_id, query, vector)
        mode = f"postgres-pgvector+fts+rrf ({model})"
    else:
        citations = await _portable_search(session, user_id, query, vector)
        mode = f"portable-vector+keyword+rrf ({model})"
    if citations:
        answer = "检索到以下可核验资料。请结合引用页码阅读原始评分标准。"
    else:
        answer = "当前知识库证据不足以回答该问题。请调整查询或上传合法持有的学习资料。"
    return RagAnswer(query=query.query, answer=answer, citations=citations, retrieval_mode=mode)
