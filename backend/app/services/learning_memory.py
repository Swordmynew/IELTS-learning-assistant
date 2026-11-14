"""Evidence-backed personal memory; no model or external corpus is required."""

import hashlib
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import CoachRecord

TOPICS = {
    "grammar.countability": "不可数名词",
    "grammar.article": "冠词",
    "grammar.agreement": "主谓一致",
    "grammar.tense": "时态",
    "lexical.collocation": "搭配",
    "lexical.meaning": "词义辨析",
    "cohesion.logic": "逻辑衔接",
    "writing.development": "论据展开",
    "writing.grammar": "语法表达",
    "writing.vocabulary": "词汇运用",
    "reading.paraphrase": "同义替换",
    "listening.detail": "听力细节",
    "speaking.fluency": "口语流利度",
}
ALIASES = {label: key for key, label in TOPICS.items()}
CRITERIA = {
    "task_achievement": "writing.development",
    "coherence_cohesion": "cohesion.logic",
    "lexical_resource": "writing.vocabulary",
    "grammar_accuracy": "writing.grammar",
}


def normalize_topics(values: list[str]) -> list[str]:
    return sorted({ALIASES.get(value.strip(), value.strip().lower()) for value in values if value.strip()})[:20]


def topics_for(data: dict) -> list[str]:
    explicit = normalize_topics(data.get("topic_tags", []))
    if explicit or data.get("topic_origin") == "user":
        return explicit
    title = data.get("title", "")
    text = f"{title} {data.get('content', '')} {data.get('note', '')}".lower()
    tags = [CRITERIA[title]] if title in CRITERIA else []
    # These are transparent tag suggestions, not a diagnosis of learner ability.
    cues = {
        "grammar.countability": ("不可数", "uncountable", "many information"),
        "grammar.article": ("冠词", "article usage"),
        "grammar.agreement": ("主谓一致", "subject-verb agreement"),
        "grammar.tense": ("时态", "verb tense"),
        "lexical.collocation": ("搭配", "collocation"),
        "cohesion.logic": ("逻辑衔接", "转折", "however", "cohesion"),
        "reading.paraphrase": ("同义替换", "paraphrase"),
    }
    tags.extend(tag for tag, words in cues.items() if any(word in text for word in words))
    if not tags and data.get("category") == "vocabulary":
        tags.append("lexical.meaning")
    return sorted(set(tags))


async def memory_revision(session: AsyncSession, user_id: str) -> str:
    value = await session.scalar(
        select(CoachRecord.payload).where(
            CoachRecord.user_id == user_id,
            CoachRecord.kind == "memory_revision",
            CoachRecord.source_key == "current",
        )
    )
    return (value or {}).get("token", "initial")


async def invalidate_memory(session: AsyncSession, user_id: str, item_ids: set[str]) -> None:
    """Invalidate model replay and mark affected historical answers as obsolete context."""
    from uuid import uuid4

    await session.execute(delete(CoachRecord).where(CoachRecord.user_id == user_id, CoachRecord.kind == "cache"))
    revision = await session.scalar(select(CoachRecord).where(
        CoachRecord.user_id == user_id, CoachRecord.kind == "memory_revision", CoachRecord.source_key == "current"
    ))
    if not revision:
        revision = CoachRecord(user_id=user_id, kind="memory_revision", source_key="current")
        session.add(revision)
    revision.payload = {"token": str(uuid4())}
    for row in await session.scalars(select(CoachRecord).where(
        CoachRecord.user_id == user_id, CoachRecord.kind == "conversation"
    )):
        changed = False
        messages = []
        for message in row.payload.get("messages", []):
            dependencies = set(message.get("context_source_ids", [])) | {
                item.get("source_id") for item in message.get("citations", [])
            }
            if dependencies & item_ids:
                message = {**message, "context_stale": True}
                changed = True
            messages.append(message)
        if changed:
            row.payload = {**row.payload, "messages": messages}
    await session.flush()


def usable_history(messages: list[dict]) -> list[dict]:
    return [message for message in messages
            if not message.get("context_stale") and message.get("mode") in (None, "live", "cache")][-6:]


async def record_event(
    session: AsyncSession,
    row: CoachRecord,
    event_id: str,
    *,
    event_type: str = "practice",
    occurred_at: str | None = None,
    snapshot: dict | None = None,
) -> bool:
    if not event_id:
        return False
    key = hashlib.sha256(f"{row.source_key}:{event_type}:{event_id}".encode()).hexdigest()
    exists = await session.scalar(select(CoachRecord.id).where(
        CoachRecord.user_id == row.user_id, CoachRecord.kind == "knowledge_event", CoachRecord.source_key == key
    ))
    if exists:
        return False
    data = snapshot or row.payload
    captured_at = datetime.fromisoformat(occurred_at.replace("Z", "+00:00")) if occurred_at else datetime.now(UTC)
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)
    event = CoachRecord(
        user_id=row.user_id, kind="knowledge_event", parent_id=row.id, source_key=key,
        payload={
            "event_id": event_id, "event_type": event_type,
            "occurred_at": captured_at.astimezone(UTC).isoformat(),
            "title": data.get("title", ""), "content": data.get("content", ""),
            "status": data.get("status", "review"), "source_link": data.get("source_link", ""),
            "topic_tags": topics_for(data), "provenance": data.get("provenance", "personal-learning-record"),
        },
    )
    try:
        async with session.begin_nested():
            session.add(event)
            await session.flush()
    except IntegrityError:
        return False
    await invalidate_memory(session, row.user_id, {row.id})
    return True


async def memory_catalog(session: AsyncSession, user_id: str) -> tuple[list[CoachRecord], dict[str, list[dict]]]:
    rows = list(await session.scalars(select(CoachRecord).where(
        CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge"
    ).order_by(CoachRecord.created_at.desc())))
    by_id = {row.id: row for row in rows}
    active = {row.id for row in rows if not row.payload.get("deleted")}
    events: dict[str, list[dict]] = {item: [] for item in active}
    for event in await session.scalars(select(CoachRecord).where(
        CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge_event"
    ).order_by(CoachRecord.created_at)):
        target = event.parent_id
        visited = set()
        while target not in active and target in by_id and target not in visited:
            visited.add(target)
            target = by_id[target].payload.get("merged_into")
        if target in active:
            events[target].append({"id": event.id, **event.payload})
    return [row for row in rows if row.id in active], events


def event_stats(events: list[dict]) -> dict:
    practices = {event["event_id"] for event in events if event["event_type"] == "practice"}
    mistakes = {event["event_id"] for event in events if event["event_type"] == "practice" and event["status"] in {"review", "remaining"}}
    return {
        "practice_count": len(practices), "mistake_count": len(mistakes),
        "last_practiced_at": max((event["occurred_at"] for event in events if event["event_type"] in {"practice", "self_review", "revision"}), default=None),
    }



def retrieval_state(data: dict) -> str:
    states = [data.get("status", "saved"), *[record.get("status", "review") for record in data.get("merged_records", {}).values()]]
    if any(state in {"review", "remaining", "partial"} for state in states):
        return "review"
    return data.get("status", "saved")


def topic_groups(rows: list[CoachRecord], events: dict[str, list[dict]]) -> list[dict]:
    groups: dict[str, dict] = {}
    for row in rows:
        for tag in topics_for(row.payload):
            group = groups.setdefault(tag, {
                "id": tag, "label": TOPICS.get(tag, tag), "item_ids": [], "note_count": 0,
                "unresolved_count": 0, "events": [],
            })
            group["item_ids"].append(row.id)
            group["note_count"] += int(row.payload.get("category") == "note")
            group["unresolved_count"] += int(row.payload.get("category") != "note" and retrieval_state(row.payload) in {"review", "remaining", "partial"})
            group["events"].extend(events.get(row.id, []))
    return sorted(({
        **{key: value for key, value in group.items() if key != "events"},
        **event_stats(group["events"]),
    } for group in groups.values()), key=lambda group: (-group["unresolved_count"], group["label"]))
