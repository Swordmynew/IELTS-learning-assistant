from __future__ import annotations

import csv
import io
import json
from typing import Any

from pydantic import ValidationError

from app.schemas import QuestionImportItem


def _list_field(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if text.startswith("["):
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            raise ValueError("options/tags JSON must be an array")
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [item.strip() for item in text.split("|") if item.strip()]


def _normalise(raw: dict[str, Any], filename: str) -> dict[str, Any]:
    result = dict(raw)
    result["options"] = _list_field(result.get("options"))
    result["tags"] = _list_field(result.get("tags"))
    result["source_name"] = result.get("source_name") or filename
    for key in ("passage", "correct_answer", "explanation"):
        if result.get(key) == "":
            result[key] = None
    return result


def parse_question_file(filename: str, data: bytes) -> list[QuestionImportItem]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Question bank must use UTF-8 encoding") from error

    if filename.lower().endswith(".json"):
        raw: Any = json.loads(text)
        if isinstance(raw, dict):
            raw = raw.get("questions")
        if not isinstance(raw, list):
            raise ValueError("JSON must be an array or an object with a questions array")
        rows = raw
    elif filename.lower().endswith(".csv"):
        rows = list(csv.DictReader(io.StringIO(text)))
    else:
        raise ValueError("Only JSON and CSV question banks are supported")

    if not rows:
        raise ValueError("Question bank contains no questions")
    if len(rows) > 500:
        raise ValueError("A single import may contain at most 500 questions")
    try:
        return [QuestionImportItem.model_validate(_normalise(row, filename)) for row in rows]
    except (ValidationError, ValueError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid question bank row: {error}") from error
