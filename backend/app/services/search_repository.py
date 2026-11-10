from __future__ import annotations

import math

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coach_schemas import TutorAnswer
from app.config import get_settings
from app.db import CoachRecord, KnowledgeChunkRow, KnowledgeDocumentRow
from app.schemas import Citation, RagAnswer, RagQuery
from app.services.coach_model import generate
from app.services.coach_prompts import TUTOR_GROUNDING
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
            .where((KnowledgeChunkRow.owner_id.is_(None)) | (KnowledgeChunkRow.owner_id == user_id))
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
    return [
        to_citation(item) for item in reciprocal_rank_fusion([dense, sparse], limit=query.limit)
    ]


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


async def retrieve_sources(session: AsyncSession, user_id: str, query: RagQuery):
    vector, model = await embed_text(query.query, get_settings())
    rows = (
        await session.execute(
            select(KnowledgeChunkRow, KnowledgeDocumentRow)
            .join(KnowledgeDocumentRow, KnowledgeDocumentRow.id == KnowledgeChunkRow.document_id)
            .where(
                (KnowledgeChunkRow.owner_id.is_(None)) | (KnowledgeChunkRow.owner_id == user_id),
                KnowledgeDocumentRow.status == "completed",
            )
        )
    ).all()
    hits, details = [], {}
    for chunk, document in rows:
        kind = "public" if document.owner_id is None else "document"
        if query.source_type not in ("all", kind) or (
            query.document_ids and document.id not in query.document_ids
        ):
            continue
        if query.module and chunk.metadata_json.get("module") != query.module.value:
            continue
        if query.task_type and chunk.metadata_json.get("task_type") != query.task_type.value:
            continue
        score = (
            _cosine(vector, chunk.embedding or [])
            if chunk.metadata_json.get("embedding_model") == model
            else 0
        )
        hit = SearchHit(
            chunk.id, document.title, chunk.content, document.source_url, chunk.page, score
        )
        hits.append(hit)
        details[chunk.id] = {
            "source_type": kind,
            "provenance": (
                "user-uploaded-document"
                if document.owner_id is not None
                else "official-rubric-paraphrase"
                if document.license_type == "official-public-link-paraphrase"
                else "project-authored-guidance"
                if document.license_type == "project-authored"
                else "public-document-unverified-origin"
            ),
            "license_type": document.license_type,
            "source_link": f"/resources?document={document.id}",
            "recorded_at": str(document.created_at),
        }
    if not query.document_ids and query.source_type not in ("public", "document"):
        personal = await session.scalars(
            select(CoachRecord).where(
                CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge"
            )
        )
        for row in personal:
            data = row.payload
            if data.get("deleted") or (
                query.source_type != "all" and query.source_type != data.get("category")
            ):
                continue
            if query.module and data.get("module") != query.module.value:
                continue
            if query.task_type:
                continue
            content = f"{data['content']}\n学习备注：{data.get('note', '')}"
            for merged in data.get("merged_records", {}).values():
                content += f"\n合并来源：{merged['title']}\n{merged['content']}\n备注：{merged.get('note', '')}"
            score = (
                _cosine(vector, data.get("embedding", []))
                if data.get("embedding_model") == model
                else 0
            )
            hits.append(SearchHit(row.id, data["title"], content, None, None, score))
            details[row.id] = {
                "source_type": data["category"],
                "provenance": "personal-learning-record",
                "license_type": "user-private",
                "source_link": data.get("source_link"),
                "recorded_at": data.get("updated_at"),
            }
    dense = sorted(
        (hit for hit in hits if hit.score > 0.1), key=lambda hit: hit.score, reverse=True
    )[:20]
    sparse = keyword_rank(query.query, hits)[:20]
    ranked = reciprocal_rank_fusion([dense, sparse], limit=query.limit)
    citations = [
        to_citation(hit).model_copy(update={**details[hit.chunk_id], "number": index + 1})
        for index, hit in enumerate(ranked)
    ]
    return citations, ranked, model


async def hybrid_search(session: AsyncSession, user_id: str, query: RagQuery) -> RagAnswer:
    conversation = None
    history = []
    scope = {
        "source_type": query.source_type,
        "document_ids": sorted(query.document_ids),
        "module": query.module,
        "task_type": query.task_type,
    }
    if query.conversation_id:
        conversation = await session.scalar(
            select(CoachRecord).where(
                CoachRecord.id == query.conversation_id,
                CoachRecord.user_id == user_id,
                CoachRecord.kind == "conversation",
                CoachRecord.parent_id.is_(None),
            )
        )
        if not conversation:
            from fastapi import HTTPException

            raise HTTPException(404, "Conversation not found")
        if conversation.payload.get("scope", scope) != scope:
            from fastapi import HTTPException

            raise HTTPException(409, "Start a new conversation after changing source filters")
        history = conversation.payload.get("messages", [])[-6:]
    else:
        conversation = CoachRecord(user_id=user_id, kind="conversation", payload={"messages": []})
        session.add(conversation)
        await session.flush()
    search_query = query.model_copy(
        update={
            "query": " ".join([*[message["query"] for message in history[-2:]], query.query])[
                -2000:
            ]
        }
    )
    citations, ranked, model = await retrieve_sources(session, user_id, search_query)
    mode = f"portable-vector+keyword+rrf ({model})"
    answer = "当前知识库证据不足以回答该问题。"
    result_mode, generated_at = "insufficient", None
    if citations:
        allowed = {item.source_id for item in citations}

        def validate(result: TutorAnswer) -> TutorAnswer:
            if set(result.source_ids) - allowed or (result.sufficient and not result.source_ids):
                raise ValueError("Invalid citations")
            return result

        result = await generate(
            session,
            user_id,
            "rag",
            {
                "question": query.query,
                "history": history,
                "sources": [
                    {**citation.model_dump(), "full_text": hit.content}
                    for citation, hit in zip(citations, ranked, strict=True)
                ],
            },
            TutorAnswer,
            TUTOR_GROUNDING,
            validate,
        )
        if result:
            parsed = TutorAnswer.model_validate(result.data)
            if parsed.sufficient:
                answer = parsed.answer
                citations = [item for item in citations if item.source_id in parsed.source_ids]
            else:
                citations = []
            result_mode, generated_at = result.mode, result.generated_at
        else:
            answer = "模型暂不可用。以下为检索到的资料；可打开独立离线示例。"
            result_mode = "offline"
    messages = [
        *conversation.payload.get("messages", []),
        {
            "query": query.query,
            "answer": answer,
            "citations": [c.model_dump() for c in citations],
            "mode": result_mode,
            "generated_at": generated_at,
        },
    ]
    conversation.payload = {"messages": messages, "scope": scope}
    await session.commit()
    return RagAnswer(
        query=query.query,
        answer=answer,
        citations=citations,
        retrieval_mode=mode,
        mode=result_mode,
        generated_at=generated_at,
        conversation_id=conversation.id,
    )
