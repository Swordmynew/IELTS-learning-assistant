from __future__ import annotations

import json
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
from app.services.learning_memory import (
    TOPICS,
    event_stats,
    memory_catalog,
    normalize_topics,
    retrieval_state,
    topics_for,
    usable_history,
)
from app.services.rag import SearchHit, keyword_rank, reciprocal_rank_fusion, to_citation
from app.services.retrieval_context import (
    bounded_history,
    evidence_window,
    pack_evidence,
    retrieval_question,
)


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
    topic_filter = set(normalize_topics(query.topic_tags))
    query_topics = topic_filter | set(topics_for({"content": query.query}))
    for chunk, document in rows:
        kind = "public" if document.owner_id is None else "document"
        if query.source_type not in ("all", kind) or (
            query.document_ids and document.id not in query.document_ids
        ):
            continue
        if topic_filter and not topic_filter.intersection(normalize_topics(chunk.metadata_json.get("topic_tags", []))):
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
            "source_link": f"/resources?document={document.id}" + (f"&page={chunk.page}" if chunk.page else ""),
            "recorded_at": str(document.created_at),
        }
    if not query.document_ids and query.source_type not in ("public", "document"):
        personal, events = await memory_catalog(session, user_id)
        for row in personal:
            data = row.payload
            if data.get("deleted") or (
                query.source_type != "all" and query.source_type != data.get("category")
            ):
                continue
            tags = topics_for(data)
            if topic_filter and not topic_filter.intersection(tags):
                continue
            if query.module and data.get("module") not in {query.module.value, "general"}:
                continue
            if query.task_type:
                continue
            content = f"{data['content']}\n学习备注：{data.get('note', '')}"
            content += "\n知识点：" + "、".join(TOPICS.get(tag, tag) for tag in tags)
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
                "topic_tags": tags,
                "memory_status": retrieval_state(data),
                "memory_state_source": data.get("state_source"),
                "related_ids": data.get("related_ids", []),
                "memory_stats": event_stats(events.get(row.id, [])),
                "provenance": data.get("provenance", "personal-learning-record"),
                "license_type": "user-private",
                "source_link": f"/resources?item={row.id}" if data.get("category") == "note" else data.get("source_link"),
                "url": data.get("source_url"),
                "page": data.get("page"),
                "recorded_at": data.get("updated_at"),
            }
    dense = sorted((hit for hit in hits if hit.score > 0.1), key=lambda hit: hit.score, reverse=True)[:20]
    sparse = keyword_rank(query.query, hits)[:20]
    tag_hits = sorted(
        (hit for hit in hits if query_topics.intersection(details[hit.chunk_id].get("topic_tags", []))),
        key=lambda hit: hit.score, reverse=True,
    )[:20]
    seed_ids = {hit.chunk_id for hit in [*sparse[:10], *dense[:10], *tag_hits[:10]]}
    related_targets = {related for item in seed_ids for related in details[item].get("related_ids", [])}
    linked = [hit for hit in hits if hit.chunk_id in related_targets or seed_ids.intersection(details[hit.chunk_id].get("related_ids", []))]
    linked_ids = {hit.chunk_id for hit in linked}
    fused = reciprocal_rank_fusion([dense, sparse, *([tag_hits] if tag_hits else []), *([linked] if linked else [])], limit=30)
    dense_ids, sparse_ids = {hit.chunk_id for hit in dense}, {hit.chunk_id for hit in sparse}
    adjusted = []
    for hit in fused:
        detail = details[hit.chunk_id]
        reasons = []
        factor = 1.0
        if hit.chunk_id in linked_ids:
            reasons.append("关联学习记录")
        if hit.chunk_id in dense_ids:
            reasons.append("向量匹配（演示）" if "hashing" in model else "语义相近")
        if hit.chunk_id in sparse_ids:
            reasons.append("关键词匹配")
        if query_topics.intersection(detail.get("topic_tags", [])):
            factor += 0.12
            reasons.append("同一知识点")
        stats = detail.get("memory_stats", {})
        if stats.get("mistake_count"):
            factor += min(0.06, 0.02 * stats["mistake_count"])
            reasons.append(f"历史错误 {stats['mistake_count']} 次")
        state = detail.get("memory_status")
        if state in {"review", "remaining", "partial"}:
            factor += 0.04
            reasons.append("待复习")
        elif state in {"correct_latest", "improved"}:
            factor -= 0.08
            reasons.append("最近已改善")
        detail["match_reasons"] = reasons
        adjusted.append((hit.score * factor, hit))
    adjusted.sort(key=lambda item: item[0], reverse=True)
    selected = adjusted[:query.limit]
    # Retain a relevant public explanation when mixing personal memories and reference material.
    public = next((item for item in adjusted if details[item[1].chunk_id]["source_type"] == "public"), None)
    if query.source_type == "all" and query.limit >= 3 and public and not any(details[item[1].chunk_id]["source_type"] == "public" for item in selected):
        selected[-1:] = [public]
    maximum = max((score for score, _ in adjusted), default=1.0)
    ranked = [SearchHit(hit.chunk_id, hit.title, hit.content, hit.source_url, hit.page, round(score / maximum, 4)) for score, hit in selected]
    citations = [
        to_citation(hit).model_copy(update={
            **{key: value for key, value in details[hit.chunk_id].items() if key not in {"memory_stats", "related_ids"}},
            "number": index + 1,
            "excerpt": evidence_window(hit.content, query.query, 320),
        }) for index, hit in enumerate(ranked)
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
        "topic_tags": normalize_topics(query.topic_tags),
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
        previous_scope = {"topic_tags": [], **conversation.payload.get("scope", scope)}
        if previous_scope != scope:
            from fastapi import HTTPException

            raise HTTPException(409, "Start a new conversation after changing source filters")
        history = usable_history(conversation.payload.get("messages", []))
    else:
        conversation = CoachRecord(user_id=user_id, kind="conversation", payload={"messages": []})
        session.add(conversation)
        await session.flush()
    search_query = query.model_copy(update={"query": retrieval_question(query.query, history)})
    citations, ranked, model = await retrieve_sources(session, user_id, search_query)
    mode = f"portable-vector+keyword+rrf ({model})"
    citations, evidence = pack_evidence(citations, ranked, query.query)
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
                "history": bounded_history(history),
                "sources": evidence,
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
            # A memory edit may have invalidated an in-flight model request; refresh its sources.
            citations, ranked, model = await retrieve_sources(session, user_id, search_query)
            answer = "模型暂不可用。以下为检索到的资料；可打开独立离线示例。" if citations else "当前知识库证据不足以回答该问题。"
            result_mode = "offline" if citations else "insufficient"
    messages = [
        *conversation.payload.get("messages", []),
        {
            "query": query.query,
            "context_source_ids": [hit.chunk_id for hit in ranked],
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
        retrieval_query=search_query.query,
        evidence_chars=len(json.dumps(evidence, ensure_ascii=False)),
        answer=answer,
        citations=citations,
        retrieval_mode=mode,
        mode=result_mode,
        generated_at=generated_at,
        conversation_id=conversation.id,
    )
