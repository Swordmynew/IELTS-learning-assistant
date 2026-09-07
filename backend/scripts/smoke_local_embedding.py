"""Download/load the local model and verify a simple Chinese-to-English retrieval case."""

from __future__ import annotations

import asyncio
import math

from app.config import get_settings
from app.services.embeddings import embed_text


def cosine(left: list[float], right: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    denominator = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return numerator / denominator


async def main() -> None:
    settings = get_settings()
    query, query_model = await embed_text("雅思写作怎样提高连贯与衔接？", settings)
    relevant, relevant_model = await embed_text(
        "Coherence and Cohesion evaluates logical organisation and the use of cohesive devices.",
        settings,
    )
    irrelevant, _ = await embed_text(
        "Listening answers must be transferred carefully to the answer sheet.", settings
    )
    relevant_score = cosine(query, relevant)
    irrelevant_score = cosine(query, irrelevant)

    if "hashing-demo-fallback" in {query_model, relevant_model}:
        raise RuntimeError("FastEmbed was unavailable and the smoke test fell back to hashing")
    if relevant_score <= irrelevant_score:
        raise AssertionError("The relevant writing passage did not outrank the listening passage")
    print(f"model {query_model}")
    print(f"dimensions {len(query)}")
    print(f"relevant_cosine {relevant_score:.4f}")
    print(f"irrelevant_cosine {irrelevant_score:.4f}")
    print("cross_lingual_ranking_valid True")


if __name__ == "__main__":
    asyncio.run(main())
