"""Isolated synthetic vocabulary-learning scenarios; providers never see learner records."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import CoachRecord, SessionLocal, VocabularyTestSessionRow
from app.main import app
from app.schemas import WritingSubmission
from app.services.vocabulary_extraction import process_one_job
from app.services.word_deck import starter_data
from app.services.writing import DeterministicWritingGrader

ESSAY = "Governments should allocate more money for education. It will benifit families."
PROMPT = "Should governments pay university tuition for every student?"
WORD = {"word": "benefit", "meaning": "使受益；益处", "part_of_speech": "v.; n.", "reason": "spelling", "original_form": "benifit", "original_quote": "It will benifit families.", "explanation": "benifit 应拼写为 benefit。", "example": "Targeted grants benefit low-income families."}


class Model:
    calls = 0
    empty = False
    unavailable = False
    invalid_quote = False
    words = None
    contexts = []

    def __init__(self, **kwargs):
        self.chat = SimpleNamespace(completions=self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def create(self, **kwargs):
        type(self).calls += 1
        context = json.loads(kwargs["messages"][1]["content"])
        type(self).contexts.append(context)
        if self.unavailable:
            raise TimeoutError("Synthetic outage")
        if "maximum_words" in context:
            words = [] if self.empty else self.words or [WORD]
            if self.invalid_quote:
                words = [{**WORD, "original_quote": "A sentence never written by this learner."}]
            data = {"words": words}
        else:
            assessment = await DeterministicWritingGrader().grade(WritingSubmission(task_type="writing_task_2", prompt=context["prompt"], essay=context["essay"]))
            data = {"assessment": assessment.model_dump(mode="json"), "issues": [{"id": "issue_1", "criterion": "lexical_resource", "quote": "It will benifit families.", "explanation": "检查 benefit 的拼写。", "goal": "修正拼写。", "source_ids": [context["public_rubric"][0]["source_id"]]}]}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(data)))], usage=SimpleNamespace(total_tokens=100))


@pytest.fixture
def model(monkeypatch):
    monkeypatch.setattr("openai.AsyncOpenAI", Model)
    monkeypatch.setattr(get_settings(), "coach_api_key", "synthetic-key")
    monkeypatch.setattr(get_settings(), "coach_offline", False)
    for key, value in {"calls": 0, "empty": False, "unavailable": False, "invalid_quote": False, "words": None, "contexts": []}.items():
        monkeypatch.setattr(Model, key, value)
    return Model


def register(client):
    result = client.post("/api/v1/auth/register", json={"email": f"{uuid4()}@example.com", "password": "SyntheticPassword123"})
    return {"Authorization": f"Bearer {result.json()['access_token']}"}


def writing(client, headers):
    parent = client.post("/api/v1/writing/sessions", headers=headers, json={"prompt": PROMPT}).json()
    return client.post(f"/api/v1/writing/sessions/{parent['id']}/versions", headers=headers, json={"essay": ESSAY}).json()["id"]


def request_job(client, headers, version, kind="requested"):
    result = client.post("/api/v1/vocabulary/extractions", headers=headers, json={"source_id": version, "request_type": kind})
    assert result.status_code == 202
    return result.json()


def jobs(client, headers, version):
    return client.get(f"/api/v1/vocabulary/extractions?source_id={version}", headers=headers).json()


def personal(client, headers):
    return client.get("/api/v1/vocabulary/deck?scope=personal", headers=headers).json()


def test_starter_deck_is_local_searchable_and_has_no_ability_score(model):
    with TestClient(app) as client:
        headers = register(client)
        data = client.get("/api/v1/vocabulary/deck?q=benefit", headers=headers).json()
        assert data["counts"]["starter"] == starter_data()["count"] >= 8000
        assert any(card["word"] == "benefit" and card["meaning"] for card in data["items"])
        assert "theta" not in data and "cefr" not in json.dumps(data).lower()
        queue = client.get("/api/v1/vocabulary/study", headers=headers).json()["items"]
        assert len(queue) == 10 and len({card["word"] for card in queue}) == 10
        assert model.calls == 0


def test_grading_only_enqueues_and_uses_separate_extraction_request(model):
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        result = client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers)
        assert result.status_code == 200 and result.json()["feedback"]
        assert model.calls == 1
        job = jobs(client, headers, version)[0]
        assert job["status"] == "queued" and job["request_type"] == "automatic"
        assert client.portal.call(process_one_job, job["id"])
        assert model.calls == 2
        assert "maximum_words" not in model.contexts[0]
        assert "maximum_words" in model.contexts[1]
        card = personal(client, headers)["items"][0]
        assert card["word"] == "benefit" and card["sources"][0]["original_form"] == "benifit"
        note = next(item for item in client.get("/api/v1/knowledge/items", headers=headers).json() if item["title"] == "benefit")
        assert note["source_summary"] == "作文批改自动积累 · 拼写纠正"
        assert "confirmed" not in note and "pending" not in note
        client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers)
        assert len(jobs(client, headers, version)) == 1 and model.calls == 2


def test_empty_extraction_stays_empty_and_does_not_add_words(model):
    model.empty = True
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        job = request_job(client, headers, version)
        client.portal.call(process_one_job, job["id"])
        result = jobs(client, headers, version)[0]
        assert result["status"] == "completed" and result["words"] == []
        assert personal(client, headers)["total"] == 0


def test_outage_is_retryable_without_regrading_or_fabricated_words(model):
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        feedback = client.post(f"/api/v1/writing/versions/{version}/assess", headers=headers).json()["feedback"]
        job = jobs(client, headers, version)[0]
        model.unavailable = True
        client.portal.call(process_one_job, job["id"])
        assert jobs(client, headers, version)[0]["status"] == "unavailable"
        assert personal(client, headers)["total"] == 0
        assert client.get(f"/api/v1/writing/sessions/{client.get('/api/v1/writing/sessions', headers=headers).json()[0]['id']}", headers=headers).json()["versions"][0]["feedback"] == feedback
        model.unavailable = False
        assert request_job(client, headers, version, "automatic")["id"] == job["id"]
        client.portal.call(process_one_job, job["id"])
        assert jobs(client, headers, version)[0]["status"] == "completed"


def test_fabricated_original_quote_is_rejected(model):
    model.invalid_quote = True
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        job = request_job(client, headers, version)
        client.portal.call(process_one_job, job["id"])
        assert jobs(client, headers, version)[0]["status"] == "unavailable"
        assert model.calls == 2 and personal(client, headers)["total"] == 0


def test_valid_word_in_wrong_grammatical_form_is_usage_not_spelling(model):
    model.words = [{**WORD, "word": "efficiently", "original_form": "efficient", "original_quote": "Governments allocate money efficient.", "meaning": "高效地", "part_of_speech": "adv.", "reason": "spelling"}]
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        # A separate immutable draft with the grammatical form under test.
        parent_id = client.get("/api/v1/writing/sessions", headers=headers).json()[0]["id"]
        version = client.post(f"/api/v1/writing/sessions/{parent_id}/versions", headers=headers, json={"essay": "Governments allocate money efficient."}).json()["id"]
        job = request_job(client, headers, version)
        client.portal.call(process_one_job, job["id"])
        assert jobs(client, headers, version)[0]["words"][0]["reason"] == "usage"


def test_legacy_single_assessment_also_enqueues_without_changing_its_result(model):
    with TestClient(app) as client:
        headers = register(client)
        result = client.post("/api/v1/writing/assessments", headers=headers, json={"task_type": "writing_task_1", "prompt": PROMPT, "essay": ESSAY})
        assert result.status_code == 201 and len(result.json()["criteria"]) == 4
        response = client.get(f"/api/v1/vocabulary/extractions?source_id={result.json()['id']}&source_kind=assessment", headers=headers)
        assert response.status_code == 200
        assert response.json()[0]["status"] == "queued"
        assert model.calls == 0


def test_review_is_idempotent_stale_safe_and_personal_progress_is_private(model):
    with TestClient(app) as client:
        headers, other = register(client), register(client)
        card = client.get("/api/v1/vocabulary/study", headers=headers).json()["items"][0]
        body = {"word": card["word"], "rating": "again", "revision": 0, "event_id": str(uuid4())}
        result = client.post("/api/v1/vocabulary/reviews", headers=headers, json=body)
        assert result.status_code == 200
        saved = result.json()
        assert saved["lapses"] == 1 and saved["review_count"] == 1
        assert saved["personal"] is True
        note = client.get("/api/v1/knowledge/items", headers=headers).json()[0]
        assert note["source_summary"] == "背单词复习"
        delta = datetime.fromisoformat(saved["due_at"]) - datetime.now(UTC)
        assert timedelta(minutes=9) < delta <= timedelta(minutes=10)
        assert client.post("/api/v1/vocabulary/reviews", headers=headers, json=body).json() == saved
        assert client.post("/api/v1/vocabulary/reviews", headers=headers, json={**body, "event_id": str(uuid4())}).status_code == 409
        assert client.get("/api/v1/vocabulary/deck?scope=learned", headers=other).json()["total"] == 0
        good = client.post("/api/v1/vocabulary/reviews", headers=headers, json={**body, "rating": "good", "revision": 1, "event_id": str(uuid4())}).json()
        assert good["interval_days"] == 1 and good["review_count"] == 2


def test_duplicate_word_merges_sources_preserves_edits_and_scheduling(model):
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        first = request_job(client, headers, version, "automatic")
        client.portal.call(process_one_job, first["id"])
        card = personal(client, headers)["items"][0]
        reviewed = client.post("/api/v1/vocabulary/reviews", headers=headers, json={"word": "benefit", "rating": "good", "revision": card["revision"], "event_id": str(uuid4())}).json()
        client.patch("/api/v1/vocabulary/words", headers=headers, json={"word": "benefit", "meaning": "我自己的释义", "note": "注意拼写"})
        second = request_job(client, headers, version)
        client.portal.call(process_one_job, second["id"])
        data = personal(client, headers)
        assert data["total"] == 1
        merged = data["items"][0]
        assert merged["meaning"] == "我自己的释义" and merged["note"] == "注意拼写"
        assert len(merged["sources"]) == 2 and merged["due_at"] == reviewed["due_at"]
        assert merged["interval_days"] == 1
        note = client.get("/api/v1/knowledge/items", headers=headers).json()[0]
        assert note["source_summary"] == "作文主动积累 · 拼写纠正"


def test_new_phrase_grows_local_personal_deck_and_suspension_is_reversible(model):
    model.words = [{**WORD, "word": "ring-fence funding", "original_form": "allocate", "original_quote": "Governments should allocate more money for education.", "reason": "accumulate", "meaning": "将资金专项保留", "explanation": "可积累专项拨款的表达。", "example": "Governments can ring-fence funding for education."}]
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        job = request_job(client, headers, version)
        client.portal.call(process_one_job, job["id"])
        data = personal(client, headers)
        assert data["counts"]["total"] == starter_data()["count"] + 1
        assert data["items"][0]["word"] == "ring-fence funding"
        assert client.get("/api/v1/vocabulary/study", headers=headers).json()["items"][0]["word"] == "ring-fence funding"
        assert len(client.get("/api/v1/vocabulary/study?scope=personal", headers=headers).json()["items"]) == 1
        client.patch("/api/v1/vocabulary/words", headers=headers, json={"word": "ring-fence funding", "suspended": True})
        assert personal(client, headers)["total"] == 0
        assert client.get("/api/v1/vocabulary/deck?scope=suspended", headers=headers).json()["total"] == 1
        client.patch("/api/v1/vocabulary/words", headers=headers, json={"word": "ring-fence funding", "suspended": False})
        assert personal(client, headers)["total"] == 1


def test_writing_jobs_cannot_cross_user_boundaries(model):
    with TestClient(app) as client:
        headers, other = register(client), register(client)
        version = writing(client, headers)
        assert client.post("/api/v1/vocabulary/extractions", headers=other, json={"source_id": version}).status_code == 404
        assert client.get(f"/api/v1/vocabulary/extractions?source_id={version}", headers=other).status_code == 404
        job = request_job(client, headers, version)
        client.portal.call(process_one_job, job["id"])
        assert personal(client, other)["total"] == 0


def test_previous_real_word_mistake_import_is_idempotent(model):
    with TestClient(app) as client:
        headers = register(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

        async def seed():
            async with SessionLocal() as session:
                session.add(CoachRecord(user_id=user_id, kind="knowledge", source_key="word:benefit", payload={"title": "benefit", "category": "vocabulary", "content": "正确释义：益处", "note": "历史错词", "source_link": "/vocabulary?test=synthetic"}))
                await session.commit()

        client.portal.call(seed)
        for _ in range(2):
            result = personal(client, headers)
            assert result["total"] == 1 and result["items"][0]["meaning"] == "益处"


def test_legacy_none_of_above_errors_use_dictionary_meaning_and_exclude_nonwords(model):
    with TestClient(app) as client:
        headers = register(client)
        user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

        async def seed():
            async with SessionLocal() as session:
                session.add(VocabularyTestSessionRow(id=str(uuid4()), user_id=user_id, status="completed", administered=["v010", "p001"], responses=[{"item_id": "v010", "selected_option": 0, "correct": False}, {"item_id": "p001", "selected_option": 0, "correct": False}]))
                await session.commit()

        client.portal.call(seed)
        result = personal(client, headers)
        assert result["total"] == 1
        card = result["items"][0]
        assert card["word"] == "accurate" and card["meaning"] != "以上都不是"
        assert "灵活的" in card["sources"][0]["original_quote"]


def test_expired_job_lease_can_be_recovered(model):
    with TestClient(app) as client:
        headers = register(client)
        version = writing(client, headers)
        job = request_job(client, headers, version)

        async def expire():
            async with SessionLocal() as session:
                row = await session.get(CoachRecord, job["id"])
                row.payload = {**row.payload, "status": "running", "lease_until": (datetime.now(UTC) - timedelta(seconds=1)).isoformat()}
                await session.commit()

        client.portal.call(expire)
        assert client.portal.call(process_one_job, job["id"])
        assert jobs(client, headers, version)[0]["status"] == "completed"
