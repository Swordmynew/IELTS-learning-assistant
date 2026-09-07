from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def test_registered_user_can_manage_account_preferences_and_password() -> None:
    email = f"learner-{uuid4()}@example.com"
    old_password = "initial-pass-123"
    new_password = "new-secure-pass-456"

    with TestClient(app) as client:
        registered = client.post(
            "/api/v1/auth/register",
            json={"display_name": "测试学习者", "email": email, "password": old_password},
        )
        assert registered.status_code == 201
        headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}

        account = client.get("/api/v1/auth/me", headers=headers)
        assert account.status_code == 200
        assert account.json()["display_name"] == "测试学习者"
        assert account.json()["preferences"]["compact_question_options"] is True

        preferences = {
            "default_start_page": "question-bank",
            "listening_rate": 1.1,
            "compact_question_options": False,
            "show_learning_details": True,
        }
        saved = client.put("/api/v1/settings", headers=headers, json=preferences)
        assert saved.status_code == 200
        assert saved.json() == preferences

        renamed = client.patch(
            "/api/v1/auth/me", headers=headers, json={"display_name": "新的昵称"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["display_name"] == "新的昵称"
        assert renamed.json()["preferences"] == preferences

        changed = client.post(
            "/api/v1/auth/change-password",
            headers=headers,
            json={"current_password": old_password, "new_password": new_password},
        )
        assert changed.status_code == 204
        assert client.post(
            "/api/v1/auth/login", json={"email": email, "password": old_password}
        ).status_code == 401
        assert client.post(
            "/api/v1/auth/login", json={"email": email, "password": new_password}
        ).status_code == 200


def test_demo_password_cannot_be_changed() -> None:
    with TestClient(app) as client:
        demo = client.post("/api/v1/auth/demo").json()
        response = client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {demo['access_token']}"},
            json={"current_password": "demo-account", "new_password": "other-password"},
        )
        assert response.status_code == 403
