"""Synthetic learning scenarios; no live providers or learner records are used."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.schemas import WritingSubmission
from app.services.writing import DeterministicWritingGrader

PROMPT = "Should university tuition be free for everyone? Discuss your opinion."
ESSAY = "Education is good for everyone. However, it helps poor students. Governments should pay all the costs."
REVISION = "Education can improve social mobility. For example, targeted grants help low-income students qualify as teachers. Governments should prioritise these students because public funding is limited."


class FakeModel:
    last_request = None
    unavailable = False
    invalid = False
    calls = 0
    invalid_once = False

    def __init__(self, **kwargs):
        self.chat = SimpleNamespace(completions=self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def create(self, **kwargs):
        type(self).calls += 1
        type(self).last_request = kwargs
        if self.unavailable:
            raise TimeoutError("Synthetic provider outage")
        context = json.loads(kwargs["messages"][1]["content"])
        if self.invalid or (self.invalid_once and self.calls == 1):
            data = {"answer": "invalid output for this schema"}
        elif "public_rubric" in context:
            essay = context["essay"]
            assessment = await DeterministicWritingGrader().grade(
                WritingSubmission(task_type="writing_task_2", prompt=context["prompt"], essay=essay)
            )
            data = {
                "assessment": assessment.model_dump(mode="json"),
                "issues": [
                    {
                        "id": "logic",
                        "criterion": "coherence_cohesion",
                        "quote": essay.split(". ")[0],
                        "explanation": "检查句子之间的关系。",
                        "goal": "让论据支持观点。",
                        "source_ids": [context["public_rubric"][0]["source_id"]],
                    }
                ],
                "improvements": [],
                "personal_note": "",
                "personal_source_ids": [],
            }
            if context["previous"]:
                data["improvements"] = [
                    {
                        "issue_id": issue["id"],
                        "status": "improved",
                        "old_quote": issue["quote"],
                        "new_quote": essay.split(". ")[0],
                        "explanation": "修改稿增加了具体受益群体和例子。",
                    }
                    for issue in context["previous"]["issues"]
                ]
        elif "level" in context:
            data = {"text": "这两句话之间是什么逻辑关系？"}
        else:
            sources = context.get("sources", [])
            data = {
                "answer": "结合已有记录，先检查 however 是否表达真实转折。",
                "source_ids": [sources[0]["source_id"]] if sources else [],
                "sufficient": bool(sources),
            }
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(data)))],
            usage=SimpleNamespace(total_tokens=100),
        )


@pytest.fixture
def fake_model(monkeypatch):
    monkeypatch.setattr("openai.AsyncOpenAI", FakeModel)
    settings = get_settings()
    monkeypatch.setattr(settings, "coach_api_key", "synthetic-key")
    monkeypatch.setattr(settings, "coach_offline", False)
    monkeypatch.setattr(FakeModel, "unavailable", False)
    monkeypatch.setattr(FakeModel, "invalid", False)
    monkeypatch.setattr(FakeModel, "calls", 0)
    monkeypatch.setattr(FakeModel, "invalid_once", False)
    return FakeModel


def register(client):
    result = client.post(
        "/api/v1/auth/register",
        json={"email": f"{uuid4()}@example.com", "password": "SyntheticPassword123"},
    )
    assert result.status_code == 201
    return {"Authorization": f"Bearer {result.json()['access_token']}"}


def create_version(client, headers, essay=ESSAY, writing=None):
    if not writing:
        writing = client.post(
            "/api/v1/writing/sessions", json={"prompt": PROMPT}, headers=headers
        ).json()["id"]
    response = client.post(
        f"/api/v1/writing/sessions/{writing}/versions", json={"essay": essay}, headers=headers
    )
    assert response.status_code == 201
    return writing, response.json()["id"]


def test_writing_revision_retains_versions_and_tracks_issue_resolution(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        writing, first = create_version(client, headers)
        initial = client.post(f"/api/v1/writing/versions/{first}/assess", headers=headers)
        assert initial.status_code == 200
        assert initial.json()["feedback"]["mode"] == "live"
        _, second = create_version(client, headers, REVISION, writing)
        revision = client.post(f"/api/v1/writing/versions/{second}/assess", headers=headers)
        assert revision.json()["feedback"]["data"]["improvements"][0]["status"] == "improved"
        assert (
            len(
                client.get(f"/api/v1/writing/sessions/{writing}", headers=headers).json()[
                    "versions"
                ]
            )
            == 2
        )
        notes = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert len(notes) == 2
        assert all("pending" not in note and "confirmed" not in note for note in notes)
        assert any(note["status"] == "improved" for note in notes)
        calls = fake_model.calls
        client.post(f"/api/v1/writing/versions/{second}/assess", headers=headers)
        assert fake_model.calls == calls


def test_hints_cache_and_failed_submission_is_preserved(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        writing, version = create_version(client, headers)
        client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers)
        endpoint = f"/api/v1/writing/versions/{version}/issues/logic/hints/1"
        assert client.post(endpoint, headers=headers).json()["mode"] == "live"
        fake_model.unavailable = True
        assert client.post(endpoint, headers=headers).json()["mode"] == "cache"
        _, next_version = create_version(client, headers, REVISION, writing)
        unavailable = client.post(
            f"/api/v1/writing/versions/{next_version}/assess", headers=headers
        ).json()
        assert unavailable["status"] == "unavailable" and unavailable["feedback"] is None
        assert unavailable["essay"] == REVISION
        before = client.get("/api/v1/knowledge/items", headers=headers).json()
        demo = client.get("/api/v1/coach/demo", headers=headers).json()
        assert demo["mode"] == "demo" and len(demo["versions"]) == 2
        assert client.get("/api/v1/knowledge/items", headers=headers).json() == before


def test_model_format_failure_retries_once_and_does_not_create_feedback(fake_model):
    fake_model.invalid = True
    with TestClient(app) as client:
        headers = register(client)
        _, version = create_version(client, headers)
        result = client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers).json()
        assert result["status"] == "unavailable"
        assert fake_model.calls == 2
        assert client.get("/api/v1/knowledge/items", headers=headers).json() == []


def test_invalid_first_model_response_can_be_repaired(fake_model):
    fake_model.invalid_once = True
    with TestClient(app) as client:
        headers = register(client)
        _, version = create_version(client, headers)
        result = client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers).json()
        assert result["status"] == "assessed" and fake_model.calls == 2


@pytest.mark.asyncio
async def test_model_quarter_mean_is_recalculated_before_band_validation():
    from app.coach_schemas import Feedback

    assessment = await DeterministicWritingGrader().grade(
        WritingSubmission(task_type="writing_task_2", prompt=PROMPT, essay=ESSAY)
    )
    data = assessment.model_dump(mode="json")
    data["estimated_overall_band"] = 5.25
    result = Feedback.model_validate(
        {
            "assessment": data,
            "issues": [
                {
                    "id": "issue_1",
                    "criterion": "coherence_cohesion",
                    "quote": ESSAY,
                    "explanation": "检查衔接",
                    "goal": "明确关系",
                    "source_ids": ["ielts-writing-coherence"],
                }
            ],
        }
    )
    assert result.assessment.estimated_overall_band == assessment.estimated_overall_band


def test_wrong_answer_backfill_edit_and_delete_are_idempotent(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        question = client.post(
            "/api/v1/question-bank/questions",
            headers=headers,
            json={
                "module": "reading",
                "task_type": "multiple_choice",
                "prompt": "What does however express here?",
                "question_type": "single_choice",
                "options": ["contrast", "cause"],
                "correct_answer": "contrast",
                "explanation": "However expresses contrast.",
                "source_name": "Synthetic reading exercise",
            },
        ).json()
        client.post(
            f"/api/v1/question-bank/questions/{question['id']}/attempts",
            headers=headers,
            json={"answer": "cause"},
        )
        items = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert len(items) == 1 and items[0]["category"] == "mistake"
        item = items[0]
        answer = client.post(
            "/api/v1/rag/query", headers=headers,
            json={"query": "however", "source_type": "mistake"},
        ).json()
        assert answer["citations"][0]["provenance"] == "personal-learning-record"
        context = json.loads(fake_model.last_request["messages"][1]["content"])
        assert context["sources"][0]["license_type"] == "user-private"
        assert "确认状态" not in json.dumps(context, ensure_ascii=False)
        assert "AI推测，待确认" not in json.dumps(context, ensure_ascii=False)
        assert "not official IELTS explanations" in fake_model.last_request["messages"][0]["content"]
        client.patch(
            f"/api/v1/knowledge/items/{item['id']}",
            headers=headers,
            json={"title": "however", "note": "检查转折关系"},
        )
        for _ in range(2):
            client.post("/api/v1/knowledge/backfill", headers=headers)
        items = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert len(items) == 1 and items[0]["note"] == "检查转折关系"
        client.post(
            f"/api/v1/question-bank/questions/{question['id']}/attempts",
            headers=headers,
            json={"answer": "contrast"},
        )
        assert (
            client.get("/api/v1/knowledge/items", headers=headers).json()[0]["status"]
            == "correct_latest"
        )
        client.delete(f"/api/v1/knowledge/items/{item['id']}", headers=headers)
        client.post("/api/v1/knowledge/backfill", headers=headers)
        assert client.get("/api/v1/knowledge/items", headers=headers).json() == []


def test_rag_exact_cache_replay_conversation_and_context_change(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        query = {"query": "coherence and cohesion writing"}
        result = client.post("/api/v1/rag/query", headers=headers, json=query).json()
        assert result["mode"] == "live" and result["citations"]
        fake_model.unavailable = True
        cached = client.post("/api/v1/rag/query", headers=headers, json=query).json()
        assert cached["mode"] == "cache" and cached["generated_at"] == result["generated_at"]
        changed = client.post(
            "/api/v1/rag/query", headers=headers, json={"query": "different writing question"}
        ).json()
        assert changed["mode"] != "cache"
        history = client.get("/api/v1/knowledge/conversations", headers=headers).json()
        assert any(
            item["id"] == result["conversation_id"]
            and item["messages"][0]["query"] == query["query"]
            for item in history
        )


def test_knowledge_changes_invalidate_previous_context_cache(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        _, version = create_version(client, headers)
        client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers)
        query = {"query": "writing coherence and cohesion"}
        assert (
            client.post("/api/v1/rag/query", headers=headers, json=query).json()["mode"] == "live"
        )
        fake_model.unavailable = True
        assert (
            client.post("/api/v1/rag/query", headers=headers, json=query).json()["mode"] == "cache"
        )
        item = client.get("/api/v1/knowledge/items", headers=headers).json()[0]
        client.patch(
            f"/api/v1/knowledge/items/{item['id']}",
            headers=headers,
            json={"title": item["title"], "note": "补充自己的修改规则"},
        )
        assert (
            client.post("/api/v1/rag/query", headers=headers, json=query).json()["mode"] != "cache"
        )


def test_document_selection_and_empty_personal_scope(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        selected = client.post(
            "/api/v1/rag/query",
            headers=headers,
            json={"query": "Task 2 argument", "document_ids": ["coach-argument"]},
        ).json()
        assert selected["citations"]
        assert all(c["source_id"] == "coach-argument-chunk" for c in selected["citations"])
        assert selected["citations"][0]["provenance"] == "project-authored-guidance"
        assert selected["citations"][0]["license_type"] == "project-authored"
        no_words = client.post(
            "/api/v1/rag/query",
            headers=headers,
            json={"query": "我的单词", "source_type": "vocabulary"},
        ).json()
        assert no_words["mode"] == "insufficient" and no_words["citations"] == []


def test_merge_retains_sources_and_later_answers_refresh_merged_facts(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        questions = []
        for term in ("however", "therefore"):
            question = client.post(
                "/api/v1/question-bank/questions",
                headers=headers,
                json={
                    "module": "reading",
                    "task_type": "multiple_choice",
                    "prompt": f"What does {term} mean?",
                    "correct_answer": "correct",
                    "source_name": "Synthetic merge scenario",
                },
            ).json()
            questions.append(question)
            client.post(
                f"/api/v1/question-bank/questions/{question['id']}/attempts",
                headers=headers,
                json={"answer": "wrong"},
            )
        items = client.get("/api/v1/knowledge/items", headers=headers).json()
        target, other = items
        result = client.post(
            f"/api/v1/knowledge/items/{target['id']}/merge",
            headers=headers,
            json={"source_ids": [other["id"]]},
        )
        assert result.status_code == 200
        other_question = next(q for q in questions if q["id"] in other["source_link"])
        client.post(
            f"/api/v1/question-bank/questions/{other_question['id']}/attempts",
            headers=headers,
            json={"answer": "correct"},
        )
        client.post("/api/v1/knowledge/backfill", headers=headers)
        merged = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert len(merged) == 1
        assert any(
            item["status"] == "correct_latest" for item in merged[0]["merged_records"].values()
        )


def test_wrong_real_words_accumulate_but_nonwords_do_not(fake_model):
    from app.services.vocabulary import ITEMS_BY_ID, NONE_OF_ABOVE_INDEX

    with TestClient(app) as client:
        headers = register(client)
        current = client.post("/api/v1/vocabulary/tests", headers=headers).json()
        real_words = set()
        while current["status"] == "in_progress":
            item = ITEMS_BY_ID[current["current_item"]["id"]]
            if item.correct_index != NONE_OF_ABOVE_INDEX:
                real_words.add(item.surface)
            current = client.post(
                f"/api/v1/vocabulary/tests/{current['id']}/responses",
                headers=headers,
                json={"item_id": item.id, "selected_option": (item.correct_index + 1) % 5},
            ).json()
        notes = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert {item["title"] for item in notes} == real_words
        review = client.get(f"/api/v1/vocabulary/tests/{current['id']}/review", headers=headers)
        assert review.status_code == 200 and len(review.json()) == current["answered"]
        client.post("/api/v1/knowledge/backfill", headers=headers)
        assert len(client.get("/api/v1/knowledge/items", headers=headers).json()) == len(real_words)


def test_revision_does_not_repeat_profile_update_and_latest_feedback_reaches_dashboard(fake_model):
    from datetime import date, timedelta

    with TestClient(app) as client:
        headers = register(client)
        profile = {
            "exam_date": (date.today() + timedelta(days=60)).isoformat(),
            "current_scores": {
                skill: 5 for skill in ("writing", "reading", "listening", "speaking")
            },
            "target_scores": {
                skill: 7 for skill in ("writing", "reading", "listening", "speaking")
            },
            "minutes_by_weekday": {"1": 60},
        }
        assert client.post("/api/v1/diagnostics", headers=headers, json=profile).status_code == 200
        writing, first = create_version(client, headers)
        client.post(f"/api/v1/writing/versions/{first}/assess", headers=headers)
        initial = client.get("/api/v1/dashboard", headers=headers).json()
        _, second = create_version(client, headers, REVISION, writing)
        client.post(f"/api/v1/writing/versions/{second}/assess", headers=headers)
        updated = client.get("/api/v1/dashboard", headers=headers).json()
        assert updated["profile"]["current_scores"] == initial["profile"]["current_scores"]
        assert updated["latest_assessment"]["id"] == second
        before = len(client.get("/api/v1/knowledge/items", headers=headers).json())
        client.post("/api/v1/knowledge/backfill", headers=headers)
        assert len(client.get("/api/v1/knowledge/items", headers=headers).json()) == before


def test_legacy_knowledge_needs_no_confirmation_and_keeps_merged_provenance():
    from app.db import CoachRecord
    from app.services.personal_knowledge import knowledge_view

    row = CoachRecord(id="legacy", source_key="word:benefit", payload={
        "title": "benefit", "category": "vocabulary", "content": "旧练习记录",
        "source_link": "/writing?assessment=old", "pending": True, "confirmed": False,
        "merged_records": {"word:however": {
            "title": "however", "content": "旧词义记录", "pending": True,
            "confirmed": False, "source_link": "/vocabulary?test=old",
        }},
    })
    data = knowledge_view(row)
    assert data["source_summary"] == "作文练习积累"
    assert "pending" not in data and "confirmed" not in data
    merged = data["merged_records"]["word:however"]
    assert merged["source_summary"] == "历史词义练习中的错词"
    assert "pending" not in merged and "confirmed" not in merged
    assert row.payload["pending"] is True  # Reading old records never rewrites history.


def test_coach_does_not_send_legacy_key_to_its_default_provider(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "coach_api_key", None)
    monkeypatch.setattr(settings, "openai_api_key", "synthetic-legacy-only-key")
    monkeypatch.setattr(settings, "coach_offline", False)
    created = []

    def unexpected_client(**kwargs):
        created.append(kwargs.get("base_url"))
        raise AssertionError("Legacy key must not be used by the coach provider")

    monkeypatch.setattr("openai.AsyncOpenAI", unexpected_client)
    with TestClient(app) as client:
        headers = register(client)
        response = client.post(
            "/api/v1/rag/query", headers=headers,
            json={"query": "How can paragraph coherence and cohesion improve my writing?"},
        )
        assert response.status_code == 200
        assert response.json()["mode"] == "offline"
        assert created == []

# Personal-memory scenarios below use only synthetic notes, exercises and model responses.

def make_fragment(client, headers, **overrides):
    body = {"title": "Information usage", "content": "Information is uncountable. Avoid many information.", "topic_tags": ["不可数名词"], **overrides}
    response = client.post("/api/v1/knowledge/items", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def make_memory_question(client, headers, **overrides):
    response = client.post("/api/v1/question-bank/questions", headers=headers, json={
        "module": "reading", "task_type": "multiple_choice", "prompt": "Which quantity expression is appropriate for information?",
        "passage": "Information is uncountable in this exercise.", "correct_answer": "much", "explanation": "Use much information.",
        "tags": ["不可数名词"], "source_name": "Synthetic memory regression", **overrides,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_fragment_creation_replay_and_changed_request_rejection():
    with TestClient(app) as client:
        headers = register(client)
        key = str(uuid4())
        first = make_fragment(client, headers, request_id=key)
        again = make_fragment(client, headers, request_id=key)
        assert again["id"] == first["id"]
        assert first["topic_tags"] == ["grammar.countability"]
        assert first["provenance"] == "user-authored-note" and "embedding" not in first
        assert "request_digest" not in first
        assert len(client.get("/api/v1/knowledge/items", headers=headers).json()) == 1
        changed = client.post("/api/v1/knowledge/items", headers=headers, json={"title": "Changed", "content": "Different content", "request_id": key})
        assert changed.status_code == 409


@pytest.mark.parametrize("change", [{"title": "   "}, {"content": " "}, {"source_url": "javascript:alert(1)"}, {"topic_tags": ["x" * 65]}])
def test_invalid_fragment_input_is_rejected(change):
    with TestClient(app) as client:
        headers = register(client)
        response = client.post("/api/v1/knowledge/items", headers=headers, json={"title": "Valid title", "content": "Valid content", **change})
        assert response.status_code == 422
        assert client.get("/api/v1/knowledge/items", headers=headers).json() == []


def test_private_notes_and_associations_are_owner_scoped():
    with TestClient(app) as client:
        first, second = register(client), register(client)
        note = make_fragment(client, first)
        assert client.patch(f"/api/v1/knowledge/items/{note['id']}", headers=second, json={"note": "overwrite"}).status_code == 404
        assert client.get(f"/api/v1/knowledge/items/{note['id']}/events", headers=second).status_code == 404
        assert client.post(f"/api/v1/knowledge/items/{note['id']}/reviews", headers=second, json={"outcome": "improved"}).status_code == 404
        assert client.post("/api/v1/knowledge/items", headers=second, json={"title": "link", "content": "private link", "related_ids": [note["id"]]}).status_code == 404
        assert client.post("/api/v1/rag/preview", headers=second, json={"query": "many information", "source_type": "note"}).json()["citations"] == []
        assert client.get("/api/v1/knowledge/topics", headers=second).json()["items"] == []


def test_edit_reindexes_note_and_preserves_original_capture_event():
    with TestClient(app) as client:
        headers = register(client)
        item = make_fragment(client, headers)
        response = client.patch(f"/api/v1/knowledge/items/{item['id']}", headers=headers, json={"content": "Collocation: make a decision.", "topic_tags": ["搭配"], "source_url": "https://example.com/synthetic"})
        assert response.status_code == 200
        assert response.json()["topic_tags"] == ["lexical.collocation"]
        preview = client.post("/api/v1/rag/preview", headers=headers, json={"query": "make a decision", "source_type": "note", "topic_tags": ["搭配"]}).json()
        assert preview["generated"] is False
        assert preview["citations"][0]["source_id"] == item["id"]
        assert "make a decision" in preview["citations"][0]["excerpt"]
        assert "关键词匹配" in preview["citations"][0]["match_reasons"]
        original = client.get(f"/api/v1/knowledge/items/{item['id']}/events", headers=headers).json()[0]
        assert "many information" in original["content"]
        assert client.patch(f"/api/v1/knowledge/items/{item['id']}", headers=headers, json={"note": None}).status_code == 422


def test_fragment_links_inherit_topics_without_editing_source():
    with TestClient(app) as client:
        headers = register(client)
        source = make_fragment(client, headers)
        linked = make_fragment(client, headers, title="My example", content="A piece of information", topic_tags=[], related_ids=[source["id"]])
        assert linked["related_ids"] == [source["id"]]
        assert linked["topic_tags"] == ["grammar.countability"]
        assert client.patch(f"/api/v1/knowledge/items/{linked['id']}", headers=headers, json={"related_ids": [linked["id"]]}).status_code == 422


def test_question_bookmark_is_exact_idempotent_and_private():
    with TestClient(app) as client:
        headers, other = register(client), register(client)
        question = make_memory_question(client, headers)
        body = {"source_type": "question", "source_id": question["id"], "excerpt": "Information is uncountable", "topic_tags": ["不可数名词"]}
        saved = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert saved.status_code == 201
        assert saved.json()["source_summary"] == "练习原文摘录"
        replay = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert replay.json()["id"] == saved.json()["id"]
        assert client.post("/api/v1/knowledge/bookmarks", headers=other, json=body).status_code == 404
        assert client.post("/api/v1/knowledge/bookmarks", headers=headers, json={**body, "excerpt": "fabricated quotation"}).status_code == 422
        assert client.patch(f"/api/v1/knowledge/items/{saved.json()['id']}", headers=headers, json={"content": "rewrite original"}).status_code == 409


def test_writing_bookmark_preserves_selected_learner_text_and_permissions():
    with TestClient(app) as client:
        headers, other = register(client), register(client)
        _, version = create_version(client, headers)
        body = {"source_type": "writing_version", "source_id": version, "excerpt": ESSAY.split(". ")[0]}
        item = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert item.status_code == 201
        assert item.json()["provenance"] == "learner-writing-excerpt"
        assert version in item.json()["source_link"]
        assert client.post("/api/v1/knowledge/bookmarks", headers=other, json=body).status_code == 404


def test_topic_counts_distinct_practice_events_and_tracks_correct_retry():
    with TestClient(app) as client:
        headers = register(client)
        questions = [make_memory_question(client, headers), make_memory_question(client, headers, prompt="Choose another information expression.")]
        for question in questions:
            assert client.post(f"/api/v1/question-bank/questions/{question['id']}/attempts", headers=headers, json={"answer": "many"}).status_code == 201
        for _ in range(2):
            assert client.post("/api/v1/knowledge/backfill", headers=headers).status_code == 200
        topic = client.get("/api/v1/knowledge/topics", headers=headers).json()["items"][0]
        assert topic["id"] == "grammar.countability"
        assert topic["mistake_count"] == 2 and topic["practice_count"] == 2 and topic["unresolved_count"] == 2
        linked = make_fragment(client, headers, related_ids=topic["item_ids"])
        assert linked["topic_tags"] == ["grammar.countability"]
        client.post(f"/api/v1/question-bank/questions/{questions[0]['id']}/attempts", headers=headers, json={"answer": "much"})
        topic = client.get("/api/v1/knowledge/topics", headers=headers).json()["items"][0]
        assert topic["mistake_count"] == 2 and topic["practice_count"] == 3 and topic["unresolved_count"] == 1
        items = client.get("/api/v1/knowledge/items", headers=headers).json()
        corrected = next(item for item in items if item.get("status") == "correct_latest")
        events = client.get(f"/api/v1/knowledge/items/{corrected['id']}/events", headers=headers).json()
        assert [event["status"] for event in events] == ["review", "correct_latest"]
        assert corrected["mistake_count"] == 1


def test_self_review_is_labeled_idempotent_and_does_not_fabricate_practice():
    with TestClient(app) as client:
        headers = register(client)
        item = make_fragment(client, headers)
        body = {"outcome": "improved", "note": "Synthetic self reflection, not an automatic grade", "request_id": str(uuid4())}
        for _ in range(2):
            result = client.post(f"/api/v1/knowledge/items/{item['id']}/reviews", headers=headers, json=body)
            assert result.status_code == 200
        assert result.json()["state_source"] == "self_review" and result.json()["practice_count"] == 0
        events = client.get(f"/api/v1/knowledge/items/{item['id']}/events", headers=headers).json()
        assert len(events) == 2 and events[-1]["provenance"] == "user-self-review"
        sources = client.post("/api/v1/rag/preview", headers=headers, json={"query": "many information", "source_type": "note"}).json()["citations"]
        assert "最近已改善" in sources[0]["match_reasons"]
        assert sources[0]["memory_state_source"] == "self_review"


def test_personalized_context_uses_each_users_own_fragment(fake_model):
    with TestClient(app) as client:
        first, second = register(client), register(client)
        a = make_fragment(client, first, content="Personal example A: many information.")
        b = make_fragment(client, second, content="Personal example B: much information.")
        for headers, expected, forbidden in [(first, a, b), (second, b, a)]:
            answer = client.post("/api/v1/rag/query", headers=headers, json={"query": "many information", "source_type": "note"}).json()
            context = json.loads(fake_model.last_request["messages"][1]["content"])
            assert answer["mode"] == "live"
            ids = {source["source_id"] for source in context["sources"]}
            assert expected["id"] in ids and forbidden["id"] not in ids
            assert forbidden["content"] not in json.dumps(context)


def test_edit_delete_invalidates_replay_and_excludes_stale_conversation_context(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        item = make_fragment(client, headers)
        query = {"query": "information usage", "source_type": "note"}
        first = client.post("/api/v1/rag/query", headers=headers, json=query).json()
        fake_model.unavailable = True
        assert client.post("/api/v1/rag/query", headers=headers, json=query).json()["mode"] == "cache"
        client.patch(f"/api/v1/knowledge/items/{item['id']}", headers=headers, json={"content": "Updated information example, not the original wording."})
        assert client.post("/api/v1/rag/query", headers=headers, json=query).json()["mode"] != "cache"
        fake_model.unavailable = False
        answer = client.post("/api/v1/rag/query", headers=headers, json={**query, "conversation_id": first["conversation_id"]}).json()
        assert answer["mode"] == "live"
        context = json.loads(fake_model.last_request["messages"][1]["content"])
        assert context["history"] == []
        client.delete(f"/api/v1/knowledge/items/{item['id']}", headers=headers)
        result = client.post("/api/v1/rag/query", headers=headers, json={**query, "conversation_id": first["conversation_id"]}).json()
        assert result["mode"] == "insufficient" and result["citations"] == []
        assert client.get("/api/v1/knowledge/topics", headers=headers).json()["items"] == []
        assert client.get(f"/api/v1/knowledge/items/{item['id']}/events", headers=headers).status_code == 404


def test_answer_bookmark_is_owned_and_keeps_ai_provenance(fake_model):
    with TestClient(app) as client:
        headers, other = register(client), register(client)
        item = make_fragment(client, headers)
        answer = client.post("/api/v1/rag/query", headers=headers, json={"query": "information", "source_type": "note"}).json()
        body = {"source_type": "conversation", "source_id": answer["conversation_id"], "message_index": 0}
        result = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert result.status_code == 201 and result.json()["provenance"] == "ai-answer-bookmark"
        assert client.post("/api/v1/knowledge/bookmarks", headers=other, json=body).status_code == 404
        client.delete(f"/api/v1/knowledge/items/{item['id']}", headers=headers)
        assert client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body).status_code == 409


def test_merge_preserves_independent_events_and_updates_future_evidence():
    with TestClient(app) as client:
        headers = register(client)
        questions = [make_memory_question(client, headers), make_memory_question(client, headers, prompt="Another information question.")]
        for question in questions:
            client.post(f"/api/v1/question-bank/questions/{question['id']}/attempts", headers=headers, json={"answer": "many"})
        items = client.get("/api/v1/knowledge/items", headers=headers).json()
        merged = client.post(f"/api/v1/knowledge/items/{items[0]['id']}/merge", headers=headers, json={"source_ids": [items[1]["id"]]})
        assert merged.status_code == 200
        active = client.get("/api/v1/knowledge/items", headers=headers).json()
        assert len(active) == 1 and active[0]["mistake_count"] == 2
        client.post(f"/api/v1/question-bank/questions/{questions[0]['id']}/attempts", headers=headers, json={"answer": "much"})
        assert len(client.get(f"/api/v1/knowledge/items/{active[0]['id']}/events", headers=headers).json()) == 3


def test_no_notes_is_insufficient_and_does_not_call_a_model(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        result = client.post("/api/v1/rag/query", headers=headers, json={"query": "My past mistakes", "source_type": "note"})
        assert result.json()["mode"] == "insufficient" and fake_model.calls == 0


def test_invalid_source_id_cannot_become_a_generated_citation(fake_model, monkeypatch):
    async def unsupported(self, **kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"answer": "Unsupported synthetic answer", "source_ids": [str(uuid4())], "sufficient": True})))], usage=None)
    monkeypatch.setattr(fake_model, "create", unsupported)
    with TestClient(app) as client:
        headers = register(client)
        make_fragment(client, headers)
        result = client.post("/api/v1/rag/query", headers=headers, json={"query": "information", "source_type": "note"}).json()
        assert result["mode"] == "offline" and "Unsupported synthetic answer" not in result["answer"]


def test_document_bookmark_retains_page_and_private_access():
    from app.db import KnowledgeChunkRow, KnowledgeDocumentRow, SessionLocal

    with TestClient(app) as client:
        headers, other = register(client), register(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

        async def seed_document():
            async with SessionLocal() as session:
                document = KnowledgeDocumentRow(owner_id=user_id, title="Synthetic page fixture", filename="fixture.txt", status="completed", source_url="https://example.com/synthetic-fixture")
                session.add(document)
                await session.flush()
                session.add(KnowledgeChunkRow(document_id=document.id, owner_id=user_id, content="A synthetic rule about countability.", page=9, chunk_index=0))
                await session.commit()
                return document.id

        document_id = client.portal.call(seed_document)
        body = {"source_type": "document", "source_id": document_id, "excerpt": "synthetic rule about countability"}
        response = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert response.status_code == 201 and response.json()["page"] == 9
        assert client.post("/api/v1/knowledge/bookmarks", headers=other, json=body).status_code == 404


def test_other_users_cache_survives_private_memory_edit(fake_model):
    with TestClient(app) as client:
        first, second = register(client), register(client)
        first_note = make_fragment(client, first)
        make_fragment(client, second)
        query = {"query": "information usage", "source_type": "note"}
        assert client.post("/api/v1/rag/query", headers=second, json=query).json()["mode"] == "live"
        client.patch(f"/api/v1/knowledge/items/{first_note['id']}", headers=first, json={"note": "Only first user's memory changed"})
        fake_model.unavailable = True
        assert client.post("/api/v1/rag/query", headers=second, json=query).json()["mode"] == "cache"


def test_topic_scope_is_validated_and_cannot_change_inside_conversation(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        make_fragment(client, headers)
        query = {"query": "information", "source_type": "note", "topic_tags": ["不可数名词"]}
        answer = client.post("/api/v1/rag/query", headers=headers, json=query).json()
        same = client.post("/api/v1/rag/query", headers=headers, json={**query, "topic_tags": ["grammar.countability"], "conversation_id": answer["conversation_id"]})
        assert same.status_code == 200
        changed = client.post("/api/v1/rag/query", headers=headers, json={**query, "topic_tags": ["搭配"], "conversation_id": answer["conversation_id"]})
        assert changed.status_code == 409
        invalid = client.post("/api/v1/rag/preview", headers=headers, json={"query": "information", "topic_tags": ["x" * 65]})
        assert invalid.status_code == 422


def test_memory_change_during_generation_does_not_return_deleted_sources(fake_model, monkeypatch):
    from app.db import CoachRecord, SessionLocal
    from app.services.learning_memory import invalidate_memory

    original = fake_model.create
    target = {}

    async def delete_during_generation(self, **kwargs):
        result = await original(self, **kwargs)
        async with SessionLocal() as session:
            item = await session.get(CoachRecord, target["item"])
            item.payload = {"deleted": True}
            await invalidate_memory(session, target["user"], {item.id})
            await session.commit()
        return result

    monkeypatch.setattr(fake_model, "create", delete_during_generation)
    with TestClient(app) as client:
        headers = register(client)
        item = make_fragment(client, headers)
        target.update(item=item["id"], user=client.get("/api/v1/auth/me", headers=headers).json()["id"])
        response = client.post("/api/v1/rag/query", headers=headers, json={"query": "information usage", "source_type": "note"})
        assert response.status_code == 200
        assert response.json()["mode"] == "insufficient" and response.json()["citations"] == []


def test_explicitly_cleared_topics_are_not_silently_reinferred():
    with TestClient(app) as client:
        headers = register(client)
        item = make_fragment(client, headers)
        response = client.patch(f"/api/v1/knowledge/items/{item['id']}", headers=headers, json={"topic_tags": []})
        assert response.status_code == 200 and response.json()["topic_tags"] == []
        assert client.get("/api/v1/knowledge/topics", headers=headers).json()["items"] == []
        assert client.post("/api/v1/rag/preview", headers=headers, json={"query": "information", "source_type": "note", "topic_tags": ["不可数名词"]}).json()["citations"] == []


def test_bookmark_accepts_browser_normalized_windows_line_endings():
    with TestClient(app) as client:
        headers = register(client)
        question = make_memory_question(client, headers, passage="First line.\r\nSecond line about information.")
        response = client.post("/api/v1/knowledge/bookmarks", headers=headers, json={"source_type": "question", "source_id": question["id"], "excerpt": "First line.\nSecond line about information."})
        assert response.status_code == 201
        assert response.json()["content"] == "First line.\nSecond line about information."


def test_rag_followup_and_new_topic_use_different_retrieval_queries(fake_model):
    with TestClient(app) as client:
        headers = register(client)
        make_fragment(client, headers)
        make_fragment(client, headers, title="Make a decision", content="Collocation: make a decision rather than do a decision.", topic_tags=["搭配"])
        first = client.post("/api/v1/rag/query", headers=headers, json={"query": "many information", "source_type": "note"}).json()
        followup = client.post("/api/v1/rag/query", headers=headers, json={"query": "那条规则再举个例子", "source_type": "note", "conversation_id": first["conversation_id"]}).json()
        assert "many information" in followup["retrieval_query"]
        new_topic = "make a decision collocation"
        independent = client.post("/api/v1/rag/query", headers=headers, json={"query": new_topic, "source_type": "note", "conversation_id": first["conversation_id"]}).json()
        assert independent["retrieval_query"] == new_topic


def test_rag_model_receives_budgeted_evidence_and_cites_only_included_sources(fake_model, monkeypatch):
    monkeypatch.setattr(get_settings(), "rag_evidence_chars", 2200)
    monkeypatch.setattr(get_settings(), "rag_source_chars", 640)
    with TestClient(app) as client:
        headers = register(client)
        for index in range(4):
            make_fragment(client, headers, title=f"Synthetic countability {index}", content="padding " * 400 + " countability evidence with exact wording " + " tail" * 400)
        response = client.post("/api/v1/rag/query", headers=headers, json={"query": "countability", "source_type": "note"})
        assert response.status_code == 200 and response.json()["mode"] == "live"
        context = json.loads(fake_model.last_request["messages"][1]["content"])
        assert len(json.dumps(context["sources"], ensure_ascii=False)) <= 2200
        assert all(len(source["full_text"]) <= 640 for source in context["sources"])
        included = {source["source_id"] for source in context["sources"]}
        assert all(citation["source_id"] in included and citation["context_truncated"] for citation in response.json()["citations"])
