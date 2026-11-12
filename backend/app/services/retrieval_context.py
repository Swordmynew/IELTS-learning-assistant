"""Bounded, source-backed context construction without another model call."""

import json
import re

from app.config import get_settings

FOLLOWUP = re.compile(r"上次|刚才|这个|那个|这条|那条|那种|这类|它|继续|再举|再解释|举个例子|\b(?:that|those|it|previous|again|more examples|explain further)\b", re.I)


def retrieval_question(question: str, history: list[dict]) -> str:
    if not history or not FOLLOWUP.search(question):
        return question
    previous = history[-1]
    anchor = previous.get("query", "")[:400]
    titles = " ".join(citation.get("title", "") for citation in previous.get("citations", [])[:2])[:200]
    extra = f"{anchor} {titles}".strip()
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
