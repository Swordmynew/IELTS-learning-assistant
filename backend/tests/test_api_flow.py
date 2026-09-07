from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def test_demo_user_can_complete_core_learning_loop() -> None:
    with TestClient(app) as client:
        token_response = client.post("/api/v1/auth/demo")
        assert token_response.status_code == 200
        headers = {"Authorization": f"Bearer {token_response.json()['access_token']}"}

        dashboard = client.get("/api/v1/dashboard", headers=headers)
        assert dashboard.status_code == 200
        assert dashboard.json()["profile"]["target_scores"]["writing"] == 7.0

        plan_headers = {**headers, "Idempotency-Key": f"api-flow-test-{uuid4()}"}
        plan_response = client.post("/api/v1/plans/generate", headers=plan_headers)
        assert plan_response.status_code == 201
        plan = plan_response.json()
        assert plan["status"] == "draft"
        assert plan["tasks"]

        repeated = client.post("/api/v1/plans/generate", headers=plan_headers)
        assert repeated.json()["id"] == plan["id"]

        draft_task_id = plan["tasks"][0]["id"]
        draft_completion = client.post(
            f"/api/v1/tasks/{draft_task_id}/complete", headers=headers
        )
        assert draft_completion.status_code == 404

        approved = client.post(
            f"/api/v1/plans/{plan['id']}/approve",
            headers=headers,
            json={"approved": True},
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "approved"

        first_task_id = approved.json()["tasks"][0]["id"]
        completed = client.post(f"/api/v1/tasks/{first_task_id}/complete", headers=headers)
        assert completed.status_code == 200
        active_dashboard = client.get("/api/v1/dashboard", headers=headers).json()
        assert active_dashboard["total_tasks"] == len(approved.json()["tasks"])
        assert active_dashboard["completed_tasks"] == 1

        restored = client.post(f"/api/v1/tasks/{first_task_id}/restore", headers=headers)
        assert restored.status_code == 200
        assert restored.json()["completed"] is False
        restored_dashboard = client.get("/api/v1/dashboard", headers=headers).json()
        assert restored_dashboard["completed_tasks"] == 0

        essay = (
            "Education improves opportunity because it gives people useful skills. "
            "However, governments also need to fund hospitals and transport. "
            "A balanced policy can therefore support students who need help. "
            "This approach is fair and financially sustainable. "
            "Universities can also provide scholarships for strong applicants. "
            "In conclusion, targeted support is better than an unlimited promise."
        )
        assessment = client.post(
            "/api/v1/writing/assessments",
            headers=headers,
            json={
                "task_type": "writing_task_2",
                "prompt": "University education should be free. To what extent do you agree?",
                "essay": essay,
            },
        )
        assert assessment.status_code == 201
        assert len(assessment.json()["criteria"]) == 4
        assert assessment.json()["model_used"] == "deterministic-demo-baseline"

        rag = client.post(
            "/api/v1/rag/query",
            headers=headers,
            json={"query": "段落逻辑和连接词属于哪个评分维度？"},
        )
        assert rag.status_code == 200
        assert rag.json()["citations"]
        assert "portable" in rag.json()["retrieval_mode"]
