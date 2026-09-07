import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(PROJECT_ENV_FILE, ".env"), extra="ignore")

    app_env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "sqlite+aiosqlite:///./ielts_coach.db"
    jwt_secret: str = "local-development-secret-change-me-please"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480
    cors_origins: str = "http://localhost:3000"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str = "gpt-5.4-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_reasoning_effort: str = "low"
    openai_max_output_tokens: int = Field(default=2500, ge=256, le=16000)
    model_timeout_seconds: float = Field(default=60, ge=5, le=300)
    llm_provider: str = "openai"
    embedding_provider: str = "auto"
    embedding_api_key: str | None = None
    embedding_base_url: str | None = None
    local_embedding_model: str = (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    fastembed_cache_path: Path = Path(".cache/fastembed")
    huggingface_cache_path: Path = Path(".cache/huggingface")
    local_embedding_strict: bool = False
    redis_url: str = "redis://localhost:6379/0"
    upload_dir: Path = Path("uploads")
    max_upload_mb: int = Field(default=10, ge=1, le=50)

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    os.environ.setdefault("HF_HOME", str(settings.huggingface_cache_path.resolve()))
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    return settings
