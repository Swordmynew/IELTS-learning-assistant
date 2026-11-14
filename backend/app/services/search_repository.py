from __future__ import annotations

import json
import math

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.coach_schemas import TutorAnswer
from app.config import get_settings
from app.db import CoachRecord, KnowledgeChunkRow, KnowledgeDocumentRow
from app.schemas import Citation, RagAnswer, RagQuery
from app.services.coach_model import generate, generation_failure_message
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
    EXERCISE_FOLLOWUP,
    bilingual_search_question,
    bounded_history,
    evidence_window,
    followup_source_ids,
    pack_evidence,
    retrieval_question,
    vocabulary_writing_intent,
)
from app.services.tutor_citations import render_tutor_answer, validate_tutor_answer


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


async def retrieve_sources(session: AsyncSession, user_id: str, query: RagQuery, *, focus_source_ids: list[str] | None = None):
    search_text = bilingual_search_question(query.query)
    personal_intent = vocabulary_writing_intent(query.query)
    vector, model = await embed_text(search_text, get_settings())
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
    focused = set(focus_source_ids or [])
    if focused:
        current_focus = focused.intersection(hit.chunk_id for hit in hits)
        if not current_focus:
            return [], [], model
        # Previous IDs identify exercises, not old facts. Only current, owner-scoped records survive.
        hits = [hit for hit in hits if hit.chunk_id in current_focus or details[hit.chunk_id]["source_type"] == "public"]
    dense = sorted((hit for hit in hits if hit.score > 0.1), key=lambda hit: hit.score, reverse=True)[:20]
    sparse = keyword_rank(search_text, hits)[:20]
    tag_hits = sorted(
        (hit for hit in hits if query_topics.intersection(details[hit.chunk_id].get("topic_tags", []))),
        key=lambda hit: hit.score, reverse=True,
    )[:20]
    lexical_topics = {"writing.vocabulary", "writing.grammar", "grammar.countability", "lexical.collocation", "lexical.meaning"}
    intent_hits = [hit for hit in hits if personal_intent and not focused and (
        (details[hit.chunk_id]["source_type"] == "vocabulary"
         and details[hit.chunk_id].get("memory_stats", {}).get("mistake_count", 0) > 0)
        or (details[hit.chunk_id]["source_type"] == "writing"
            and lexical_topics.intersection(details[hit.chunk_id].get("topic_tags", [])))
    )]
    intent_hits.sort(key=lambda hit: (details[hit.chunk_id].get("memory_stats", {}).get("mistake_count", 0), hit.score), reverse=True)
    seed_ids = {hit.chunk_id for hit in [*sparse[:10], *dense[:10], *tag_hits[:10], *intent_hits[:10]]}
    related_targets = {related for item in seed_ids for related in details[item].get("related_ids", [])}
    linked = [hit for hit in hits if hit.chunk_id in related_targets or seed_ids.intersection(details[hit.chunk_id].get("related_ids", []))]
    linked_ids = {hit.chunk_id for hit in linked}
    focus_hits = [hit for hit in hits if hit.chunk_id in focused]
    fused = reciprocal_rank_fusion([dense, sparse, *([intent_hits] if intent_hits else []), *([focus_hits] if focus_hits else []), *([tag_hits] if tag_hits else []), *([linked] if linked else [])], limit=30)
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
    adjusted.sort(key=lambda item: (item[1].chunk_id in focused, item[0]), reverse=True)
    selected = adjusted[:query.limit]
    # Retain a relevant public explanation when mixing personal memories and reference material.
    public = next((item for item in adjusted if details[item[1].chunk_id]["source_type"] == "public"), None)
    if query.source_type == "all" and query.limit >= 3 and public and not any(details[item[1].chunk_id]["source_type"] == "public" for item in selected):
        selected[-1:] = [public]
    # A vocabulary-to-writing question needs both sides when relevant records exist.
    if personal_intent and not focused and query.limit >= 3:
        protected = set()
        for kind in ("vocabulary", "writing"):
            candidate = next((item for item in adjusted if item[1] in intent_hits
                              and details[item[1].chunk_id]["source_type"] == kind), None)
            if not candidate:
                continue
            if candidate not in selected:
                if len(selected) < query.limit:
                    selected.append(candidate)
                else:
                    index = next((i for i in range(len(selected) - 1, -1, -1)
                                  if selected[i][1].chunk_id not in protected
                                  and details[selected[i][1].chunk_id]["source_type"] != "public"), None)
                    if index is not None:
                        selected[index] = candidate
            protected.add(candidate[1].chunk_id)
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
    reference_history = []
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
        reference_history = conversation.payload.get("messages", [])
        history = usable_history(reference_history)
    else:
        conversation = CoachRecord(user_id=user_id, kind="conversation", payload={"messages": []})
        session.add(conversation)
        await session.flush()
    focused = followup_source_ids(query.query, reference_history)
    unresolved_reference = bool(EXERCISE_FOLLOWUP.search(query.query)) and not focused
    search_query = query.model_copy(update={"query": retrieval_question(query.query, reference_history)})
    if unresolved_reference:
        citations, ranked, model = [], [], "not-requested"
    else:
        citations, ranked, model = await retrieve_sources(session, user_id, search_query, focus_source_ids=focused or None)
    mode = f"portable-vector+keyword+rrf ({model})"
    citations, evidence = pack_evidence(citations, ranked, query.query)
    answer = "你指的是哪几道题？请提供题目关键词，或回到讨论这些题目的原对话继续。" if unresolved_reference else "当前知识库证据不足以回答该问题。"
    result_mode, generated_at = "insufficient", None
    failure_reason = None
    system_message_key = "rag.whichExercises" if unresolved_reference else "rag.noRelatedRecords"
    generation_mode = None
    retrieved_sources = []
    if citations:
        def validate(result: TutorAnswer) -> TutorAnswer:
            return validate_tutor_answer(result, citations)

        failure = {}
        result = await generate(
            session,
            user_id,
            "rag",
            {
                "question": query.query,
                "history": bounded_history(history),
                "sources": evidence,
                **({"reference_focus_ids": focused} if focused else {}),
            },
            TutorAnswer,
            TUTOR_GROUNDING,
            validate,
            failure=failure,
        )
        if result:
            parsed = TutorAnswer.model_validate(result.data)
            if parsed.sufficient:
                answer = render_tutor_answer(parsed, citations)
                citations = [item for item in citations if item.source_id in parsed.source_ids]
                system_message_key = None
                result_mode = result.mode
            else:
                retrieved_sources = citations
                citations = []
                system_message_key = "rag.insufficientEvidence"
                result_mode = "insufficient"
            generation_mode, generated_at = result.mode, result.generated_at
        else:
            # A memory edit may have invalidated an in-flight model request; refresh its sources.
            citations, ranked, model = await retrieve_sources(session, user_id, search_query, focus_source_ids=focused or None)
            failure_reason = failure.get("reason", "generation_failed")
            answer = generation_failure_message(failure_reason) + "以下仅展示检索到的资料。" if citations else "当前知识库证据不足以回答该问题。"
            result_mode = "offline" if citations else "insufficient"
            system_message_key = None if citations else "rag.noRelatedRecords"
    messages = [
        *conversation.payload.get("messages", []),
        {
            "query": query.query,
            "context_source_ids": [hit.chunk_id for hit in ranked],
            "answer": answer,
            "citations": [c.model_dump() for c in citations],
            "mode": result_mode,
            "failure_reason": failure_reason,
            "system_message_key": system_message_key,
            "generation_mode": generation_mode,
            "retrieved_sources": [source.model_dump() for source in retrieved_sources],
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
        failure_reason=failure_reason,
        system_message_key=system_message_key,
        generation_mode=generation_mode,
        retrieved_sources=retrieved_sources,
        generated_at=generated_at,
        conversation_id=conversation.id,
    )
