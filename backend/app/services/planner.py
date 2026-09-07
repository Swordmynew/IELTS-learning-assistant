from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from math import exp
from typing import Literal
from uuid import uuid4

from app.schemas import (
    LearnerProfileCreate,
    Skill,
    SkillEstimate,
    StudyPlan,
    StudyTask,
    TaskType,
    VocabularyEstimate,
)


@dataclass(frozen=True)
class TaskTemplate:
    task_type: TaskType
    skill: Skill | Literal["vocabulary"]
    title: str
    objective: str
    duration: int
    high_load: bool = False


TEMPLATES: tuple[TaskTemplate, ...] = (
    TaskTemplate(TaskType.writing_task_2, Skill.writing, "Task 2 限时写作", "完成审题、提纲和一篇完整议论文", 60, True),
    TaskTemplate(TaskType.writing_task_1, Skill.writing, "Task 1 数据描述", "练习概述句、关键特征选择与数据比较", 45, True),
    TaskTemplate(TaskType.review, Skill.writing, "写作错因复盘", "根据最近反馈改写问题段落并记录规则", 30),
    TaskTemplate(TaskType.reading_drill, Skill.reading, "阅读定位训练", "限时完成一组定位与同义替换练习", 30),
    TaskTemplate(TaskType.listening_drill, Skill.listening, "听力精听训练", "完成精听、错误归因和关键词复述", 30),
    TaskTemplate(TaskType.speaking_reflection, Skill.speaking, "口语话题复盘", "录制两分钟回答并自查流利度与词汇重复", 20),
)

VOCABULARY_ASSESSMENT = TaskTemplate(
    TaskType.vocabulary_assessment,
    "vocabulary",
    "完成词汇能力测评",
    "完成自适应词义选择测评，让后续计划使用词汇能力数据",
    15,
)
VOCABULARY_REVIEW = TaskTemplate(
    TaskType.vocabulary_review,
    "vocabulary",
    "词汇语境与词义巩固",
    "根据测评层级复习高频词义、同义替换和常用搭配",
    25,
)


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def priority_score(
    current: float,
    target: float,
    recent_error_rate: float,
    days_since_practice: int,
    preferred: bool,
) -> float:
    """Transparent priority formula defined in the product specification."""
    gap = _clamp((target - current) / 3.0)
    recency = _clamp(1 - exp(-days_since_practice / 14))
    preference = 1.0 if preferred else 0.0
    return round(
        0.45 * gap + 0.30 * _clamp(recent_error_rate) + 0.15 * recency + 0.10 * preference,
        4,
    )


def _skill_estimates(profile: LearnerProfileCreate, estimates: list[SkillEstimate]) -> dict[Skill, SkillEstimate]:
    provided = {item.skill: item for item in estimates}
    return {
        skill: provided.get(
            skill,
            SkillEstimate(skill=skill, band=profile.current_scores[skill], confidence=0.6),
        )
        for skill in Skill
    }


def _candidates(
    profile: LearnerProfileCreate,
    estimates: list[SkillEstimate],
    vocabulary: VocabularyEstimate | None,
) -> list[tuple[TaskTemplate, float]]:
    by_skill = _skill_estimates(profile, estimates)
    candidates: list[tuple[TaskTemplate, float]] = []
    for template in TEMPLATES:
        estimate = by_skill[template.skill]
        score = priority_score(
            estimate.band,
            profile.target_scores[template.skill],
            estimate.recent_error_rate,
            estimate.days_since_practice,
            template.skill in profile.preferred_skills,
        )
        candidates.append((template, score))
        if template.task_type in {TaskType.review, TaskType.reading_drill, TaskType.listening_drill}:
            candidates.append((template, max(0.05, round(score * 0.9, 4))))
    if vocabulary is None:
        candidates.append((VOCABULARY_ASSESSMENT, 0.62))
    else:
        average_target_band = sum(profile.target_scores.values()) / len(profile.target_scores)
        target_theta = max(-0.4, min(1.4, -0.4 + 0.6 * (average_target_band - 5.0)))
        vocabulary_score = round(
            0.55 * _clamp((target_theta - vocabulary.theta) / 3.0)
            + 0.35 * (1.0 - vocabulary.meaning_accuracy)
            + 0.10 * _clamp(vocabulary.standard_error),
            4,
        )
        candidates.append((VOCABULARY_REVIEW, max(0.12, vocabulary_score)))
        if vocabulary.cefr_reference in {"A1", "A2", "B1", "B2"}:
            candidates.append((VOCABULARY_REVIEW, max(0.1, round(vocabulary_score * 0.9, 4))))
    return candidates


def _next_seven_days(start: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range(7)]


def _greedy_schedule(
    profile: LearnerProfileCreate,
    candidates: list[tuple[TaskTemplate, float]],
    start: date,
) -> tuple[list[StudyTask], list[str]]:
    """Deterministic fallback used when OR-Tools is unavailable."""
    remaining = {day: profile.minutes_by_weekday.get(day.isoweekday(), 0) for day in _next_seven_days(start)}
    high_loads = {day: 0 for day in remaining}
    tasks: list[StudyTask] = []
    ordered = sorted(
        candidates,
        key=lambda item: (
            item[0].task_type not in {TaskType.writing_task_2, TaskType.review},
            -item[1],
            -item[0].duration,
        ),
    )
    for template, score in ordered:
        valid_days = [
            day
            for day, minutes in remaining.items()
            if minutes >= template.duration and (not template.high_load or high_loads[day] < 2)
        ]
        if not valid_days:
            continue
        day = max(valid_days, key=lambda item: (remaining[item], -item.toordinal()))
        tasks.append(
            StudyTask(
                id=uuid4(),
                scheduled_date=day,
                skill=template.skill,
                task_type=template.task_type,
                title=template.title,
                objective=template.objective,
                duration_minutes=template.duration,
                priority=score,
                high_load=template.high_load,
            )
        )
        remaining[day] -= template.duration
        high_loads[day] += int(template.high_load)

    required = {TaskType.writing_task_2, TaskType.review}
    missing = required - {task.task_type for task in tasks}
    conflicts = [f"可用时间不足，未能安排必需任务：{item.value}" for item in sorted(missing)]
    return sorted(tasks, key=lambda task: (task.scheduled_date, -task.priority)), conflicts


def _cp_sat_schedule(
    profile: LearnerProfileCreate,
    candidates: list[tuple[TaskTemplate, float]],
    start: date,
) -> tuple[list[StudyTask], list[str]]:
    from ortools.sat.python import cp_model

    days = _next_seven_days(start)
    model = cp_model.CpModel()
    assignments: dict[tuple[int, int], cp_model.IntVar] = {}
    for candidate_index in range(len(candidates)):
        for day_index in range(len(days)):
            assignments[candidate_index, day_index] = model.new_bool_var(
                f"task_{candidate_index}_day_{day_index}"
            )
        model.add(sum(assignments[candidate_index, day_index] for day_index in range(len(days))) <= 1)

    for day_index, day in enumerate(days):
        capacity = profile.minutes_by_weekday.get(day.isoweekday(), 0)
        model.add(
            sum(
                assignments[index, day_index] * template.duration
                for index, (template, _) in enumerate(candidates)
            )
            <= capacity
        )
        model.add(
            sum(
                assignments[index, day_index]
                for index, (template, _) in enumerate(candidates)
                if template.high_load
            )
            <= 2
        )

    for required in (TaskType.writing_task_2, TaskType.review):
        possible = [
            assignments[index, day_index]
            for index, (template, _) in enumerate(candidates)
            if template.task_type == required
            for day_index in range(len(days))
        ]
        model.add(sum(possible) >= 1)

    model.maximize(
        sum(
            assignments[index, day_index] * max(1, round(score * 1000))
            for index, (_, score) in enumerate(candidates)
            for day_index in range(len(days))
        )
    )
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 3
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _greedy_schedule(profile, candidates, start)

    tasks: list[StudyTask] = []
    for index, (template, score) in enumerate(candidates):
        for day_index, day in enumerate(days):
            if solver.value(assignments[index, day_index]):
                tasks.append(
                    StudyTask(
                        scheduled_date=day,
                        skill=template.skill,
                        task_type=template.task_type,
                        title=template.title,
                        objective=template.objective,
                        duration_minutes=template.duration,
                        priority=score,
                        high_load=template.high_load,
                    )
                )
    return sorted(tasks, key=lambda task: (task.scheduled_date, -task.priority)), []


def build_week_plan(
    profile: LearnerProfileCreate,
    estimates: list[SkillEstimate] | None = None,
    vocabulary: VocabularyEstimate | None = None,
    start: date | None = None,
) -> StudyPlan:
    start = start or date.today()
    candidates = _candidates(profile, estimates or [], vocabulary)
    try:
        tasks, conflicts = _cp_sat_schedule(profile, candidates, start)
    except ImportError:
        tasks, conflicts = _greedy_schedule(profile, candidates, start)
    strongest = sorted(
        (
            (skill, max((task.priority for task in tasks if task.skill == skill), default=0))
            for skill in [*(item.value for item in Skill), "vocabulary"]
        ),
        key=lambda item: item[1],
        reverse=True,
    )[:2]
    skill_labels = {
        "listening": "听力",
        "reading": "阅读",
        "writing": "写作",
        "speaking": "口语",
        "vocabulary": "词汇",
    }
    focus = "、".join(skill_labels[label] for label, _ in strongest)
    vocabulary_note = (
        f"词汇测评参考为 {vocabulary.cefr_reference}，已用于调整词汇任务频次。"
        if vocabulary
        else "尚无词汇测评结果，已优先安排一次词汇测评。"
    )
    return StudyPlan(
        starts_on=start,
        ends_on=start + timedelta(days=6),
        rationale=(
            f"已按照你每天可用的时间安排任务，本周优先加强{focus}。{vocabulary_note}"
        ),
        tasks=tasks,
        conflicts=conflicts,
    )


def validate_plan(plan: StudyPlan, profile: LearnerProfileCreate) -> list[str]:
    errors: list[str] = []
    for day in _next_seven_days(plan.starts_on):
        day_tasks = [task for task in plan.tasks if task.scheduled_date == day]
        total = sum(task.duration_minutes for task in day_tasks)
        limit = profile.minutes_by_weekday.get(day.isoweekday(), 0)
        if total > limit:
            errors.append(f"{day.isoformat()} scheduled {total} minutes but limit is {limit}")
        if sum(task.high_load for task in day_tasks) > 2:
            errors.append(f"{day.isoformat()} has more than two high-load tasks")
    if not any(task.task_type == TaskType.writing_task_2 for task in plan.tasks):
        errors.append("weekly plan must include one complete Task 2 writing session")
    if not any(task.task_type == TaskType.review for task in plan.tasks):
        errors.append("weekly plan must include one review session")
    return errors
