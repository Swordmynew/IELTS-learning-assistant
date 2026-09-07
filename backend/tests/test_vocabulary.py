from fastapi.testclient import TestClient

from app.main import app
from app.services.vocabulary import (
    GUESSING_PARAMETER,
    ITEMS_BY_ID,
    build_estimate,
    estimate_theta,
    select_next_item,
)


def test_eap_estimate_moves_with_response_pattern() -> None:
    items = ["v012", "v014", "v016", "v018", "v020"]
    strong = [
        {
            "item_id": item_id,
            "selected_option": ITEMS_BY_ID[item_id].correct_index,
            "correct": True,
        }
        for item_id in items
    ]
    weak = [
        {"item_id": item_id, "selected_option": 3, "correct": False}
        for item_id in items
    ]
    assert estimate_theta(strong)[0] > estimate_theta(weak)[0]


def test_adaptive_selection_targets_different_difficulties() -> None:
    low = select_next_item("stable-session", -2.0, [])
    high = select_next_item("stable-session", 2.0, [])
    assert (low.correct_index == 4) == (high.correct_index == 4)
    assert low.difficulty < high.difficulty


def test_multiple_choice_scoring_tracks_none_of_above_items() -> None:
    responses = [
        {"item_id": "v014", "selected_option": 0, "correct": True},
        {"item_id": "v017", "selected_option": 2, "correct": False},
        {"item_id": "v023", "selected_option": 4, "correct": True},
    ]
    estimate = build_estimate(0.0, 0.7, responses)
    assert estimate.meaning_accuracy == 0.667
    assert estimate.none_of_above_accuracy == 0.5
    assert estimate.cefr_reference == "B2"
    assert estimate.calibration_status == "prototype_multiple_choice_parameters"
    assert GUESSING_PARAMETER == 0.2


def test_authenticated_user_can_finish_adaptive_vocabulary_test() -> None:
    with TestClient(app) as client:
        token = client.post("/api/v1/auth/demo").json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/api/v1/vocabulary/tests", headers=headers)
        assert response.status_code == 201
        test = response.json()

        while test["status"] == "in_progress":
            current = test["current_item"]
            answer = client.post(
                f"/api/v1/vocabulary/tests/{test['id']}/responses",
                headers=headers,
                json={
                    "item_id": current["id"],
                    "selected_option": ITEMS_BY_ID[current["id"]].correct_index,
                },
            )
            assert answer.status_code == 200
            test = answer.json()

        assert 15 <= test["answered"] <= 20
        assert test["result"]["calibration_status"] == "prototype_multiple_choice_parameters"
        assert test["result"]["meaning_accuracy"] == 1.0
        assert test["result"]["cefr_reference"] in {"A1", "A2", "B1", "B2", "C1", "C2"}
        assert test["current_item"] is None

        dashboard = client.get("/api/v1/dashboard", headers=headers).json()
        assert dashboard["latest_vocabulary_test"]["id"] == test["id"]

        plan = client.post("/api/v1/plans/generate", headers=headers)
        assert plan.status_code == 201
        assert test["result"]["cefr_reference"] in plan.json()["rationale"]
        assert any(task["skill"] == "vocabulary" for task in plan.json()["tasks"])
