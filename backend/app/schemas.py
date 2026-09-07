from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, model_validator

BandScore = Annotated[float, Field(ge=0, le=9, multiple_of=0.5)]


def utc_now() -> datetime:
    return datetime.now(UTC)


class Skill(StrEnum):
    listening = "listening"
    reading = "reading"
    writing = "writing"
    speaking = "speaking"


class TaskType(StrEnum):
    writing_task_1 = "writing_task_1"
    writing_task_2 = "writing_task_2"
    reading_drill = "reading_drill"
    listening_drill = "listening_drill"
    speaking_reflection = "speaking_reflection"
    review = "review"
    vocabulary_assessment = "vocabulary_assessment"
    vocabulary_review = "vocabulary_review"


class PlanStatus(StrEnum):
    draft = "draft"
    approved = "approved"
    superseded = "superseded"


class VocabularyTestStatus(StrEnum):
    in_progress = "in_progress"
    completed = "completed"


class LearnerProfileCreate(BaseModel):
    exam_date: date
    current_scores: dict[Skill, BandScore]
    target_scores: dict[Skill, BandScore]
    minutes_by_weekday: dict[int, int] = Field(
        description="ISO weekday (1=Monday, 7=Sunday) to available minutes"
    )
    preferred_skills: list[Skill] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_profile(self) -> LearnerProfileCreate:
        if self.exam_date <= date.today():
            raise ValueError("exam_date must be in the future")
        if set(self.current_scores) != set(Skill) or set(self.target_scores) != set(Skill):
            raise ValueError("scores must include listening, reading, writing and speaking")
        if not self.minutes_by_weekday or any(day not in range(1, 8) for day in self.minutes_by_weekday):
            raise ValueError("minutes_by_weekday keys must be ISO weekdays 1 through 7")
        if any(minutes < 0 or minutes > 360 for minutes in self.minutes_by_weekday.values()):
            raise ValueError("daily availability must be between 0 and 360 minutes")
        return self


class SkillEstimate(BaseModel):
    skill: Skill
    band: BandScore
    confidence: float = Field(ge=0, le=1)
    recent_error_rate: float = Field(default=0.5, ge=0, le=1)
    days_since_practice: int = Field(default=7, ge=0)


class DiagnosticRequest(LearnerProfileCreate):
    estimates: list[SkillEstimate] = Field(default_factory=list)


class StudyTask(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    scheduled_date: date
    skill: Skill | Literal["vocabulary"]
    task_type: TaskType
    title: str
    objective: str
    duration_minutes: int = Field(ge=10, le=180)
    priority: float = Field(ge=0, le=1)
    high_load: bool = False
    completed: bool = False


class StudyPlan(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    status: PlanStatus = PlanStatus.draft
    starts_on: date
    ends_on: date
    rationale: str
    tasks: list[StudyTask]
    conflicts: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


class PlanApproval(BaseModel):
    approved: bool


class Citation(BaseModel):
    source_id: str
    title: str
    url: str | None = None
    page: int | None = None
    excerpt: str
    score: float = Field(default=1.0, ge=0, le=1)


class EvidenceSpan(BaseModel):
    quote: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_span(self) -> EvidenceSpan:
        if self.end <= self.start:
            raise ValueError("evidence end must be greater than start")
        return self


class CriterionName(StrEnum):
    task_achievement = "task_achievement"
    coherence_cohesion = "coherence_cohesion"
    lexical_resource = "lexical_resource"
    grammar_accuracy = "grammar_accuracy"


class CriterionAssessment(BaseModel):
    criterion: CriterionName
    band: BandScore
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[EvidenceSpan]
    citations: list[Citation]


class WritingSubmission(BaseModel):
    task_type: TaskType
    prompt: str = Field(min_length=20, max_length=4000)
    essay: str = Field(min_length=20, max_length=20000)

    @model_validator(mode="after")
    def only_writing_tasks(self) -> WritingSubmission:
        if self.task_type not in {TaskType.writing_task_1, TaskType.writing_task_2}:
            raise ValueError("task_type must be writing_task_1 or writing_task_2")
        return self


class WritingAssessment(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    estimated_overall_band: BandScore
    criteria: list[CriterionAssessment]
    top_priorities: list[str] = Field(min_length=1, max_length=3)
    rewrite_example: str
    next_exercise: str
    disclaimer: str = "AI 估分仅用于学习反馈，不代表 IELTS 官方成绩。"
    model_used: str
    created_at: datetime = Field(default_factory=utc_now)


class VocabularyItemPrompt(BaseModel):
    id: str
    surface: str
    options: list[str] = Field(min_length=4, max_length=4)
    sequence: int = Field(ge=1)


class VocabularyTestAnswer(BaseModel):
    item_id: str
    selected_option: int = Field(ge=0, le=4)


class VocabularyEstimate(BaseModel):
    theta: float = Field(ge=-4, le=4)
    standard_error: float = Field(gt=0)
    level: str
    cefr_reference: str = Field(pattern=r"^(A1|A2|B1|B2|C1|C2)$")
    estimated_word_families: str
    meaning_accuracy: float = Field(ge=0, le=1)
    none_of_above_accuracy: float = Field(ge=0, le=1)
    study_focus: str
    calibration_status: str = "prototype_multiple_choice_parameters"
    disclaimer: str = (
        "实验性接受性词汇估计：CEFR 层级与词族区间不是官方换算，"
        "题目参数仍需真实考生样本标定，不能替代标准化测试或 IELTS 成绩。"
    )


class VocabularyTest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    status: VocabularyTestStatus = VocabularyTestStatus.in_progress
    current_item: VocabularyItemPrompt | None = None
    answered: int = Field(default=0, ge=0)
    max_items: int = Field(default=20, ge=10, le=40)
    theta: float = Field(default=0, ge=-4, le=4)
    standard_error: float = Field(default=1, gt=0)
    result: VocabularyEstimate | None = None
    created_at: datetime = Field(default_factory=utc_now)


class AuthCredentials(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(AuthCredentials):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)


class UserPreferences(BaseModel):
    default_start_page: str = Field(default="overview", pattern=r"^(overview|plan|question-bank)$")
    listening_rate: float = Field(default=0.92, ge=0.75, le=1.1)
    compact_question_options: bool = True
    show_learning_details: bool = False


class UserAccount(BaseModel):
    id: UUID
    email: str
    display_name: str | None = None
    demo: bool = False
    created_at: datetime
    preferences: UserPreferences = Field(default_factory=UserPreferences)


class UserAccountUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @model_validator(mode="after")
    def passwords_must_differ(self) -> PasswordChange:
        if self.current_password == self.new_password:
            raise ValueError("new password must differ from current password")
        return self


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: UUID
    demo: bool = False


class DashboardSummary(BaseModel):
    profile: LearnerProfileCreate | None
    active_plan: StudyPlan | None
    completed_tasks: int
    total_tasks: int
    latest_assessment: WritingAssessment | None
    latest_vocabulary_test: VocabularyTest | None = None


class RagQuery(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    module: Skill | None = None
    task_type: TaskType | None = None
    limit: int = Field(default=6, ge=1, le=10)


class RagAnswer(BaseModel):
    query: str
    answer: str
    citations: list[Citation]
    retrieval_mode: str


class KnowledgeDocumentSummary(BaseModel):
    id: str
    title: str
    filename: str
    source_url: str | None = None
    license_type: str
    status: str
    error: str | None = None
    is_private: bool
    created_at: datetime


class QuestionImportItem(BaseModel):
    module: Skill
    task_type: str = Field(min_length=2, max_length=64)
    question_type: str = Field(default="open_response", min_length=2, max_length=64)
    prompt: str = Field(min_length=5, max_length=10000)
    passage: str | None = Field(default=None, max_length=30000)
    options: list[str] = Field(default_factory=list, max_length=12)
    correct_answer: str | None = Field(default=None, max_length=10000)
    explanation: str | None = Field(default=None, max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    source_name: str = Field(default="user import", min_length=1, max_length=500)


class PracticeQuestion(QuestionImportItem):
    id: str
    is_public: bool
    created_at: datetime


class PracticeQuestionPreview(BaseModel):
    id: str
    module: Skill
    task_type: str
    question_type: str
    prompt: str
    passage: str | None = None
    options: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    source_name: str
    is_public: bool
    has_answer: bool
    last_attempt_correct: bool | None = None
    created_at: datetime


class PracticeQuestionPage(BaseModel):
    items: list[PracticeQuestionPreview]
    total: int
    page: int
    page_size: int


class QuestionAttemptCreate(BaseModel):
    answer: str = Field(min_length=1, max_length=10000)


class QuestionAttemptResult(BaseModel):
    question_id: str
    submitted_answer: str
    is_correct: bool
    correct_answer: str
    explanation: str | None = None
    attempt_number: int = Field(ge=1)
    profile_updated: bool = False


class ModulePracticeProgress(BaseModel):
    attempted: int = 0
    correct: int = 0


class QuestionBankProgress(BaseModel):
    total_questions: int = 0
    attempted_questions: int = 0
    correct_questions: int = 0
    incorrect_questions: int = 0
    accuracy: float = Field(default=0, ge=0, le=1)
    by_module: dict[Skill, ModulePracticeProgress] = Field(default_factory=dict)


class QuestionImportResult(BaseModel):
    imported: int
    ids: list[str]
