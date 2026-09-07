from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.schemas import Citation


@dataclass(frozen=True)
class SearchHit:
    chunk_id: str
    title: str
    content: str
    source_url: str | None
    page: int | None
    score: float


def reciprocal_rank_fusion(
    ranked_lists: list[list[SearchHit]],
    *,
    k: int = 60,
    limit: int = 6,
) -> list[SearchHit]:
    by_id: dict[str, SearchHit] = {}
    fused: dict[str, float] = {}
    for hits in ranked_lists:
        for rank, hit in enumerate(hits, start=1):
            by_id[hit.chunk_id] = hit
            fused[hit.chunk_id] = fused.get(hit.chunk_id, 0.0) + 1 / (k + rank)
    ordered = sorted(fused, key=fused.get, reverse=True)[:limit]
    maximum = max((fused[item] for item in ordered), default=1.0)
    return [
        SearchHit(
            chunk_id=by_id[item].chunk_id,
            title=by_id[item].title,
            content=by_id[item].content,
            source_url=by_id[item].source_url,
            page=by_id[item].page,
            score=round(fused[item] / maximum, 4),
        )
        for item in ordered
    ]


def keyword_rank(query: str, chunks: list[SearchHit]) -> list[SearchHit]:
    terms = set(re.findall(r"[a-zA-Z]{2,}|[\u4e00-\u9fff]", query.lower()))
    scored: list[tuple[float, SearchHit]] = []
    for chunk in chunks:
        text = chunk.content.lower()
        overlap = sum(text.count(term) for term in terms)
        normalization = math.sqrt(max(1, len(text.split())))
        scored.append((overlap / normalization, chunk))
    return [item for score, item in sorted(scored, key=lambda pair: pair[0], reverse=True) if score > 0]


def to_citation(hit: SearchHit) -> Citation:
    return Citation(
        source_id=hit.chunk_id,
        title=hit.title,
        url=hit.source_url,
        page=hit.page,
        excerpt=hit.content[:320],
        score=hit.score,
    )


OFFICIAL_RUBRIC_SUMMARIES: list[SearchHit] = [
    SearchHit(
        chunk_id="ielts-writing-task-response",
        title="IELTS Writing Band Descriptors — Task Response",
        source_url="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
        page=7,
        content=(
            "Task Response evaluates whether the response addresses all parts of the prompt, "
            "presents a clear position, and develops relevant ideas with support. "
            "任务回应关注是否完整回应题目、立场是否清晰、观点是否相关并得到充分论证。"
        ),
        score=1,
    ),
    SearchHit(
        chunk_id="ielts-writing-coherence",
        title="IELTS Writing Band Descriptors — Coherence and Cohesion",
        source_url="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
        page=7,
        content=(
            "Coherence and Cohesion evaluates logical progression, paragraphing, referencing, "
            "and whether cohesive devices are accurate rather than mechanical. "
            "连贯与衔接关注逻辑推进、段落组织、指代和连接词是否准确自然。"
        ),
        score=1,
    ),
    SearchHit(
        chunk_id="ielts-writing-lexical",
        title="IELTS Writing Band Descriptors — Lexical Resource",
        source_url="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
        page=7,
        content=(
            "Lexical Resource evaluates range, precision, collocation, spelling and word formation "
            "in relation to the task. "
            "词汇资源关注词汇范围、用词准确性、搭配、拼写和构词。"
        ),
        score=1,
    ),
    SearchHit(
        chunk_id="ielts-writing-grammar",
        title="IELTS Writing Band Descriptors — Grammatical Range and Accuracy",
        source_url="https://ielts.org/cdn/ielts-guides/ielts-writing-band-descriptors.pdf",
        page=7,
        content=(
            "Grammatical Range and Accuracy evaluates sentence variety, control, punctuation and "
            "whether errors impede communication. "
            "语法范围与准确性关注句型多样性、语法控制、标点以及错误是否妨碍理解。"
        ),
        score=1,
    ),
]


def retrieve_official_rubric(query: str, limit: int = 4) -> list[Citation]:
    keyword = keyword_rank(query, OFFICIAL_RUBRIC_SUMMARIES)
    matched_ids = {item.chunk_id for item in keyword}
    ordered = [
        *keyword,
        *(item for item in OFFICIAL_RUBRIC_SUMMARIES if item.chunk_id not in matched_ids),
    ]
    return [to_citation(hit) for hit in ordered[:limit]]
