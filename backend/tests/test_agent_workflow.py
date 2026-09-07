from datetime import date, timedelta

from app.agents.workflow import generate_plan_with_trace
from app.schemas import LearnerProfileCreate, Skill


def test_planning_agent_has_auditable_node_order() -> None:
    profile = LearnerProfileCreate(
        exam_date=date.today() + timedelta(days=45),
        current_scores={skill: 5.5 for skill in Skill},
        target_scores={skill: 7.0 for skill in Skill},
        minutes_by_weekday={day: 60 for day in range(1, 8)},
        preferred_skills=[Skill.writing],
    )
    plan, trace = generate_plan_with_trace(profile, [])
    assert trace == ["intake", "diagnose", "retrieve", "plan", "validate"]
    assert plan.status.value == "draft"
    assert plan.tasks

