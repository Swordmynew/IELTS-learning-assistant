from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from collections import Counter
from copy import deepcopy

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.schemas import (
    BandScore,
    Citation,
    CriterionAssessment,
    CriterionName,
    EvidenceSpan,
    WritingAssessment,
    WritingSubmission,
)
from app.services.rag import retrieve_official_rubric


def round_band(value: float) -> float:
    return max(0.0, min(9.0, round(value * 2) / 2))


def _sentences(text: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]


def _evidence(text: str, sentence: str) -> EvidenceSpan:
    start = max(0, text.find(sentence))
    return EvidenceSpan(quote=sentence[:240], start=start, end=start + min(len(sentence), 240))


def portable_json_schema(schema: dict) -> dict:
    """Normalize Pydantic JSON Schema for OpenAI-compatible providers.

    Some compatible endpoints reject annotation-only formats such as `date-time`.
    They are unnecessary here because Pydantic validates the returned payload again.
    """
    normalized = deepcopy(schema)

    def visit(node: object) -> None:
        if isinstance(node, dict):
            node.pop("format", None)
            if node.get("type") == "object" and "properties" in node:
                node.setdefault("additionalProperties", False)
                node["required"] = list(node["properties"])
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(normalized)
    return normalized


def normalize_assessment(
    assessment: WritingAssessment, essay: str, citations: list[Citation]
) -> WritingAssessment:
    """Bind generated judgments to deterministic scores, offsets and retrieved sources."""
    citation_by_criterion = {
        CriterionName.task_achievement: citations[0],
        CriterionName.coherence_cohesion: citations[1],
        CriterionName.lexical_resource: citations[2],
        CriterionName.grammar_accuracy: citations[3],
    }
    normalized_criteria = []
    for criterion in assessment.criteria:
        evidence = []
        for span in criterion.evidence:
            start = essay.find(span.quote)
            evidence.append(
                span.model_copy(
                    update={"start": start, "end": start + len(span.quote)}
                )
                if start >= 0
                else span
            )
        normalized_criteria.append(
            criterion.model_copy(
                update={
                    "evidence": evidence,
                    "citations": [citation_by_criterion[criterion.criterion]],
                }
            )
        )
    overall = round_band(
        sum(item.band for item in normalized_criteria) / max(1, len(normalized_criteria))
    )
    return assessment.model_copy(
        update={"criteria": normalized_criteria, "estimated_overall_band": overall}
    )


class _ModelCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    url: str | None
    page: int | None
    excerpt: str
    score: float = Field(ge=0, le=1)


class _ModelEvidenceSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quote: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class _ModelCriterionAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion: CriterionName
    band: BandScore
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[_ModelEvidenceSpan]
    citations: list[_ModelCitation]


class _ModelWritingAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estimated_overall_band: BandScore
    criteria: list[_ModelCriterionAssessment]
    top_priorities: list[str] = Field(min_length=1, max_length=3)
    rewrite_example: str
    next_exercise: str
    disclaimer: str


class WritingGrader(ABC):
    @abstractmethod
    async def grade(self, submission: WritingSubmission) -> WritingAssessment: ...


class DeterministicWritingGrader(WritingGrader):
    """An honest, offline demo baseline. It never pretends to be an examiner."""

    async def grade(self, submission: WritingSubmission) -> WritingAssessment:
        essay = submission.essay.strip()
        words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", essay)
        sentences = _sentences(essay) or [essay]
        paragraphs = [item.strip() for item in re.split(r"\n\s*\n", essay) if item.strip()]
        lowered = [word.lower() for word in words]
        diversity = len(set(lowered)) / max(1, len(lowered))
        connectors = sum(
            lowered.count(item)
            for item in ("however", "therefore", "moreover", "although", "because", "while")
        )
        repeated = Counter(lowered).most_common(1)[0][1] / max(1, len(lowered)) if lowered else 1
        target_words = 250 if submission.task_type.value.endswith("2") else 150

        task_band = 5.0 + min(1.5, len(words) / target_words) - (0.75 if len(words) < target_words else 0)
        coherence_band = 5.0 + min(1.0, len(paragraphs) / 4) + min(0.5, connectors / 4)
        lexical_band = 4.5 + min(2.0, diversity * 3) - (0.5 if repeated > 0.08 else 0)
        avg_sentence = len(words) / max(1, len(sentences))
        grammar_band = 5.0 + (0.5 if 10 <= avg_sentence <= 28 else 0) + (0.5 if len(sentences) >= 6 else 0)
        bands = {
            CriterionName.task_achievement: round_band(task_band),
            CriterionName.coherence_cohesion: round_band(coherence_band),
            CriterionName.lexical_resource: round_band(lexical_band),
            CriterionName.grammar_accuracy: round_band(grammar_band),
        }
        citations = retrieve_official_rubric("writing task response coherence lexical grammar")
        first = sentences[0]
        longest = max(sentences, key=len)
        criteria = [
            CriterionAssessment(
                criterion=name,
                band=band,
                confidence=0.45,
                explanation=(
                    "离线规则基线根据字数、段落、连接表达、词汇多样性和句长生成；"
                    "配置模型 API 后会替换为基于官方量表的结构化语义评估。"
                ),
                evidence=[_evidence(essay, first if index % 2 == 0 else longest)],
                citations=[citations[index]],
            )
            for index, (name, band) in enumerate(bands.items())
        ]
        overall = round_band(sum(bands.values()) / 4)
        priorities = []
        if len(words) < target_words:
            priorities.append(f"将正文扩展到至少 {target_words} 词，并完整回应题目要求")
        if len(paragraphs) < 4:
            priorities.append("使用清晰的四段结构，每段只承担一个主要功能")
        if connectors < 2:
            priorities.append("补充自然的逻辑连接，但避免机械堆叠连接词")
        if diversity < 0.45:
            priorities.append("减少高频词重复，优先改进准确搭配而非生僻词")
        priorities = (priorities + ["逐句检查主谓一致、冠词和标点"])[0:3]
        return WritingAssessment(
            estimated_overall_band=overall,
            criteria=criteria,
            top_priorities=priorities,
            rewrite_example=f"原句：{first[:160]}\n建议：先明确本段中心观点，再补充原因与具体例证。",
            next_exercise="用 10 分钟重写得分最低维度对应的一个正文段，并标注主题句与支持句。",
            model_used="deterministic-demo-baseline",
        )


class OpenAIWritingGrader(WritingGrader):
    def __init__(self, settings: Settings) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout=settings.model_timeout_seconds,
            max_retries=1,
        )
        self.model = settings.openai_model
        self.reasoning_effort = settings.openai_reasoning_effort
        self.max_output_tokens = settings.openai_max_output_tokens

    async def grade(self, submission: WritingSubmission) -> WritingAssessment:
        citations = retrieve_official_rubric("writing task response coherence lexical grammar")
        schema = portable_json_schema(_ModelWritingAssessment.model_json_schema())
        prompt = (
            "You are an IELTS Academic writing feedback assistant, not an official examiner. "
            "Assess the essay against the supplied rubric summaries. Every criterion must quote "
            "an exact span from the essay and cite at least one supplied source. Return Chinese feedback.\n\n"
            f"Task type: {submission.task_type.value}\nPrompt: {submission.prompt}\nEssay:\n{submission.essay}\n\n"
            f"Rubric evidence:\n{json.dumps([item.model_dump() for item in citations], ensure_ascii=False)}"
        )
        response = await self.client.responses.create(
            model=self.model,
            instructions="Return only schema-valid data. Do not claim the result is an official IELTS score.",
            input=prompt,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "writing_assessment",
                    "strict": True,
                    "schema": schema,
                }
            },
            reasoning={"effort": self.reasoning_effort},
            max_output_tokens=self.max_output_tokens,
            store=False,
        )
        if not response.output_text:
            usage = response.usage
            raise RuntimeError(
                "Model returned no structured output "
                f"(status={response.status}, input_tokens={getattr(usage, 'input_tokens', None)}, "
                f"output_tokens={getattr(usage, 'output_tokens', None)})"
            )
        payload = _ModelWritingAssessment.model_validate_json(response.output_text)
        assessment = WritingAssessment.model_validate(
            {**payload.model_dump(mode="json"), "model_used": self.model}
        )
        return normalize_assessment(assessment, submission.essay, citations)


def get_writing_grader(settings: Settings) -> WritingGrader:
    if settings.openai_api_key and settings.llm_provider in {"openai", "openai_compatible"}:
        return OpenAIWritingGrader(settings)
    return DeterministicWritingGrader()


def validate_assessment(assessment: WritingAssessment, essay: str) -> list[str]:
    errors: list[str] = []
    expected = set(CriterionName)
    actual = {item.criterion for item in assessment.criteria}
    if actual != expected:
        errors.append("assessment must include exactly four IELTS writing criteria")
    calculated = round_band(sum(item.band for item in assessment.criteria) / max(1, len(assessment.criteria)))
    if assessment.estimated_overall_band != calculated:
        errors.append("overall band must be the rounded mean of criterion bands")
    for criterion in assessment.criteria:
        for evidence in criterion.evidence:
            if essay[evidence.start : evidence.end] != evidence.quote:
                errors.append(f"invalid evidence span for {criterion.criterion.value}")
        if not criterion.citations:
            errors.append(f"missing citation for {criterion.criterion.value}")
    return errors
