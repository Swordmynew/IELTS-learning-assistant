"""Live vocabulary extraction on a disposable, project-authored synthetic dataset."""

import asyncio
import json
import os
import tempfile
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path


def main():
    os.environ["VOCABULARY_WORKER_ENABLED"] = "false"
    report_path = Path(__file__).resolve().parents[2] / "tmp/word-learning-live-report.json"
    report = {"date": datetime.now(UTC).isoformat(), "dataset": "isolated-project-authored-synthetic", "checks": []}

    def record(name, data):
        report["checks"].append({"check": name, "status": "passed", "output": data})
        report_path.parent.mkdir(exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"check": name, "status": "passed"}), flush=True)

    with tempfile.TemporaryDirectory(prefix="ielts-words-") as directory, ExitStack() as cleanup:
        os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{Path(directory).as_posix()}/smoke.db"
        from fastapi.testclient import TestClient

        from app.config import get_settings
        from app.db import engine
        from app.main import app
        from app.services.vocabulary_extraction import process_one_job

        cleanup.callback(lambda: asyncio.run(engine.dispose()))
        settings = get_settings()
        if not settings.coach_api_key:
            raise RuntimeError("Configure COACH_API_KEY before running this check")
        with TestClient(app) as client:
            registered = client.post("/api/v1/auth/register", json={"email": "synthetic-words@example.com", "password": "SyntheticWords123"}).json()
            headers = {"Authorization": f"Bearer {registered['access_token']}"}
            parent = client.post("/api/v1/writing/sessions", headers=headers, json={"prompt": "Should university tuition be funded by the government?"}).json()

            def version(essay):
                response = client.post(f"/api/v1/writing/sessions/{parent['id']}/versions", headers=headers, json={"essay": essay})
                response.raise_for_status()
                return response.json()["id"]

            def extract(version_id, request_type="automatic"):
                response = client.post("/api/v1/vocabulary/extractions", headers=headers, json={"source_id": version_id, "request_type": request_type})
                response.raise_for_status()
                job_id = response.json()["id"]
                client.portal.call(process_one_job, job_id)
                jobs = client.get(f"/api/v1/vocabulary/extractions?source_id={version_id}", headers=headers).json()
                return next(job for job in jobs if job["id"] == job_id)

            first = version("Targeted grants can benifit low-income students. Governments should allocate public funding efficient, so that schools retain enough resources for teaching.")
            automatic = extract(first)
            if automatic["status"] != "completed" or automatic.get("mode") != "live":
                raise RuntimeError("Automatic extraction did not complete with live output")
            if not any(word["word"] == "benefit" and word["reason"] == "spelling" for word in automatic["words"]):
                raise RuntimeError("The original synthetic spelling mistake was missed")
            if not any(word["word"] == "efficiently" and word["reason"] == "usage" for word in automatic["words"]):
                raise RuntimeError("The original adjective/adverb usage mistake was missed")
            record("automatic_lexical_extraction", automatic)
            manual = extract(first, "requested")
            if manual["status"] != "completed":
                raise RuntimeError("Requested vocabulary extraction failed")
            record("requested_vocabulary", manual)
            deck = client.get("/api/v1/vocabulary/deck?scope=personal", headers=headers).json()
            if len({card["word"] for card in deck["items"]}) != deck["total"]:
                raise RuntimeError("Duplicate personal words were created")
            record("persistent_merged_deck", deck)
            empty = extract(version("I am here. You are here. We are here."))
            if empty["status"] != "completed" or empty["words"] != []:
                raise RuntimeError("Ordinary correct text should produce an empty vocabulary list")
            record("no_eligible_vocabulary", empty)
            settings.coach_offline = True
            offline = extract(version("A new synthetic exercise about sharing textbooks fairly among students."))
            if offline["status"] != "unavailable" or offline["words"]:
                raise RuntimeError("Unavailable extraction must not fabricate a word list")
            record("offline_no_fabrication", offline)


if __name__ == "__main__":
    main()
