"""Exercise a real DeepSeek learning loop on an isolated, synthetic SQLite dataset."""

import argparse
import asyncio
import json
import os
import tempfile
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--attribution-only", action="store_true")
    mode.add_argument("--tutor-style-only", action="store_true")
    args = parser.parse_args()
    os.environ["VOCABULARY_WORKER_ENABLED"] = "false"
    filename = "coach-attribution-report.json" if args.attribution_only else "coach-live-report.json"
    if args.tutor_style_only:
        filename = "coach-tutor-style-report.json"
    report_path = Path(__file__).resolve().parents[2] / "tmp" / filename
    report_path.parent.mkdir(exist_ok=True)
    report = {
        "date": datetime.now(UTC).isoformat(),
        "dataset": "isolated-project-authored-synthetic",
        "checks": [],
    }

    def record(name, payload):
        report["checks"].append({"check": name, "status": "passed", "output": payload})
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="ielts-coach-") as directory, ExitStack() as cleanup:
        os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{Path(directory).as_posix()}/smoke.db"
        from fastapi.testclient import TestClient

        from app.config import get_settings
        from app.db import engine
        from app.main import app
        from app.services.coach_demo import DEMO

        cleanup.callback(lambda: asyncio.run(engine.dispose()))

        settings = get_settings()
        if not settings.coach_api_key:
            raise RuntimeError(
                "Configure COACH_API_KEY in the root .env before running this smoke check"
            )
        with TestClient(app) as client:
            registration = client.post(
                "/api/v1/auth/register",
                json={"email": "synthetic-smoke@example.com", "password": "SyntheticSmoke123"},
            )
            headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}
            if args.tutor_style_only:
                from app.db import SessionLocal
                from app.services.personal_knowledge import put_knowledge

                user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
                writing = client.post(
                    "/api/v1/writing/sessions", headers=headers, json={"prompt": DEMO["prompt"]}
                ).json()
                essay = "If governments cover every student's fees, they may have less money available for schools, public transport and other services."
                version = client.post(
                    f"/api/v1/writing/sessions/{writing['id']}/versions",
                    headers=headers, json={"essay": essay},
                ).json()

                async def seed_style_note():
                    async with SessionLocal() as session:
                        await put_knowledge(
                            session, user_id, "synthetic-style-note", "句式多样性",
                            f"原句：{essay}\nAI 反馈：句子语法准确但以中等复杂度为主，复杂混合结构出现频率有限，句式多样性有提升空间。\n目标：根据论证需要组合句子。",
                            "writing", "writing",
                            f"/writing?session={writing['id']}&version={version['id']}",
                            event_id=version["id"],
                        )
                        await session.commit()

                client.portal.call(seed_style_note)
                question_text = "我的句子使用有什么特点？如何改进？"
                for name, path in (
                    ("knowledge_tutor_style", "/api/v1/rag/query"),
                    ("writing_tutor_style", f"/api/v1/writing/versions/{version['id']}/questions"),
                ):
                    response = client.post(path, headers=headers, json={"query": question_text})
                    response.raise_for_status()
                    answer = response.json()
                    if answer["mode"] != "live" or not answer["citations"]:
                        raise RuntimeError(f"{name} did not return a live cited answer")
                    for boilerplate in ("不代表", "官方评价", "唯一直接证据", "确认状态", "需要注意：", "AI 对你句子的反馈是", "AI对你句子的反馈是", "不能代表", "不能据此", "稳定习惯", "稳定特征", "提供更多"):
                        if boilerplate in answer["answer"]:
                            raise RuntimeError(f"{name} repeated boilerplate: {boilerplate}")
                    record(name, answer)
                    print(json.dumps({"check": name, "answer": answer["answer"]}, ensure_ascii=False), flush=True)
                return
            question = client.post(
                "/api/v1/question-bank/questions",
                headers=headers,
                json={
                    "module": "reading",
                    "task_type": "multiple_choice",
                    "prompt": "What does however express between these sentences?",
                    "passage": "University grants improve access. However, they require public funding.",
                    "correct_answer": "contrast",
                    "explanation": "However marks a contrast rather than a cause.",
                    "source_name": "Original synthetic smoke exercise",
                },
            ).json()
            client.post(
                f"/api/v1/question-bank/questions/{question['id']}/attempts",
                headers=headers,
                json={"answer": "cause"},
            ).raise_for_status()
            if args.attribution_only:
                response = client.post(
                    "/api/v1/rag/query", headers=headers,
                    json={"query": "根据我的 however 错题记录，写作时应该注意什么？请说明解释来自哪里。", "source_type": "mistake"},
                )
                response.raise_for_status()
                answer = response.json()
                if answer["mode"] != "live" or not answer["citations"]:
                    raise RuntimeError("Attribution check did not return a live cited answer")
                if any(c["provenance"] != "personal-learning-record" for c in answer["citations"]):
                    raise RuntimeError("Personal source provenance was lost")
                record("personal_source_attribution", answer)
                print(json.dumps({"check": "personal_source_attribution", "answer": answer["answer"]}, ensure_ascii=False), flush=True)
                return
            writing = client.post(
                "/api/v1/writing/sessions", headers=headers, json={"prompt": DEMO["prompt"]}
            ).json()
            for index, item in enumerate(DEMO["versions"]):
                version = client.post(
                    f"/api/v1/writing/sessions/{writing['id']}/versions",
                    headers=headers,
                    json={"essay": item["essay"]},
                ).json()
                assessment = client.post(
                    f"/api/v1/writing/versions/{version['id']}/assess", headers=headers
                )
                assessment.raise_for_status()
                feedback = assessment.json().get("feedback")
                if not feedback or feedback["mode"] != "live":
                    raise RuntimeError(f"Version {index + 1} did not return live valid feedback")
                print(
                    json.dumps(
                        {
                            "check": f"writing_v{index + 1}",
                            "mode": feedback["mode"],
                            "issues": len(feedback["data"]["issues"]),
                            "comparisons": len(feedback["data"]["improvements"]),
                        }
                    ),
                    flush=True,
                )
                record(f"writing_v{index + 1}", feedback)
            query = {"query": "Task 2 如何保证段落连贯与衔接？"}
            answer = client.post("/api/v1/rag/query", headers=headers, json=query)
            answer.raise_for_status()
            data = answer.json()
            if data["mode"] != "live" or not data["citations"]:
                raise RuntimeError("RAG did not return a live cited answer")
            print(
                json.dumps(
                    {"check": "rag", "mode": data["mode"], "citations": len(data["citations"])}
                ),
                flush=True,
            )
            record("rag", data)
            personal = client.post(
                "/api/v1/rag/query",
                headers=headers,
                json={"query": "根据我在阅读中对 however 的错误理解，写作时应该注意什么？"},
            ).json()
            if personal["mode"] != "live" or not any(
                c["source_type"] == "mistake" for c in personal["citations"]
            ):
                raise RuntimeError(
                    "Cross-subject tutoring did not cite the synthetic reading record"
                )
            record("cross_subject", personal)
            print(
                json.dumps(
                    {
                        "check": "cross_subject",
                        "mode": personal["mode"],
                        "personal_source_cited": True,
                    }
                ),
                flush=True,
            )
            unsupported = client.post(
                "/api/v1/rag/query", headers=headers, json={"query": "我的下次航班几点起飞？"}
            ).json()
            if unsupported["citations"] or "不足" not in unsupported["answer"]:
                raise RuntimeError("Unanswerable request was not identified")
            record("insufficient_evidence", unsupported)
            settings.coach_offline = True
            replay = client.post("/api/v1/rag/query", headers=headers, json=query).json()
            if replay["mode"] != "cache":
                raise RuntimeError("Exact-context cache replay failed")
            print(json.dumps({"check": "offline_replay", "mode": replay["mode"]}), flush=True)
            record("offline_replay", replay)


if __name__ == "__main__":
    main()
