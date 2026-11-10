from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.services.word_normalization import normalize_word


class VocabularyCandidate(BaseModel):
    word: str = Field(min_length=1, max_length=80)
    meaning: str = Field(min_length=1, max_length=1200)
    part_of_speech: str = Field(default="", max_length=60)
    reason: Literal["spelling", "usage", "accumulate"]
    original_form: str = Field(min_length=1, max_length=160)
    original_quote: str = Field(min_length=1, max_length=1000)
    explanation: str = Field(min_length=1, max_length=1200)
    example: str = Field(min_length=1, max_length=1000)

    @field_validator("word")
    @classmethod
    def normalize(cls, value: str) -> str:
        return normalize_word(value)


class VocabularyExtraction(BaseModel):
    words: list[VocabularyCandidate] = Field(max_length=12)


class ExtractionRequest(BaseModel):
    source_id: str = Field(min_length=1, max_length=100)
    source_kind: Literal["writing_version", "assessment"] = "writing_version"
    request_type: Literal["automatic", "requested"] = "requested"


class WordReview(BaseModel):
    word: str
    rating: Literal["again", "hard", "good"]
    revision: int = Field(ge=0)
    event_id: str = Field(min_length=1, max_length=80)

    @field_validator("word")
    @classmethod
    def normalize(cls, value: str) -> str:
        return normalize_word(value)


class WordEdit(BaseModel):
    word: str
    meaning: str | None = Field(default=None, min_length=1, max_length=1200)
    example: str | None = Field(default=None, max_length=1000)
    note: str | None = Field(default=None, max_length=2000)
    suspended: bool | None = None

    @field_validator("word")
    @classmethod
    def normalize(cls, value: str) -> str:
        return normalize_word(value)
