"""Bounded, source-backed context construction without another model call."""

import json
import re

from app.config import get_settings

EXERCISE_FOLLOWUP = re.compile(r"[这那](?:[一二两三四五六七八九十几\d]+)?(?:道|个)?题|\b(?:these|those|that) (?:two |three )?(?:questions?|exercises?)\b", re.I)
FOLLOWUP = re.compile(r"上次|刚才|这个|那个|这条|那条|那种|这类|它|继续|再举|再解释|举个例子|" + EXERCISE_FOLLOWUP.pattern + r"|\b(?:that|those|it|previous|again|more examples|explain further)\b", re.I)


def vocabulary_writing_intent(question: str) -> bool:
    """A narrow bilingual bridge, not permission to retrieve arbitrary personal records."""
    return all(re.search(pattern, question, re.I) for pattern in (
        r"我的|我在|\bmy\b", r"词汇|单词|用词|\b(?:vocabulary|words?|lexical)\b",
        r"错误|错词|用错|\b(?:mistakes?|errors?|misuse)\b", r"写作|作文|\b(?:writing|essays?)\b",
    ))


def bilingual_search_question(question: str) -> str:
    if not vocabulary_writing_intent(question):
        return question
    return question + " 词汇 单词 错误 写作 作文 vocabulary word errors writing lexical grammar"


def followup_source_ids(question: str, history: list[dict]) -> list[str]:
    if not EXERCISE_FOLLOWUP.search(question):
        return []
    for message in reversed(history):
        if message.get("mode") not in (None, "live", "cache"):
            continue
        sources = [citation["source_id"] for citation in message.get("citations", [])
                   if citation.get("source_type") == "mistake" and citation.get("source_id")]
        if sources:
            return list(dict.fromkeys(sources))[:10]
    return []


def retrieval_question(question: str, history: list[dict]) -> str:
    if not history or not FOLLOWUP.search(question):
        return question
    previous = next((message for message in reversed(history)
                     if message.get("mode") not in ("offline", "insufficient")), history[-1])
    anchor = previous.get("query", "")[:400]
    focused = set(followup_source_ids(question, history))
    references = previous.get("citations", [])
    if focused:
        references = [citation for message in history for citation in message.get("citations", [])
                      if citation.get("source_id") in focused]
    titles = " ".join(dict.fromkeys(citation.get("title", "") for citation in references))[:600]
    # Old queries and titles locate current records; obsolete answers are never reused as evidence.
    extra = f"{titles} {anchor}".strip()
    return f"{question} {extra[:max(0, 1999 - len(question))]}".strip()


def bounded_history(history: list[dict], budget: int = 4000) -> list[dict]:
    selected = []
    for message in reversed(history[-6:]):
        if message.get("context_stale"):
            continue
        item = {"query": message["query"][:700], "answer": message["answer"][:1000]}
        if len(json.dumps([item, *selected], ensure_ascii=False)) > budget:
            break
        selected.insert(0, item)
    return selected


def evidence_window(text: str, query: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    terms = re.findall(r"[a-zA-Z]{3,}|[\u4e00-\u9fff]{2,6}", query.lower())
    positions = [text.lower().find(term) for term in terms if term not in {"the", "what", "how", "this", "that", "can", "does"}]
    position = min((value for value in positions if value >= 0), default=0)
    start = max(0, position - limit // 4)
    start = min(start, max(0, len(text) - limit))
    return text[start:start + limit]


def pack_evidence(citations, hits, question: str):
    settings = get_settings()
    remaining = settings.rag_evidence_chars - 2
    packed, selected = [], []
    for citation, hit in zip(citations, hits, strict=True):
        allowance = min(settings.rag_source_chars, len(hit.content))
        while allowance > 0:
            snippet = evidence_window(hit.content, question, allowance)
            view = citation.model_copy(update={"excerpt": snippet[:320], "context_truncated": len(snippet) < len(hit.content)})
            item = {**view.model_dump(), "full_text": snippet}
            cost = len(json.dumps(item, ensure_ascii=False)) + (2 if packed else 0)
            if cost <= remaining:
                packed.append(item)
                selected.append(view)
                remaining -= cost
                break
            allowance -= max(1, cost - remaining)
    return selected, packed
