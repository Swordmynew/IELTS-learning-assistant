"""An offline dictionary with private, sparse learning progress and writing-derived words."""

import json
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import CoachRecord, VocabularyTestSessionRow
from app.services.personal_knowledge import put_knowledge
from app.services.word_normalization import normalize_word


@lru_cache
def starter_data() -> dict:
    path = Path(__file__).resolve().parents[1] / "data/vocabulary/starter.json"
    if not path.exists():
        raise HTTPException(503, "Local dictionary is missing. Run npm run setup:vocabulary from the repository root, then retry.")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def starter_words() -> dict[str, dict]:
    words = sorted(starter_data()["words"], key=lambda item: (
        0 if "ielts" in item["tags"] and item["frequency"] >= 800 else 1 if item["frequency"] >= 800 else 2,
        item["frequency"], item["word"],
    ))
    return {item["word"]: item for item in words}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def card_view(word: str, row: CoachRecord | None = None) -> dict:
    base = starter_words().get(word, {})
    data = row.payload if row else {}
    return {
        "word": word, "meaning": base.get("meaning", ""),
        "phonetic": base.get("phonetic", ""), "part_of_speech": base.get("part_of_speech", ""),
        "tags": base.get("tags", []), "example": "", "note": "", "personal": False,
        "sources": [], "status": "new", "due_at": None, "interval_days": 0,
        "review_count": 0, "lapses": 0, "revision": 0, "suspended": False,
        **data,
    }


async def saved_cards(session: AsyncSession, user_id: str) -> dict[str, CoachRecord]:
    await import_legacy_words(session, user_id)
    rows = await session.scalars(select(CoachRecord).where(CoachRecord.user_id == user_id, CoachRecord.kind == "word_card"))
    return {row.source_key: row for row in rows}


async def import_legacy_words(session: AsyncSession, user_id: str) -> None:
    """Import earlier real-word mistakes once without changing their original practice history."""
    notes = list(await session.scalars(select(CoachRecord).where(CoachRecord.user_id == user_id, CoachRecord.kind == "knowledge", CoachRecord.source_key.startswith("word:"))))
    existing = set(await session.scalars(select(CoachRecord.source_key).where(CoachRecord.user_id == user_id, CoachRecord.kind == "word_card")))
    candidates = {}
    for note in notes:
        if note.payload.get("deleted"):
            continue
        try:
            word = normalize_word(note.source_key.removeprefix("word:"))
        except ValueError:
            continue
        content = note.payload.get("content", "")
        meaning = starter_words().get(word, {}).get("meaning", "")
        for line in content.splitlines():
            if line.startswith("正确释义："):
                meaning = line.removeprefix("正确释义：").strip()
                break
        if not meaning or meaning == "以上都不是":
            continue
        candidates[word] = {**card_view(word), "meaning": meaning, "personal": True, "status": "learning", "due_at": now_iso(), "legacy_source": note.payload.get("source_link"), "note": note.payload.get("note", "")}
    from app.services.vocabulary import ITEMS_BY_ID

    history = await session.scalars(select(VocabularyTestSessionRow).where(VocabularyTestSessionRow.user_id == user_id).order_by(VocabularyTestSessionRow.created_at))
    for test in history:
        for response in test.responses:
            item = ITEMS_BY_ID.get(response["item_id"])
            if response["correct"] or not item or item.surface not in starter_words():
                continue
            word = item.surface
            data = candidates.get(word, {**card_view(word), "personal": True, "status": "learning", "due_at": now_iso()})
            options = [*item.options, "以上都不是"]
            source = {
                "job_id": f"legacy:{test.id}:{item.id}", "source_id": test.id,
                "source_link": f"/vocabulary?test={test.id}", "reason": "accumulate",
                "original_form": word, "original_quote": f"单词：{word}；原选释义：{options[response['selected_option']]}",
                "explanation": f"词义练习中曾选择：{options[response['selected_option']]}。正确释义：{data['meaning']}",
                "example": "",
            }
            data["sources"] = [*data["sources"], source]
            candidates[word] = data
    added = False
    for word, data in candidates.items():
        if word in existing:
            continue
        try:
            async with session.begin_nested():
                session.add(CoachRecord(user_id=user_id, kind="word_card", source_key=word, payload=data))
                await session.flush()
            added = True
            existing.add(word)
        except IntegrityError:
            pass
    if added:
        await session.commit()


async def find_card(session: AsyncSession, user_id: str, word: str) -> CoachRecord | None:
    return await session.scalar(select(CoachRecord).where(CoachRecord.user_id == user_id, CoachRecord.kind == "word_card", CoachRecord.source_key == word))


async def require_card(session: AsyncSession, user_id: str, word: str) -> CoachRecord:
    row = await find_card(session, user_id, word)
    if not row:
        if word not in starter_words():
            raise HTTPException(404, "Word not found")
        row = CoachRecord(user_id=user_id, kind="word_card", source_key=word, payload=card_view(word))
        session.add(row)
        await session.flush()
    return row


async def store_card(session: AsyncSession, row: CoachRecord, data: dict, revision: int) -> None:
    result = await session.execute(update(CoachRecord).where(
        CoachRecord.id == row.id, CoachRecord.user_id == row.user_id,
        CoachRecord.payload["revision"].as_integer() == revision,
    ).values(payload=data).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        raise HTTPException(409, "Card changed; reload before saving")
    session.expire(row, ["payload"])


async def deck(session: AsyncSession, user_id: str, scope: str = "all", query: str = "", offset: int = 0, limit: int = 40) -> dict:
    rows = await saved_cards(session, user_id)
    timestamp = now_iso()
    words = dict.fromkeys([*starter_words(), *rows])
    cards = [card_view(word, rows.get(word)) for word in words]
    active = [card for card in cards if not card["suspended"]]
    counts = {
        "total": len(active), "starter": len(starter_words()),
        "personal": sum(card["personal"] for card in active),
        "due": sum(bool(card["due_at"] and card["due_at"] <= timestamp) for card in active),
        "new": sum(card["status"] == "new" for card in active),
        "learned": sum(card["review_count"] > 0 for card in active),
        "suspended": sum(card["suspended"] for card in cards),
    }
    candidates = cards if scope == "suspended" else active
    filtered = [card for card in candidates if (
        scope == "all" or (scope == "personal" and card["personal"])
        or (scope == "due" and card["due_at"] and card["due_at"] <= timestamp)
        or (scope == "new" and card["status"] == "new")
        or (scope == "learned" and card["review_count"] > 0)
        or (scope == "suspended" and card["suspended"])
    ) and (not query or query.casefold() in f"{card['word']} {card['meaning']}".casefold())]
    # Personal words precede the starter list; dictionary frequency orders untouched starter words.
    filtered.sort(key=lambda card: (not card["personal"], card["due_at"] or "9999"))
    return {"items": filtered[offset:offset + limit], "total": len(filtered), "counts": counts, "offset": offset}


async def study_queue(session: AsyncSession, user_id: str, limit: int = 20, new_limit: int = 10, scope: str = "all") -> dict:
    rows = await saved_cards(session, user_id)
    timestamp = now_iso()
    active = [card_view(word, row) for word, row in rows.items() if not row.payload.get("suspended")]
    if scope == "personal":
        active = [card for card in active if card["personal"]]
    due = sorted([card for card in active if card["due_at"] and card["due_at"] <= timestamp], key=lambda card: (not card["personal"], card["due_at"]))
    personal_new = [card for card in active if card["status"] == "new" and card not in due]
    personal_new.sort(key=lambda card: not card["personal"])
    new = personal_new + ([card_view(word) for word in starter_words() if word not in rows] if scope == "all" else [])
    chosen = due[:limit]
    if scope != "due":
        chosen += new[:min(new_limit, limit - len(chosen))]
    return {"items": chosen, "due_count": len(due), "new_count": len(new)}


async def sync_knowledge(session: AsyncSession, user_id: str, card: dict, event_id: str) -> None:
    if not card["personal"] and card["lapses"] == 0:
        return
    sources = card.get("sources", [])
    link = sources[-1]["source_link"] if sources else f"/vocabulary?word={card['word']}"
    contexts = "\n".join(
        f"原句：{source['original_quote']}\n原用词：{source['original_form']}\n学习要点：{source['explanation']}"
        for source in sources
    )
    if sources:
        source = sources[-1]
        if source["source_link"].startswith("/writing"):
            origin = {"automatic": "作文批改自动积累", "requested": "作文主动积累"}.get(source.get("request_type"), "作文练习积累")
            reason = {"spelling": "拼写纠正", "usage": "用法纠正", "accumulate": "表达积累"}.get(source.get("reason"), "")
            source_summary = " · ".join(filter(None, [origin, reason]))
        else:
            source_summary = "历史词义练习中的错词"
    elif card.get("legacy_source"):
        link = card["legacy_source"]
        source_summary = "个人词表积累"
    else:
        source_summary = "背单词复习" if card["lapses"] else "手动编辑词卡"
    await put_knowledge(
        session, user_id, f"word:{card['word']}", card["word"],
        f"单词或短语：{card['word']}\n释义：{card['meaning']}\n例句：{card['example']}\n备注：{card['note']}\n{contexts}",
        "vocabulary", "vocabulary", link, source_summary=source_summary,
        status="review" if card["status"] == "learning" else card["status"], event_id=event_id,
    )


async def add_extracted_words(session: AsyncSession, user_id: str, job: CoachRecord, words: list[dict]) -> None:
    for item in words:
        word = normalize_word(item["word"])
        row = await find_card(session, user_id, word)
        old = card_view(word, row)
        source = {
            **{key: item[key] for key in ("reason", "original_form", "original_quote", "explanation", "example")},
            "job_id": job.id, "source_id": job.payload["source_id"],
            "source_link": job.payload["source_link"], "added_at": now_iso(),
            "request_type": job.payload["request_type"],
        }
        sources = old["sources"]
        if any(s["job_id"] == job.id for s in sources):
            continue
        same_event = any(s["source_id"] == source["source_id"] and s["reason"] == source["reason"] and s["original_quote"] == source["original_quote"] for s in sources)
        data = {**old, "personal": True, "meaning": item["meaning"], "part_of_speech": item["part_of_speech"], "example": item["example"], "sources": [*sources, source], "updated_at": now_iso()}
        if not row or (item["reason"] in {"spelling", "usage"} and not same_event):
            data.update(status="learning", due_at=now_iso(), interval_days=0)
        # Personal edits survive later automatic extraction.
        for field in old.get("edited_fields", []):
            data[field] = old[field]
        data["revision"] += 1
        if row:
            await store_card(session, row, data, old["revision"])
        else:
            row = CoachRecord(user_id=user_id, kind="word_card", source_key=word, payload=data)
            session.add(row)
        await session.flush()
        await sync_knowledge(session, user_id, data, f"extract:{job.id}:{word}")


async def review_word(session: AsyncSession, user_id: str, review) -> dict:
    key = f"review:{review.event_id}"
    existing = await session.scalar(select(CoachRecord).where(CoachRecord.user_id == user_id, CoachRecord.kind == "word_review", CoachRecord.source_key == key))
    if existing:
        if existing.payload["word"] != review.word or existing.payload["rating"] != review.rating:
            raise HTTPException(409, "Review identifier already used")
        return existing.payload["card"]
    row = await require_card(session, user_id, review.word)
    card = card_view(review.word, row)
    if card["suspended"] or card["revision"] != review.revision:
        raise HTTPException(409, "Card changed; reload before reviewing")
    now = datetime.now(UTC)
    interval = card["interval_days"]
    if review.rating == "again":
        interval, due = 0, now + timedelta(minutes=10)
    elif review.rating == "hard":
        interval = max(1, round(interval * 1.2))
        due = now + timedelta(days=interval)
    else:
        interval = 1 if interval == 0 else min(90, max(3, round(interval * 2.3)))
        due = now + timedelta(days=interval)
    card.update(
        status="learning" if review.rating == "again" else "review",
        due_at=due.isoformat(), interval_days=interval, last_reviewed_at=now.isoformat(),
        review_count=card["review_count"] + 1, revision=card["revision"] + 1,
        lapses=card["lapses"] + int(review.rating == "again"),
        personal=card["personal"] or review.rating == "again",
    )
    await store_card(session, row, card, review.revision)
    session.add(CoachRecord(user_id=user_id, kind="word_review", source_key=key, payload={"word": review.word, "rating": review.rating, "card": card}))
    await sync_knowledge(session, user_id, card, key)
    await session.commit()
    return card


async def edit_word(session: AsyncSession, user_id: str, edit) -> dict:
    row = await require_card(session, user_id, edit.word)
    card = card_view(edit.word, row)
    changes = edit.model_dump(exclude_none=True, exclude={"word"})
    if not changes:
        return card
    card.update(changes)
    if {"meaning", "example", "note"} & changes.keys():
        card["personal"] = True
    card["edited_fields"] = sorted(set(card.get("edited_fields", [])) | set(changes))
    card["revision"] += 1
    await store_card(session, row, card, card["revision"] - 1)
    await sync_knowledge(session, user_id, card, f"edit:{row.id}:{card['revision']}")
    await session.commit()
    return card
