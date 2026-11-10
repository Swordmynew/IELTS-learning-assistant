from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas import Citation, WritingAssessment


class KnowledgeEdit(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=8000)


class KnowledgeMerge(BaseModel):
    source_ids: list[str] = Field(min_length=1, max_length=20)


class SessionCreate(BaseModel):
    prompt: str = Field(min_length=20, max_length=4000)


class VersionCreate(BaseModel):
    essay: str = Field(min_length=20, max_length=20000)


class CoachQuestion(BaseModel):
    query: str = Field(min_length=2, max_length=2000)


class Issue(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    criterion: Literal[
        "task_achievement", "coherence_cohesion", "lexical_resource", "grammar_accuracy"
    ]
    quote: str = Field(min_length=1)
    explanation: str
    goal: str
    source_ids: list[str] = Field(min_length=1)


class Improvement(BaseModel):
    issue_id: str
    status: Literal["improved", "partial", "remaining"]
    old_quote: str = Field(min_length=1)
    new_quote: str = Field(min_length=1)
    explanation: str


class CoachAssessment(WritingAssessment):
    rewrite_example: str = ""
    next_exercise: str = "根据问题卡片修改，再提交复评。"
    model_used: str = "pending"


class Feedback(BaseModel):
    assessment: CoachAssessment
    issues: list[Issue] = Field(min_length=1, max_length=3)
    improvements: list[Improvement] = Field(default_factory=list)
    personal_note: str = ""
    personal_source_ids: list[str] = Field(default_factory=list)

    @field_validator("assessment", mode="before")
    @classmethod
    def recalculate_mean(cls, value):
        if isinstance(value, dict) and value.get("criteria"):
            bands = [item.get("band") for item in value["criteria"] if isinstance(item, dict)]
            if len(bands) == 4 and all(isinstance(band, (float, int)) for band in bands):
                from app.services.writing import round_band

                value = {**value, "estimated_overall_band": round_band(sum(bands) / 4)}
        return value


class TutorAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=12000)
    source_ids: list[str] = Field(default_factory=list)
    sufficient: bool


class Hint(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class GeneratedResult(BaseModel):
    mode: Literal["live", "cache", "offline", "demo"]
    generated_at: str
    data: dict
    model: str
    citations: list[Citation] = Field(default_factory=list)
