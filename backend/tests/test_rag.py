from app.services.rag import SearchHit, reciprocal_rank_fusion
from app.services.search_repository import _cosine


def hit(identifier: str) -> SearchHit:
    return SearchHit(identifier, identifier, f"content {identifier}", None, None, 1)


def test_rrf_rewards_results_present_in_both_rankings() -> None:
    fused = reciprocal_rank_fusion([[hit("a"), hit("b")], [hit("b"), hit("c")]])
    assert fused[0].chunk_id == "b"
    assert fused[0].score == 1


def test_rrf_respects_limit() -> None:
    fused = reciprocal_rank_fusion([[hit("a"), hit("b"), hit("c")]], limit=2)
    assert [item.chunk_id for item in fused] == ["a", "b"]


def test_cosine_rejects_stale_embedding_dimensions() -> None:
    assert _cosine([1.0, 0.0], [1.0]) == 0.0
