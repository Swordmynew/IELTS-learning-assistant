from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from app.config import get_settings


def learning_today(now: datetime | None = None):
    instant = now or datetime.now(UTC)
    if instant.tzinfo is None:
        raise ValueError("Learning date requires a timezone-aware instant")
    return instant.astimezone(ZoneInfo(get_settings().learning_timezone)).date()
