"""Learning facts remain distinct from editable, derived learning notes."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import (
    CoachRecord,
    PracticeAttemptRow,
    PracticeQuestionRow,
    VocabularyTestSessionRow,
    WritingAssessmentRow,
)
from app.services.embeddings import embed_text


async def put_knowledge(
    session: AsyncSession,
    user_id: str,
    key: str,
    title: str,
    content: str,
    category: str,
    module: str,
    link: str,
    status: str = "review",
    event_id: str = "",
    source_summary: str = "",
) -> None:
    row = await session.scalar(
        select(CoachRecord).where(
            CoachRecord.user_id == user_id,
            CoachRecord.kind == "knowledge",
            CoachRecord.source_key == key,
        )
    )
    if row and row.payload.get("event_id") == event_id:
        return
    if row and row.payload.get("deleted"):
        if target_id := row.payload.get("merged_into"):
            target = await session.get(CoachRecord, target_id)
            if target and target.user_id == user_id and not target.payload.get("deleted"):
                merged = {
                    **target.payload.get("merged_records", {}),
                    key: {
                        "title": title,
                        "content": content,
                        "source_link": link,
                        "source_summary": source_summary,
                        "status": status,
                    },
                }
                data = {
                    **target.payload,
                    "merged_records": merged,
                    "updated_at": datetime.now(UTC).isoformat(),
                }
                await index_payload(data)
                target.payload = data
                row.payload = {**row.payload, "event_id": event_id}
        return
    old = row.payload if row else {}
    data = {
        **old,
        "title": old.get("title", title),
        "content": content,
        "category": category,
        "module": module,
        "source_link": link,
        "source_summary": source_summary,
        "status": status,
        "event_id": event_id,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    await index_payload(data)
    if row:
        row.payload = data
    else:
        session.add(CoachRecord(user_id=user_id, kind="knowledge", source_key=key, payload=data))
    await session.flush()


async def index_payload(data: dict) -> None:
    merged_text = "\n".join(item["content"] for item in data.get("merged_records", {}).values())
    vector, model = await embed_text(
        f"{data['title']}\n{data['content']}\n{data.get('note', '')}\n{merged_text}", get_settings()
    )
    data["embedding"] = vector
    data["embedding_model"] = model


async def capture_attempt(
    session: AsyncSession, user_id: str, question: PracticeQuestionRow, attempt: PracticeAttemptRow
) -> None:
    # Record wrong answers; retain and update previously accumulated mistakes after correct retries.
    key = f"question:{question.id}"
    existing = await session.scalar(
        select(CoachRecord.id).where(
            CoachRecord.user_id == user_id,
            CoachRecord.kind == "knowledge",
            CoachRecord.source_key == key,
        )
    )
    if attempt.is_correct and not existing:
        return
    content = (
        f"题目：{question.prompt}\n原文：{question.passage or ''}\n"
        f"最近作答：{attempt.submitted_answer}\n参考答案：{question.correct_answer}\n"
        f"原有解析：{question.explanation or '暂无解析'}\n"
        f"最近结果：{'答对' if attempt.is_correct else '答错'}"
    )
    await put_knowledge(
        session,
        user_id,
        key,
        question.prompt[:160],
        content,
        "mistake",
        question.module,
        f"/question-bank?module={question.module}&question={question.id}",
        status="correct_latest" if attempt.is_correct else "review",
        event_id=attempt.id,
    )


async def capture_vocabulary(
    session: AsyncSession, user_id: str, row: VocabularyTestSessionRow
) -> None:
    from app.services.vocabulary import ITEMS_BY_ID, NONE_OF_ABOVE_INDEX

    for response in row.responses[-1:]:
        item = ITEMS_BY_ID[response["item_id"]]
        if item.correct_index == NONE_OF_ABOVE_INDEX:
            continue
        key = f"word:{item.surface.lower()}"
        existing = await session.scalar(
            select(CoachRecord.id).where(
                CoachRecord.user_id == user_id,
                CoachRecord.kind == "knowledge",
                CoachRecord.source_key == key,
            )
        )
        if response["correct"] and not existing:
            continue
        options = [*item.options, "以上都不是"]
        content = (
            f"单词：{item.surface}\n选择的释义：{options[response['selected_option']]}\n"
            f"正确释义：{options[item.correct_index]}\n最近结果：{'答对' if response['correct'] else '答错'}"
        )
        await put_knowledge(
            session,
            user_id,
            key,
            item.surface,
            content,
            "vocabulary",
            "vocabulary",
            f"/vocabulary?test={row.id}",
            status="correct_latest" if response["correct"] else "review",
            event_id=f"{row.id}:{item.id}",
        )


async def backfill(session: AsyncSession, user_id: str) -> int:
    attempts = (
        await session.execute(
            select(PracticeAttemptRow, PracticeQuestionRow)
            .join(PracticeQuestionRow, PracticeQuestionRow.id == PracticeAttemptRow.question_id)
            .where(PracticeAttemptRow.user_id == user_id)
            .order_by(PracticeAttemptRow.created_at)
        )
    ).all()
    # Build each question once using its latest answer, retaining questions ever answered incorrectly.
    wrong_ids = {q.id for a, q in attempts if not a.is_correct}
    latest = {q.id: (a, q) for a, q in attempts if q.id in wrong_ids}
    for attempt, question in latest.values():
        await put_knowledge(
            session,
            user_id,
            f"question:{question.id}",
            question.prompt[:160],
            f"题目：{question.prompt}\n原文：{question.passage or ''}\n最近作答：{attempt.submitted_answer}"
            f"\n参考答案：{question.correct_answer}\n原有解析：{question.explanation or ''}",
            "mistake",
            question.module,
            f"/question-bank?module={question.module}&question={question.id}",
            status="correct_latest" if attempt.is_correct else "review",
            event_id=attempt.id,
        )
    vocab_rows = list(
        await session.scalars(
            select(VocabularyTestSessionRow)
            .where(VocabularyTestSessionRow.user_id == user_id)
            .order_by(VocabularyTestSessionRow.created_at)
        )
    )
    # Each response is idempotent; chronological replay is unnecessary for records already present.
    from app.services.vocabulary import ITEMS_BY_ID, NONE_OF_ABOVE_INDEX

    words = {}
    wrong_words = set()
    for row in vocab_rows:
        for response in row.responses:
            item = ITEMS_BY_ID[response["item_id"]]
            if item.correct_index == NONE_OF_ABOVE_INDEX:
                continue
            if not response["correct"]:
                wrong_words.add(item.surface)
            words[item.surface] = (row, response)
    for word in wrong_words:
        row, response = words[word]
        item = ITEMS_BY_ID[response["item_id"]]
        options = [*item.options, "以上都不是"]
        await put_knowledge(
            session,
            user_id,
            f"word:{word.lower()}",
            word,
            f"单词：{word}\n选择的释义：{options[response['selected_option']]}\n正确释义：{options[item.correct_index]}",
            "vocabulary",
            "vocabulary",
            f"/vocabulary?test={row.id}",
            status="correct_latest" if response["correct"] else "review",
            event_id=f"{row.id}:{item.id}",
        )
    coach_versions = set(
        await session.scalars(
            select(CoachRecord.id).where(
                CoachRecord.user_id == user_id, CoachRecord.kind == "writing_version"
            )
        )
    )
    for assessment in await session.scalars(
        select(WritingAssessmentRow).where(WritingAssessmentRow.user_id == user_id)
    ):
        if assessment.id in coach_versions:
            continue
        await put_knowledge(
            session,
            user_id,
            f"assessment:{assessment.id}",
            "历史写作反馈",
            "\n".join(assessment.assessment.get("top_priorities", [])),
            "writing",
            "writing",
            f"/writing?assessment={assessment.id}",
            event_id=assessment.id,
        )
    await session.commit()
    return len(latest) + len(wrong_words)


def knowledge_source_summary(data: dict) -> str:
    """Describe provenance for old vocabulary entries without rewriting learner data."""
    if summary := data.get("source_summary"):
        return summary
    link = data.get("source_link", "")
    if link.startswith("/writing"):
        return "作文练习积累"
    if link.startswith("/vocabulary?test="):
        return "历史词义练习中的错词"
    if link.startswith("/vocabulary"):
        return "个人词表积累"
    return ""


def knowledge_view(row: CoachRecord) -> dict:
    data = {k: v for k, v in row.payload.items() if k not in {"embedding", "pending", "confirmed"}}
    if data.get("category") == "vocabulary":
        data["source_summary"] = knowledge_source_summary(data)
    if "merged_records" in data:
        data["merged_records"] = {
            key: {**{k: v for k, v in item.items() if k not in {"pending", "confirmed"}},
                  "source_summary": knowledge_source_summary(item)}
            for key, item in data["merged_records"].items()
        }
    return {"id": row.id, **data}
