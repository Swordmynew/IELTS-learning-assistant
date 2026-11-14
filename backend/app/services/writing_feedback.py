"""Small model-facing contract; bind verified quotations to server-owned metadata."""

import json
from typing import Literal

from pydantic import BaseModel, Field

from app.coach_schemas import CoachAssessment, Feedback, Improvement, Issue
from app.schemas import BandScore, Citation, CriterionAssessment, CriterionName, EvidenceSpan
from app.services.writing import round_band, validate_assessment


class FeedbackEvidence(BaseModel):
    quote: str = Field(min_length=1, description="Exact contiguous quotation from context.essay.")


class FeedbackCriterion(BaseModel):
    criterion: CriterionName
    band: BandScore
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[FeedbackEvidence] = Field(min_length=1)


class FeedbackAssessment(BaseModel):
    criteria: list[FeedbackCriterion] = Field(min_length=4, max_length=4)
    top_priorities: list[str] = Field(min_length=1, max_length=3)
    rewrite_example: str
    next_exercise: str


class FeedbackComparison(BaseModel):
    issue_id: str = Field(description="An exact ID from context.required_comparison_ids.")
    status: Literal["improved", "partial", "remaining"]
    new_quote: str = Field(min_length=1, description="Exact contiguous quotation from context.essay, not a suggested rewrite.")
    explanation: str


class WritingFeedbackDraft(BaseModel):
    """Generated judgments only; legacy redundant metadata is ignored, never trusted."""

    assessment: FeedbackAssessment
    issues: list[Issue] = Field(min_length=1, max_length=3)
    improvements: list[FeedbackComparison] = Field(default_factory=list)
    personal_note: str = ""
    personal_source_ids: list[str] = Field(default_factory=list)


class WritingFeedbackValidationError(ValueError):
    def __init__(self, errors: list[dict]):
        self.reason = "invalid_comparison" if any(
            error["path"][0] == "improvements" for error in errors
        ) else "invalid_evidence"
        # Paths and fixed rules only: do not put learner quotations in logs.
        super().__init__(json.dumps({"errors": errors}, ensure_ascii=False))


def writing_feedback_schema(context: dict) -> dict:
    schema = WritingFeedbackDraft.model_json_schema()
    schema["$defs"]["Issue"]["properties"]["source_ids"]["items"]["enum"] = [
        source["source_id"] for source in context["public_rubric"]
    ]
    comparisons = context["required_comparison_ids"]
    schema["properties"]["improvements"].update(minItems=len(comparisons), maxItems=len(comparisons))
    if comparisons:
        schema["$defs"]["FeedbackComparison"]["properties"]["issue_id"]["enum"] = comparisons
    personal_ids = [source["id"] for source in context["personal_learning"]]
    if personal_ids:
        schema["properties"]["personal_source_ids"]["items"]["enum"] = personal_ids
    else:
        schema["properties"]["personal_source_ids"]["maxItems"] = 0
    return schema


def bind_writing_feedback(
    draft: WritingFeedbackDraft,
    essay: str,
    citations: list[Citation],
    allowed_personal: set[str],
    previous: dict | None,
) -> Feedback:
    errors = []

    def invalid(path: list, rule: str) -> None:
        errors.append({"path": path, "rule": rule})

    def quote_exists(quote: str, path: list) -> None:
        if not quote.strip() or quote not in essay:
            invalid(path, "Copy a nonblank contiguous substring exactly from context.essay, preserving spelling, punctuation and spaces. Do not paraphrase or use suggested rewrites.")

    criteria = draft.assessment.criteria
    if {item.criterion for item in criteria} != set(CriterionName):
        invalid(["assessment", "criteria"], "Include each of the four criterion names exactly once; no duplicates.")
    for index, criterion in enumerate(criteria):
        for span_index, span in enumerate(criterion.evidence):
            quote_exists(span.quote, ["assessment", "criteria", index, "evidence", span_index, "quote"])
    allowed_citations = {citation.source_id for citation in citations}
    for index, issue in enumerate(draft.issues):
        quote_exists(issue.quote, ["issues", index, "quote"])
        if set(issue.source_ids) - allowed_citations:
            invalid(["issues", index, "source_ids"], "Use only source_id values from context.public_rubric.")
    if len({issue.id for issue in draft.issues}) != len(draft.issues):
        invalid(["issues"], "Use unique current issue IDs.")
    if set(draft.personal_source_ids) - allowed_personal:
        invalid(["personal_source_ids"], "Use only id values from context.personal_learning.")
    if draft.personal_note and not draft.personal_source_ids:
        invalid(["personal_source_ids"], "Personal advice requires at least one supplied personal source ID, or leave personal_note empty.")

    old_issues = {issue["id"]: issue for issue in previous["issues"]} if previous else {}
    comparison_ids = [item.issue_id for item in draft.improvements]
    if len(comparison_ids) != len(old_issues) or set(comparison_ids) != set(old_issues):
        invalid(["improvements"], "Include exactly one entry for every context.required_comparison_ids value, including unresolved issues; use [] for an initial version.")
    for index, item in enumerate(draft.improvements):
        quote_exists(item.new_quote, ["improvements", index, "new_quote"])
        if previous and item.status == "improved" and item.new_quote in previous["essay"]:
            invalid(["improvements", index, "new_quote"], "An unchanged quotation cannot establish improved status. Quote the actual changed passage, or choose partial/remaining when the issue persists.")
    if errors:
        raise WritingFeedbackValidationError(errors)

    rubric_ids = {
        CriterionName.task_achievement: "ielts-writing-task-response",
        CriterionName.coherence_cohesion: "ielts-writing-coherence",
        CriterionName.lexical_resource: "ielts-writing-lexical",
        CriterionName.grammar_accuracy: "ielts-writing-grammar",
    }
    by_id = {citation.source_id: citation for citation in citations}
    assessment = CoachAssessment(
        estimated_overall_band=round_band(sum(item.band for item in criteria) / 4),
        criteria=[
            CriterionAssessment(
                criterion=item.criterion,
                band=item.band,
                confidence=item.confidence,
                explanation=item.explanation,
                evidence=[EvidenceSpan(quote=span.quote, start=essay.index(span.quote),
                                       end=essay.index(span.quote) + len(span.quote))
                          for span in item.evidence],
                citations=[by_id[rubric_ids[item.criterion]]],
            )
            for item in criteria
        ],
        top_priorities=draft.assessment.top_priorities,
        rewrite_example=draft.assessment.rewrite_example,
        next_exercise=draft.assessment.next_exercise,
    )
    if validate_assessment(assessment, essay):
        raise ValueError("Bound assessment failed server integrity checks")
    return Feedback(
        assessment=assessment,
        issues=draft.issues,
        improvements=[Improvement(**item.model_dump(), old_quote=old_issues[item.issue_id]["quote"])
                      for item in draft.improvements],
        personal_note=draft.personal_note,
        personal_source_ids=draft.personal_source_ids,
    )
