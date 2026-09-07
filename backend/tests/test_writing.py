import pytest

from app.schemas import CriterionName, TaskType, WritingAssessment, WritingSubmission
from app.services.writing import (
    DeterministicWritingGrader,
    normalize_assessment,
    portable_json_schema,
    round_band,
    validate_assessment,
)


def test_round_band_uses_half_band_steps() -> None:
    assert round_band(6.24) == 6.0
    assert round_band(6.26) == 6.5
    assert round_band(9.4) == 9.0


def test_portable_schema_removes_provider_specific_formats() -> None:
    schema = portable_json_schema(WritingAssessment.model_json_schema())
    assert '"format"' not in str(schema)
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])


@pytest.mark.asyncio
async def test_demo_grader_returns_traceable_four_criterion_result() -> None:
    essay = (
        "Education improves opportunity because it gives people useful skills. "
        "However, governments also need to fund hospitals and transport. "
        "A balanced policy can therefore support students who need help. "
        "This approach is fair and financially sustainable. "
        "Universities can also provide scholarships for strong applicants. "
        "In conclusion, targeted support is better than an unlimited promise."
    )
    submission = WritingSubmission(
        task_type=TaskType.writing_task_2,
        prompt="University should be free for everyone. To what extent do you agree or disagree?",
        essay=essay,
    )
    assessment = await DeterministicWritingGrader().grade(submission)
    assert {item.criterion for item in assessment.criteria} == set(CriterionName)
    assert all(item.citations for item in assessment.criteria)
    assert validate_assessment(assessment, essay) == []
    assert "AI 估分" in assessment.disclaimer


@pytest.mark.asyncio
async def test_normalizer_repairs_offsets_score_and_citations() -> None:
    essay = (
        "Education improves opportunity because it gives people useful skills. "
        "However, public budgets are limited and policy should remain targeted."
    )
    submission = WritingSubmission(
        task_type=TaskType.writing_task_2,
        prompt="University should be free for everyone. To what extent do you agree or disagree?",
        essay=essay,
    )
    original = await DeterministicWritingGrader().grade(submission)
    broken_criteria = [
        item.model_copy(
            update={
                "evidence": [span.model_copy(update={"start": 0, "end": len(span.quote)}) for span in item.evidence],
                "citations": [],
            }
        )
        for item in original.criteria
    ]
    broken = original.model_copy(
        update={"estimated_overall_band": 1.0, "criteria": broken_criteria}
    )
    citations = [item.citations[0] for item in original.criteria]
    normalized = normalize_assessment(broken, essay, citations)
    assert validate_assessment(normalized, essay) == []
