"""Validate exact source IDs, then assign display numbers on the server."""

import re

from app.coach_schemas import TutorAnswer
from app.schemas import Citation

SOURCE_MARKER = re.compile(r"\[\[([^\[\]\n]+)\]\]")
NUMBER_MARKER = re.compile(r"(?<!\[)\[\d+\](?!\])")


class CitationValidationError(ValueError):
    pass


def validate_tutor_answer(value: TutorAnswer, sources: list[Citation]) -> TutorAnswer:
    allowed = {source.source_id for source in sources}
    declared = set(value.source_ids)
    markers = set(SOURCE_MARKER.findall(value.answer))
    problems = []
    if unknown := declared - allowed:
        problems.append(f"Unknown source_ids: {sorted(unknown)}")
    if value.sufficient and not declared:
        problems.append("sufficient=true requires nonempty source_ids")
    if markers - allowed or markers - declared:
        problems.append("Each [[source_id]] must be supplied in sources and listed in source_ids")
    unmarked = SOURCE_MARKER.sub("", value.answer)
    if "[[" in unmarked or "]]" in unmarked:
        problems.append("Malformed source marker; use complete [[source_id]] markers only")
    if NUMBER_MARKER.search(value.answer):
        problems.append("Do not invent [number] references; use [[source_id]] with the exact source_id instead")
    if not value.sufficient and markers:
        problems.append("An insufficient answer must not contain source markers")
    if problems:
        raise CitationValidationError("; ".join(problems) + f". Allowed source_ids: {sorted(allowed)}")
    return value


def render_tutor_answer(value: TutorAnswer, sources: list[Citation]) -> str:
    """Only validated IDs become the numbers shown alongside the source cards."""
    validate_tutor_answer(value, sources)
    numbers = {source.source_id: source.number or index + 1 for index, source in enumerate(sources)}
    answer = SOURCE_MARKER.sub(lambda match: f"[{numbers[match.group(1)]}]", value.answer)
    if value.sufficient and not SOURCE_MARKER.search(value.answer):
        # A source list without inline markers supports the answer as a whole.
        answer += " " + "".join(f"[{numbers[source_id]}]" for source_id in dict.fromkeys(value.source_ids))
    return answer
