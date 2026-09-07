from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.schemas import LearnerProfileCreate, SkillEstimate, StudyPlan, VocabularyEstimate
from app.services.planner import build_week_plan, validate_plan
from app.services.rag import retrieve_official_rubric


class PlanningState(TypedDict, total=False):
    profile: dict[str, Any]
    estimates: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    plan: dict[str, Any]
    validation_errors: list[str]
    vocabulary: dict[str, Any] | None
    trace: list[str]


def _append_trace(state: PlanningState, node: str) -> list[str]:
    return [*state.get("trace", []), node]


def intake(state: PlanningState) -> PlanningState:
    LearnerProfileCreate.model_validate(state["profile"])
    return {"trace": _append_trace(state, "intake")}


def diagnose(state: PlanningState) -> PlanningState:
    profile = LearnerProfileCreate.model_validate(state["profile"])
    supplied = [SkillEstimate.model_validate(item) for item in state.get("estimates", [])]
    if not supplied:
        supplied = [
            SkillEstimate(skill=skill, band=band, confidence=0.6)
            for skill, band in profile.current_scores.items()
        ]
    return {
        "estimates": [item.model_dump(mode="json") for item in supplied],
        "trace": _append_trace(state, "diagnose"),
    }


def retrieve(state: PlanningState) -> PlanningState:
    evidence = retrieve_official_rubric("IELTS Academic writing improvement criteria")
    return {
        "evidence": [item.model_dump(mode="json") for item in evidence],
        "trace": _append_trace(state, "retrieve"),
    }


def plan(state: PlanningState) -> PlanningState:
    profile = LearnerProfileCreate.model_validate(state["profile"])
    estimates = [SkillEstimate.model_validate(item) for item in state["estimates"]]
    vocabulary = (
        VocabularyEstimate.model_validate(state["vocabulary"])
        if state.get("vocabulary")
        else None
    )
    result = build_week_plan(profile, estimates, vocabulary)
    return {"plan": result.model_dump(mode="json"), "trace": _append_trace(state, "plan")}


def validate(state: PlanningState) -> PlanningState:
    profile = LearnerProfileCreate.model_validate(state["profile"])
    result = StudyPlan.model_validate(state["plan"])
    errors = validate_plan(result, profile)
    return {"validation_errors": errors, "trace": _append_trace(state, "validate")}


def build_planning_graph():
    builder = StateGraph(PlanningState)
    builder.add_node("intake", intake)
    builder.add_node("diagnose", diagnose)
    builder.add_node("retrieve", retrieve)
    builder.add_node("plan", plan)
    builder.add_node("validate", validate)
    builder.add_edge(START, "intake")
    builder.add_edge("intake", "diagnose")
    builder.add_edge("diagnose", "retrieve")
    builder.add_edge("retrieve", "plan")
    builder.add_edge("plan", "validate")
    builder.add_edge("validate", END)
    return builder.compile()


planning_graph = build_planning_graph()


def generate_plan_with_trace(
    profile: LearnerProfileCreate,
    estimates: list[SkillEstimate],
    vocabulary: VocabularyEstimate | None = None,
) -> tuple[StudyPlan, list[str]]:
    state = planning_graph.invoke(
        {
            "profile": profile.model_dump(mode="json"),
            "estimates": [item.model_dump(mode="json") for item in estimates],
            "vocabulary": vocabulary.model_dump(mode="json") if vocabulary else None,
            "trace": [],
        }
    )
    if state.get("validation_errors"):
        plan_value = StudyPlan.model_validate(state["plan"])
        plan_value.conflicts.extend(state["validation_errors"])
    else:
        plan_value = StudyPlan.model_validate(state["plan"])
    return plan_value, state["trace"]
