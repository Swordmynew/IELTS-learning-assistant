from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
from functools import lru_cache
from pathlib import Path

from app.config import Settings

VECTOR_DIMENSIONS = 384
logger = logging.getLogger(__name__)


def hashing_embedding(text: str, dimensions: int = VECTOR_DIMENSIONS) -> list[float]:
    """Stable local fallback for demos and tests; not presented as a semantic model."""
    vector = [0.0] * dimensions
    tokens = re.findall(r"[a-zA-Z]{2,}|[\u4e00-\u9fff]", text.lower())
    for token in tokens:
        digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
        index = int.from_bytes(digest, "big") % dimensions
        vector[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


async def embed_text(text: str, settings: Settings) -> tuple[list[float], str]:
    if settings.embedding_provider == "hashing":
        return hashing_embedding(text), "hashing-demo-fallback"

    if settings.embedding_provider in {"fastembed", "local"}:
        try:
            vector = await asyncio.to_thread(
                _fastembed_vector,
                text,
                settings.local_embedding_model,
                settings.fastembed_cache_path,
            )
            return vector, settings.local_embedding_model
        except Exception as error:
            if settings.local_embedding_strict:
                raise RuntimeError("Local semantic embedding failed") from error
            logger.warning(
                "Local semantic embedding unavailable; using the non-semantic hashing fallback: %s",
                error,
            )
            return hashing_embedding(text), "hashing-demo-fallback"

    from openai import AsyncOpenAI

    api_key = settings.embedding_api_key
    base_url = settings.embedding_base_url
    if settings.embedding_provider == "auto" and not api_key:
        if settings.openai_base_url:
            try:
                vector = await asyncio.to_thread(
                    _fastembed_vector,
                    text,
                    settings.local_embedding_model,
                    settings.fastembed_cache_path,
                )
                return vector, settings.local_embedding_model
            except Exception as error:
                logger.warning(
                    "Automatic local embedding unavailable; using hashing fallback: %s", error
                )
                return hashing_embedding(text), "hashing-demo-fallback"
        api_key = settings.openai_api_key
    if not api_key:
        return hashing_embedding(text), "hashing-demo-fallback"
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    response = await client.embeddings.create(
        model=settings.openai_embedding_model,
        input=text,
        dimensions=VECTOR_DIMENSIONS,
    )
    vector = response.data[0].embedding
    _validate_dimensions(vector, settings.openai_embedding_model)
    return vector, settings.openai_embedding_model


@lru_cache(maxsize=4)
def _load_fastembed_model(model_name: str, cache_path: str):
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=model_name, cache_dir=cache_path)


def _fastembed_vector(text: str, model_name: str, cache_path: Path) -> list[float]:
    model = _load_fastembed_model(model_name, str(cache_path.resolve()))
    vector = list(next(iter(model.embed([text]))))
    _validate_dimensions(vector, model_name)
    return vector


def _validate_dimensions(vector: list[float], model_name: str) -> None:
    if len(vector) != VECTOR_DIMENSIONS:
        raise ValueError(
            f"Embedding model {model_name!r} returned {len(vector)} dimensions; "
            f"the database requires {VECTOR_DIMENSIONS}."
        )
