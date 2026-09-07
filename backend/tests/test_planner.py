from datetime import date, timedelta

from app.schemas import LearnerProfileCreate, Skill, SkillEstimate, TaskType, VocabularyEstimate
from app.services.planner import build_week_plan, priority_score, validate_plan


def profile(minutes: int = 90) -> LearnerProfileCreate:
    return LearnerProfileCreate(
        exam_date=date.today() + timedelta(days=90),
        current_scores={skill: 5.5 for skill in Skill},
        target_scores={skill: 7.0 for skill in Skill},
        minutes_by_weekday={day: minutes for day in range(1, 8)},
        preferred_skills=[Skill.writing],
    )


def test_priority_increases_with_gap_and_preference() -> None:
    baseline = priority_score(6.5, 7, 0.2, 2, False)
    weak_preferred = priority_score(5, 7, 0.7, 14, True)
    assert weak_preferred > baseline
    assert 0 <= baseline <= 1


def test_week_plan_respects_all_hard_constraints() -> None:
    learner = profile()
    estimates = [
        SkillEstimate(skill=skill, band=5.5, confidence=0.8, recent_error_rate=0.5)
        for skill in Skill
    ]
    result = build_week_plan(learner, estimates)
    assert validate_plan(result, learner) == []
    assert any(task.task_type == TaskType.writing_task_2 for task in result.tasks)
    assert any(task.task_type == TaskType.review for task in result.tasks)


def test_infeasible_week_reports_missing_required_tasks() -> None:
    learner = profile(minutes=0)
    result = build_week_plan(learner)
    assert result.conflicts
    assert validate_plan(result, learner)


def test_vocabulary_result_changes_weekly_task_candidates() -> None:
    vocabulary = VocabularyEstimate(
        theta=-0.8,
        standard_error=0.4,
        level="B1 · 中级",
        cefr_reference="B1",
        estimated_word_families="约 2,500–4,000",
        meaning_accuracy=0.6,
        none_of_above_accuracy=0.5,
        study_focus="加强常见学术主题词和语境辨义",
    )
    result = build_week_plan(profile(minutes=120), vocabulary=vocabulary)
    vocabulary_tasks = [task for task in result.tasks if task.skill == "vocabulary"]
    assert vocabulary_tasks
    assert all(task.task_type == TaskType.vocabulary_review for task in vocabulary_tasks)
    assert "B1" in result.rationale


def test_plan_requests_assessment_when_vocabulary_result_is_missing() -> None:
    result = build_week_plan(profile(minutes=120))
    assert any(task.task_type == TaskType.vocabulary_assessment for task in result.tasks)
