from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import VocabularyTestSessionRow
from app.schemas import (
    VocabularyEstimate,
    VocabularyItemPrompt,
    VocabularyTest,
    VocabularyTestAnswer,
    VocabularyTestStatus,
)

MIN_ITEMS = 15
MAX_ITEMS = 20
STOPPING_STANDARD_ERROR = 0.45
GUESSING_PARAMETER = 0.2
NONE_OF_ABOVE_INDEX = 4


@dataclass(frozen=True, slots=True)
class VocabularyItem:
    id: str
    surface: str
    options: tuple[str, str, str, str]
    correct_index: int
    difficulty: float
    discrimination: float


def _item(
    item_id: str,
    surface: str,
    options: tuple[str, str, str, str],
    correct_index: int,
    difficulty: float,
    discrimination: float,
) -> VocabularyItem:
    return VocabularyItem(
        item_id, surface, options, correct_index, difficulty, discrimination
    )


# Project-authored pilot items. Meanings and distractors are original short Chinese glosses.
# Difficulty/discrimination values are engineering priors, not empirical calibration.
VOCABULARY_ITEMS = (
    _item("v001", "garden", ("花园", "车站", "医生", "冬天"), 0, -2.6, 0.95),
    _item("v002", "family", ("工厂", "家庭", "节日", "家具"), 1, -2.4, 1.00),
    _item("v003", "travel", ("修理", "旅行", "收集", "等待"), 1, -2.2, 1.00),
    _item("v004", "improve", ("忽视", "分割", "推迟", "复制"), 4, -2.0, 1.05),
    _item("v005", "common", ("昂贵的", "常见的", "狭窄的", "私人的"), 1, -1.8, 1.05),
    _item("v006", "prepare", ("准备", "预测", "保护", "呈现"), 0, -1.6, 1.10),
    _item("v007", "benefit", ("障碍", "益处", "边界", "预算"), 1, -1.4, 1.10),
    _item("v008", "evidence", ("证据", "事件", "设备", "环境"), 0, -1.2, 1.15),
    _item("v009", "require", ("拒绝", "获得", "需要", "减少"), 2, -1.0, 1.15),
    _item("v010", "accurate", ("灵活的", "熟悉的", "积极的", "临时的"), 4, -0.8, 1.20),
    _item("v011", "despite", ("尽管", "由于", "除非", "关于"), 0, -0.6, 1.20),
    _item("v012", "approach", ("附加费用", "方法", "批准", "争论"), 1, -0.4, 1.20),
    _item("v013", "decline", ("宣布", "下降", "描述", "推导"), 1, -0.2, 1.25),
    _item("v014", "coherent", ("连贯的", "谨慎的", "拥挤的", "合作的"), 0, 0.0, 1.30),
    _item("v015", "allocate", ("夸大", "分配", "积累", "改变"), 1, 0.2, 1.30),
    _item("v016", "reluctant", ("相关的", "不情愿的", "可靠的", "重复的"), 1, 0.4, 1.30),
    _item("v017", "ambiguous", ("有野心的", "可调整的", "有益的", "古老的"), 4, 0.6, 1.35),
    _item("v018", "mitigate", ("减轻", "模仿", "迁移", "测量"), 0, 0.8, 1.35),
    _item("v019", "prevalent", ("私密的", "普遍的", "先前的", "精确的"), 1, 1.0, 1.35),
    _item("v020", "plausible", ("令人愉快的", "貌似合理的", "可携带的", "有利润的"), 1, 1.2, 1.40),
    _item("v021", "arbitrary", ("任意武断的", "有条理的", "辅助性的", "相邻的"), 0, 1.4, 1.35),
    _item("v022", "exacerbate", ("交换", "加剧", "排除", "执行"), 1, 1.6, 1.35),
    _item("v023", "ubiquitous", ("含糊的", "不稳定的", "无偏见的", "一致的"), 4, 1.8, 1.30),
    _item("v024", "incongruous", ("不协调的", "不可避免的", "缺乏经验的", "难以置信的"), 0, 2.0, 1.25),
    _item("v025", "perspicacious", ("坚持不懈的", "洞察力强的", "悲观的", "容易说服的"), 1, 2.3, 1.15),
    _item("v026", "obsequious", ("过分顺从的", "令人反感的", "不易察觉的", "过时的"), 0, 2.6, 1.05),
)

# Retained only so unfinished sessions created by an older build can still be completed.
LEGACY_ITEMS = tuple(
    _item(
        item_id,
        surface,
        ("常见动作", "具体物品", "人物特征", "抽象概念"),
        NONE_OF_ABOVE_INDEX,
        difficulty,
        1.0,
    )
    for item_id, surface, difficulty in (
        ("p001", "corden", -2.4), ("p002", "frample", -2.0),
        ("p003", "slinter", -1.6), ("p004", "destive", -1.2),
        ("p005", "clovent", -0.8), ("p006", "renclude", -0.4),
        ("p007", "ambivate", 0.0), ("p008", "travenous", 0.4),
        ("p009", "mitigous", 0.8), ("p010", "vexolate", 1.2),
        ("p011", "ubigenous", 1.6), ("p012", "perspicant", 2.0),
        ("p013", "obsequate", 2.4),
    )
)

ITEMS_BY_ID = {item.id: item for item in (*VOCABULARY_ITEMS, *LEGACY_ITEMS)}


def probability_correct(theta: float, item: VocabularyItem) -> float:
    logistic = 1.0 / (1.0 + math.exp(-item.discrimination * (theta - item.difficulty)))
    return GUESSING_PARAMETER + (1.0 - GUESSING_PARAMETER) * logistic


def item_information(theta: float, item: VocabularyItem) -> float:
    logistic = 1.0 / (1.0 + math.exp(-item.discrimination * (theta - item.difficulty)))
    probability = GUESSING_PARAMETER + (1.0 - GUESSING_PARAMETER) * logistic
    derivative = (
        (1.0 - GUESSING_PARAMETER)
        * item.discrimination
        * logistic
        * (1.0 - logistic)
    )
    return derivative**2 / max(probability * (1.0 - probability), 1e-9)


def estimate_theta(responses: list[dict]) -> tuple[float, float]:
    """EAP ability estimate on a fixed grid with a standard normal prior."""
    grid = [-4.0 + index * 0.05 for index in range(161)]
    log_weights: list[float] = []
    for theta in grid:
        log_weight = -0.5 * theta**2
        for response in responses:
            probability = probability_correct(theta, ITEMS_BY_ID[response["item_id"]])
            probability = min(max(probability, 1e-9), 1.0 - 1e-9)
            log_weight += math.log(probability if response["correct"] else 1.0 - probability)
        log_weights.append(log_weight)
    maximum = max(log_weights)
    weights = [math.exp(value - maximum) for value in log_weights]
    total = sum(weights)
    mean = sum(theta * weight for theta, weight in zip(grid, weights, strict=True)) / total
    variance = sum(
        weight * (theta - mean) ** 2 for theta, weight in zip(grid, weights, strict=True)
    ) / total
    return max(-4.0, min(4.0, mean)), max(0.01, math.sqrt(variance))


def _none_item_schedule(session_id: str, max_items: int) -> list[bool]:
    none_count = max(2, round(max_items / 5))
    schedule = [True] * none_count + [False] * (max_items - none_count)
    random.Random(session_id).shuffle(schedule)
    return schedule


def select_next_item(
    session_id: str, theta: float, administered: list[str], max_items: int = MAX_ITEMS
) -> VocabularyItem:
    target_none = _none_item_schedule(session_id, max_items)[len(administered)]
    candidates = [
        item
        for item in VOCABULARY_ITEMS
        if item.id not in administered
        and (item.correct_index == NONE_OF_ABOVE_INDEX) is target_none
    ]
    if not candidates:
        candidates = [item for item in VOCABULARY_ITEMS if item.id not in administered]
    return max(candidates, key=lambda item: item_information(theta, item))


def _level_details(theta: float) -> tuple[str, str, str, str]:
    if theta < -1.8:
        return "A1 · 入门", "A1", "约 800–1,500", "优先巩固日常高频词和基础词义"
    if theta < -1.1:
        return "A2 · 基础", "A2", "约 1,500–2,500", "扩展生活场景词汇并减少形近词混淆"
    if theta < -0.4:
        return "B1 · 中级", "B1", "约 2,500–4,000", "加强常见学术主题词和语境辨义"
    if theta < 0.4:
        return "B2 · 中高级", "B2", "约 4,000–6,000", "重点积累阅读同义替换和写作搭配"
    if theta < 1.3:
        return "C1 · 高级", "C1", "约 6,000–9,000", "强化低频学术词、搭配和词义精度"
    return "C2 · 精通参考", "C2", "约 9,000+", "保持广度，并转向语域、搭配和主动运用"


def build_estimate(theta: float, standard_error: float, responses: list[dict]) -> VocabularyEstimate:
    correct = sum(response["correct"] for response in responses)
    none_responses = [
        response
        for response in responses
        if ITEMS_BY_ID[response["item_id"]].correct_index == NONE_OF_ABOVE_INDEX
    ]
    none_correct = sum(response["correct"] for response in none_responses)
    level, cefr, word_families, study_focus = _level_details(theta)
    return VocabularyEstimate(
        theta=round(theta, 3),
        standard_error=round(standard_error, 3),
        level=level,
        cefr_reference=cefr,
        estimated_word_families=word_families,
        meaning_accuracy=round(correct / len(responses), 3),
        none_of_above_accuracy=round(none_correct / max(1, len(none_responses)), 3),
        study_focus=study_focus,
    )


def _estimate_from_stored_result(result: dict) -> VocabularyEstimate:
    if "meaning_accuracy" in result:
        return VocabularyEstimate.model_validate(result)
    level, cefr, word_families, study_focus = _level_details(float(result.get("theta", 0)))
    return VocabularyEstimate(
        theta=result.get("theta", 0),
        standard_error=result.get("standard_error", 1),
        level=level,
        cefr_reference=cefr,
        estimated_word_families=word_families,
        meaning_accuracy=result.get("lexical_decision_accuracy", 0),
        none_of_above_accuracy=1 - result.get("false_alarm_rate", 0),
        study_focus=study_focus,
        calibration_status="legacy_lexical_decision_result",
        disclaimer=(
            "这是旧版二选一测评的兼容结果，CEFR 与词族范围仅作临时参考；"
            "请完成新版词义选择测评后再用于正式学习判断。"
        ),
    )


def vocabulary_test_from_row(row: VocabularyTestSessionRow) -> VocabularyTest:
    current_item = None
    if row.status == VocabularyTestStatus.in_progress.value and row.administered:
        item = ITEMS_BY_ID[row.administered[-1]]
        current_item = VocabularyItemPrompt(
            id=item.id,
            surface=item.surface,
            options=list(item.options),
            sequence=len(row.responses) + 1,
        )
    return VocabularyTest(
        id=row.id,
        status=row.status,
        current_item=current_item,
        answered=len(row.responses),
        max_items=MAX_ITEMS,
        theta=row.theta,
        standard_error=row.standard_error,
        result=_estimate_from_stored_result(row.result) if row.result else None,
        created_at=row.created_at,
    )


async def start_vocabulary_test(session: AsyncSession, user_id: str) -> VocabularyTest:
    test_id = str(uuid4())
    first = select_next_item(test_id, 0.0, [])
    row = VocabularyTestSessionRow(
        id=test_id,
        user_id=user_id,
        status=VocabularyTestStatus.in_progress.value,
        theta=0.0,
        standard_error=1.0,
        administered=[first.id],
        responses=[],
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return vocabulary_test_from_row(row)


async def get_vocabulary_test(
    session: AsyncSession, user_id: str, test_id: str
) -> VocabularyTestSessionRow:
    row = await session.scalar(
        select(VocabularyTestSessionRow).where(
            VocabularyTestSessionRow.id == test_id,
            VocabularyTestSessionRow.user_id == user_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Vocabulary test not found")
    return row


async def answer_vocabulary_item(
    session: AsyncSession,
    user_id: str,
    test_id: str,
    answer: VocabularyTestAnswer,
) -> VocabularyTest:
    row = await get_vocabulary_test(session, user_id, test_id)
    if row.status != VocabularyTestStatus.in_progress.value:
        raise HTTPException(status_code=409, detail="Vocabulary test is already completed")
    expected_item_id = row.administered[-1]
    if answer.item_id != expected_item_id:
        raise HTTPException(status_code=409, detail="Answer does not match the current item")

    item = ITEMS_BY_ID[answer.item_id]
    responses = [
        *row.responses,
        {
            "item_id": item.id,
            "selected_option": answer.selected_option,
            "correct": answer.selected_option == item.correct_index,
        },
    ]
    theta, standard_error = estimate_theta(responses)
    row.responses = responses
    row.theta = theta
    row.standard_error = standard_error

    should_stop = len(responses) >= MAX_ITEMS or (
        len(responses) >= MIN_ITEMS and standard_error <= STOPPING_STANDARD_ERROR
    )
    if should_stop:
        row.status = VocabularyTestStatus.completed.value
        row.result = build_estimate(theta, standard_error, responses).model_dump(mode="json")
        row.completed_at = datetime.now(UTC)
    else:
        next_item = select_next_item(row.id, theta, list(row.administered))
        row.administered = [*row.administered, next_item.id]
    await session.commit()
    await session.refresh(row)
    return vocabulary_test_from_row(row)
