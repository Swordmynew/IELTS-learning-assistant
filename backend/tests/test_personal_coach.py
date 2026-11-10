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
