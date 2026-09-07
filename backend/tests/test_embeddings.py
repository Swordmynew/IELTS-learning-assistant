from pathlib import Path

import pytest

from app.config import Settings
from app.services import embeddings


def test_hashing_embedding_has_database_dimensions() -> None:
    vector = embeddings.hashing_embedding("coherence cohesion 连贯")
    assert len(vector) == embeddings.VECTOR_DIMENSIONS
    assert sum(value * value for value in vector) == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_fastembed_provider_uses_local_model(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = [0.25] * embeddings.VECTOR_DIMENSIONS

    def fake_vector(text: str, model: str, cache: Path) -> list[float]:
        assert text == "写作连贯性"
        assert model.endswith("paraphrase-multilingual-MiniLM-L12-v2")
        assert cache == Path("test-cache")
        return expected

    monkeypatch.setattr(embeddings, "_fastembed_vector", fake_vector)
    settings = Settings(
        embedding_provider="fastembed",
        fastembed_cache_path=Path("test-cache"),
    )
    vector, model = await embeddings.embed_text("写作连贯性", settings)

    assert vector == expected
    assert model == settings.local_embedding_model


def test_dimension_mismatch_is_rejected() -> None:
    with pytest.raises(ValueError, match="database requires 384"):
        embeddings._validate_dimensions([0.0] * 10, "wrong-model")
