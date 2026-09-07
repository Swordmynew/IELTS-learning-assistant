from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.rag import OFFICIAL_RUBRIC_SUMMARIES, keyword_rank  # noqa: E402


def main() -> None:
    dataset = [
        json.loads(line)
        for line in (ROOT / "evals" / "retrieval_gold.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    hits = 0
    reciprocal_rank = 0.0
    for item in dataset:
        ranked = keyword_rank(item["query"], OFFICIAL_RUBRIC_SUMMARIES)
        identifiers = [hit.chunk_id for hit in ranked[:5]]
        expected = set(item["expected_chunk_ids"])
        hits += int(bool(expected.intersection(identifiers)))
        ranks = [index + 1 for index, identifier in enumerate(identifiers) if identifier in expected]
        reciprocal_rank += 1 / min(ranks) if ranks else 0
    total = len(dataset)
    print(json.dumps({"queries": total, "recall_at_5": hits / total, "mrr": reciprocal_rank / total}, indent=2))


if __name__ == "__main__":
    main()

