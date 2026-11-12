from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl, field_validator

from app.schemas import Citation, WritingAssessment


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=8000)
    note: str = Field(default="", max_length=8000)
    module: Literal["writing", "reading", "listening", "speaking", "vocabulary", "general"] = "general"
    topic_tags: list[str] = Field(default_factory=list, max_length=20)
    related_ids: list[UUID] = Field(default_factory=list, max_length=20)
    source_url: HttpUrl | None = None
    request_id: UUID = Field(default_factory=uuid4)

    @field_validator("title", "content")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Text must not be blank")
        return value.strip()

    @field_validator("topic_tags")
    @classmethod
    def topics(cls, values):
        if any(len(value) > 64 for value in values):
            raise ValueError("Topic tags must be at most 64 characters")
        from app.services.learning_memory import normalize_topics
        return normalize_topics(values)


class KnowledgeEdit(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    note: str | None = Field(default=None, max_length=8000)
    topic_tags: list[str] | None = Field(default=None, max_length=20)
    related_ids: list[UUID] | None = Field(default=None, max_length=20)
    source_url: HttpUrl | None = None

    @field_validator("title", "content")
    @classmethod
    def nonblank(cls, value):
        return KnowledgeCreate.nonblank(value) if value is not None else value

    @field_validator("topic_tags")
    @classmethod
    def topics(cls, values):
        return KnowledgeCreate.topics(values) if values is not None else values


class KnowledgeBookmark(BaseModel):
    source_type: Literal["question", "writing_version", "conversation", "document"]
    source_id: str = Field(min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_-]+$")
    chunk_id: str | None = Field(default=None, min_length=1, max_length=200, pattern=r"^[a-zA-Z0-9_-]+$")
    message_index: int | None = Field(default=None, ge=0)
    excerpt: str | None = Field(default=None, min_length=1, max_length=8000)
    title: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=8000)
    topic_tags: list[str] = Field(default_factory=list, max_length=20)
    related_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("topic_tags")
    @classmethod
    def topics(cls, values):
        return KnowledgeCreate.topics(values)


class KnowledgeReview(BaseModel):
    outcome: Literal["review", "improved"]
    note: str = Field(default="", max_length=4000)
    request_id: UUID = Field(default_factory=uuid4)


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
