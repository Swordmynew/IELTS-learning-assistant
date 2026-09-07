import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.services.question_bank import parse_question_file


def test_parse_json_and_pipe_delimited_csv() -> None:
    json_items = parse_question_file(
        "bank.json",
        json.dumps(
            {
                "questions": [
                    {
                        "module": "reading",
                        "task_type": "multiple_choice",
                        "prompt": "Which option best describes the main idea?",
                        "options": ["A", "B"],
                    }
                ]
            }
        ).encode(),
    )
    csv_items = parse_question_file(
        "bank.csv",
        b"module,task_type,prompt,options,tags\nlistening,form_completion,Write the time,9:00|9:30,numbers|time\n",
    )

    assert json_items[0].options == ["A", "B"]
    assert csv_items[0].options == ["9:00", "9:30"]
    assert csv_items[0].tags == ["numbers", "time"]


def test_user_can_browse_and_import_private_questions() -> None:
    with TestClient(app) as client:
        token = client.post("/api/v1/auth/demo").json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        public_questions = client.get("/api/v1/question-bank/questions", headers=headers)
        assert public_questions.status_code == 200
        assert public_questions.json()["total"] >= 6
        assert "correct_answer" not in public_questions.json()["items"][0]
        assert "explanation" not in public_questions.json()["items"][0]

        payload = {
            "questions": [
                {
                    "module": "writing",
                    "task_type": "writing_task_2",
                    "question_type": "essay",
                    "prompt": "Should public transport be free in large cities? Discuss both views.",
                    "tags": ["private-test"],
                }
            ]
        }
        imported = client.post(
            "/api/v1/question-bank/import",
            headers=headers,
            files={"file": ("my-bank.json", json.dumps(payload), "application/json")},
        )
        assert imported.status_code == 201
        assert imported.json()["imported"] == 1

        filtered = client.get(
            "/api/v1/question-bank/questions?module=writing&search=transport",
            headers=headers,
        )
        assert filtered.status_code == 200
        assert filtered.json()["items"][0]["is_public"] is False

        documents = client.get("/api/v1/knowledge/documents", headers=headers)
        assert documents.status_code == 200
        assert any(item["is_private"] is False for item in documents.json())


def test_private_questions_are_isolated_between_users() -> None:
    with TestClient(app) as client:
        credentials = {
            "email": f"owner-{uuid4()}@example.com",
            "password": "test-password-123",
        }
        owner_token = client.post("/api/v1/auth/register", json=credentials).json()[
            "access_token"
        ]
        unique_prompt = f"Private prompt {uuid4()} should remain isolated."
        client.post(
            "/api/v1/question-bank/import",
            headers={"Authorization": f"Bearer {owner_token}"},
            files={
                "file": (
                    "private.json",
                    json.dumps(
                        {
                            "questions": [
                                {
                                    "module": "reading",
                                    "task_type": "short_answer",
                                    "prompt": unique_prompt,
                                }
                            ]
                        }
                    ),
                    "application/json",
                )
            },
        )

        viewer = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"viewer-{uuid4()}@example.com",
                "password": "test-password-123",
            },
        ).json()["access_token"]
        response = client.get(
            f"/api/v1/question-bank/questions?search={unique_prompt}",
            headers={"Authorization": f"Bearer {viewer}"},
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0


def test_user_can_create_a_question_with_the_form_endpoint() -> None:
    with TestClient(app) as client:
        token = client.post("/api/v1/auth/demo").json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        prompt = f"Complete the note with one word: {uuid4()}"
        created = client.post(
            "/api/v1/question-bank/questions",
            headers=headers,
            json={
                "module": "listening",
                "task_type": "form_completion",
                "question_type": "short_answer",
                "source_name": "My listening set",
                "passage": "The booking is for Thursday.",
                "prompt": prompt,
                "correct_answer": "Thursday",
                "tags": ["form practice"],
            },
        )

        assert created.status_code == 201
        assert created.json()["is_public"] is False
        assert created.json()["source_name"] == "My listening set"
        found = client.get(
            f"/api/v1/question-bank/questions?search={prompt}", headers=headers
        )
        assert found.status_code == 200
        assert found.json()["total"] == 1


def test_attempt_grading_progress_and_wrong_question_review() -> None:
    with TestClient(app) as client:
        token = client.post("/api/v1/auth/demo").json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        questions = client.get(
            "/api/v1/question-bank/questions?module=reading&page_size=50",
            headers=headers,
        ).json()["items"]
        question = next(item for item in questions if item["options"])

        wrong = client.post(
            f"/api/v1/question-bank/questions/{question['id']}/attempts",
            headers=headers,
            json={"answer": "deliberately wrong"},
        )
        assert wrong.status_code == 201
        assert wrong.json()["is_correct"] is False
        assert wrong.json()["correct_answer"]
        assert wrong.json()["explanation"]

        wrong_review = client.get(
            "/api/v1/question-bank/questions?incorrect_only=true&page_size=50",
            headers=headers,
        ).json()
        assert question["id"] in {item["id"] for item in wrong_review["items"]}

        corrected = client.post(
            f"/api/v1/question-bank/questions/{question['id']}/attempts",
            headers=headers,
            json={"answer": wrong.json()["correct_answer"].split(" / ")[0]},
        )
        assert corrected.status_code == 201
        assert corrected.json()["is_correct"] is True
        assert corrected.json()["attempt_number"] == 2

        progress = client.get("/api/v1/question-bank/progress", headers=headers)
        assert progress.status_code == 200
        assert progress.json()["attempted_questions"] == 1
        assert progress.json()["correct_questions"] == 1
        assert progress.json()["incorrect_questions"] == 0

        other_token = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"progress-viewer-{uuid4()}@example.com",
                "password": "test-password-123",
            },
        ).json()["access_token"]
        other_progress = client.get(
            "/api/v1/question-bank/progress",
            headers={"Authorization": f"Bearer {other_token}"},
        ).json()
        assert other_progress["attempted_questions"] == 0
