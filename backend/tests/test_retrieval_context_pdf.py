"""Synthetic retrieval and text-PDF fixtures; no licensed corpus or provider needed."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, KnowledgeChunkRow, KnowledgeDocumentRow, User
from app.ingestion import _chunk_text, _extract, _persist
from app.schemas import Citation
from app.services.rag import SearchHit, keyword_rank
from app.services.retrieval_context import bounded_history, pack_evidence, retrieval_question


def pdf_fixture(path: Path, pages: list[str | None], password=None):
    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(width=595, height=842)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            stream.set_data(f"BT /F1 12 Tf 40 700 Td ({escaped}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = writer._add_object(stream)
    if password:
        writer.encrypt(password)
    with path.open("wb") as file:
        writer.write(file)
    return path


def test_text_pdf_preserves_original_page_numbers_across_blank_pages(tmp_path):
    path = pdf_fixture(tmp_path / "pages.pdf", ["Countability rule on page one.", None, "Collocation example on page three."])
    chunks = _extract(path)
    assert [(page, text.strip()) for text, page in chunks] == [(1, "Countability rule on page one."), (3, "Collocation example on page three.")]


def test_encrypted_and_empty_pdf_do_not_silently_succeed(tmp_path):
    with pytest.raises(RuntimeError, match="加密"):
        _extract(pdf_fixture(tmp_path / "encrypted.pdf", ["Private synthetic fixture"], "fixture-password"))
    with pytest.raises(RuntimeError, match="没有可检索"):
        _extract(pdf_fixture(tmp_path / "blank.pdf", [None]))


    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    image = DecodedStreamObject()
    image.set_data(bytes([0, 0, 0]))
    image.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"), NameObject("/Width"): NumberObject(1), NameObject("/Height"): NumberObject(1), NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/BitsPerComponent"): NumberObject(8)})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): DictionaryObject({NameObject("/Im1"): writer._add_object(image)})})
    scanned = tmp_path / "image-only.pdf"
    with scanned.open("wb") as file:
        writer.write(file)
    with pytest.raises(RuntimeError, match="OCR"):
        _extract(scanned)


@pytest.mark.parametrize("text", ["词汇搭配" * 2000, "information " * 1800], ids=["chinese", "english"])
def test_oversized_paragraphs_are_split_with_bounded_size(text):
    chunks = _chunk_text(text)
    assert len(chunks) > 1 and all(len(chunk) <= 2100 for chunk in chunks)
    assert "".join(text.split()) == "".join("".join(chunks).split())


def test_followup_uses_previous_question_and_title_but_new_question_stays_independent():
    history = [{"query": "many information", "answer": "untrusted synthetic answer", "citations": [{"title": "Countability"}]}]
    assert "many information" in retrieval_question("那条规则再举个例子", history)
    assert "Countability" in retrieval_question("Explain that again", history)
    assert retrieval_question("make a decision collocation", history) == "make a decision collocation"
    assert retrieval_question("that rule", []) == "that rule"
    assert "untrusted synthetic answer" not in retrieval_question("那条规则", history)


def test_context_budget_trims_sources_to_actual_contiguous_text(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rag_evidence_chars", 2200)
    monkeypatch.setattr(get_settings(), "rag_source_chars", 640)
    text = "padding " * 900 + "countability evidence with exact original wording " + "tail " * 900
    hits = [SearchHit(str(uuid4()), "Synthetic evidence", text, None, None, 1.0) for _ in range(6)]
    citations = [Citation(source_id=hit.chunk_id, title=hit.title, excerpt=text[:320]) for hit in hits]
    selected, evidence = pack_evidence(citations, hits, "countability")
    assert selected and len(evidence) < len(hits)
    assert len(json.dumps(evidence, ensure_ascii=False)) <= 2200
    assert all(len(item["full_text"]) <= 640 and item["full_text"] in text and "countability" in item["full_text"] for item in evidence)
    assert all(citation.context_truncated and citation.excerpt in text for citation in selected)


def test_history_budget_omits_stale_context_and_bounds_messages():
    messages = [{"query": "obsolete", "answer": "do not reuse", "context_stale": True}]
    messages += [{"query": str(index) + "q" * 4000, "answer": "a" * 9000} for index in range(6)]
    history = bounded_history(messages, budget=3000)
    assert len(json.dumps(history, ensure_ascii=False)) <= 3000
    assert all(message["query"] != "obsolete" for message in history)
    assert history[-1]["query"].startswith("5")


def test_sparse_search_does_not_match_single_common_chinese_character_or_stopwords():
    unrelated = SearchHit("unrelated", "Synthetic unrelated", "不可数名词", None, None, 0)
    assert keyword_rank("如何使用过渡词", [unrelated]) == []
    assert keyword_rank("the and a is", [unrelated]) == []
    relevant = SearchHit("relevant", "Synthetic relevant", "不可数名词 information quantity", None, None, 0)
    assert keyword_rank("不可数名词 information", [unrelated, relevant])[0].chunk_id == "relevant"


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
async def test_ingestion_persists_pages_or_rolls_back_chunk_replacement(tmp_path, monkeypatch, fail):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'ingestion.db'}")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr("app.ingestion.SessionLocal", factory)

    async def embed(text, settings):
        if fail and "second" in text:
            raise RuntimeError("Synthetic embedding failure")
        return [0.0] * 384, "synthetic-fixture-vector"

    monkeypatch.setattr("app.ingestion.embed_text", embed)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        owner = str(uuid4())
        document_id = str(uuid4())
        async with factory() as session:
            session.add(User(id=owner, email=f"{uuid4()}@example.com", password_hash="synthetic-unused"))
            session.add(KnowledgeDocumentRow(id=document_id, owner_id=owner, title="Synthetic PDF", filename="fixture.pdf", status="queued"))
            await session.commit()
            session.add(KnowledgeChunkRow(document_id=document_id, owner_id=owner, chunk_index=0, content="original preserved chunk", page=7))
            await session.commit()
        path = pdf_fixture(tmp_path / "fixture.pdf", ["first page fixture", "second page fixture"])
        await _persist(document_id, path)
        async with factory() as session:
            document = await session.get(KnowledgeDocumentRow, document_id)
            chunks = list(await session.scalars(select(KnowledgeChunkRow).where(KnowledgeChunkRow.document_id == document_id).order_by(KnowledgeChunkRow.chunk_index)))
            if fail:
                assert document.status == "failed"
                assert len(chunks) == 1 and chunks[0].content == "original preserved chunk"
            else:
                assert document.status == "completed"
                assert [chunk.page for chunk in chunks] == [1, 2]
                assert all(chunk.owner_id == owner for chunk in chunks)
    finally:
        await engine.dispose()


def test_document_source_api_preserves_pages_and_protects_original_file(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app

    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr("app.api.enqueue_ingestion", lambda *args: False)
    path = pdf_fixture(tmp_path / "source.pdf", ["First synthetic page.", None, "Third synthetic page."])
    with TestClient(app) as client:
        def register():
            result = client.post("/api/v1/auth/register", json={"email": f"{uuid4()}@example.com", "password": "SyntheticSource123"})
            assert result.status_code == 201
            return {"Authorization": "Bearer " + result.json()["access_token"]}
        headers, other = register(), register()
        uploaded = client.post("/api/v1/knowledge/documents", headers=headers, files={"file": ("Synthetic-source.PDF", path.read_bytes(), "application/pdf")})
        assert uploaded.status_code == 202
        document_id = uploaded.json()["id"]
        chunks = client.get(f"/api/v1/knowledge/documents/{document_id}/chunks?page=3", headers=headers)
        assert chunks.status_code == 200
        assert chunks.json()["page_numbers"] == [1, 3]
        assert chunks.json()["original_available"] and chunks.json()["total"] == 1
        assert chunks.json()["items"][0]["content"].strip() == "Third synthetic page."
        original = client.get(f"/api/v1/knowledge/documents/{document_id}/file", headers=headers)
        assert original.status_code == 200 and original.content == path.read_bytes()
        assert original.headers["content-type"] == "application/pdf"
        for endpoint in ["file", "chunks"]:
            assert client.get(f"/api/v1/knowledge/documents/{document_id}/{endpoint}", headers=other).status_code == 404
            assert client.get(f"/api/v1/knowledge/documents/{document_id}/{endpoint}").status_code in {401, 403}
        assert client.get(f"/api/v1/knowledge/documents/{document_id}/chunks?page=0", headers=headers).status_code == 422


def test_duplicate_text_on_different_pdf_pages_keeps_selected_chunk_location(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app

    monkeypatch.setattr(get_settings(), "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr("app.api.enqueue_ingestion", lambda *args: False)
    path = pdf_fixture(tmp_path / "repeated.pdf", ["Repeated synthetic rule.", "Repeated synthetic rule."])
    with TestClient(app) as client:
        auth = client.post("/api/v1/auth/register", json={"email": f"{uuid4()}@example.com", "password": "SyntheticSource123"}).json()
        headers = {"Authorization": "Bearer " + auth["access_token"]}
        uploaded = client.post("/api/v1/knowledge/documents", headers=headers, files={"file": ("Repeated.pdf", path.read_bytes(), "application/pdf")}).json()
        chunks = client.get(f"/api/v1/knowledge/documents/{uploaded['id']}/chunks", headers=headers).json()["items"]
        body = {"source_type": "document", "source_id": uploaded["id"], "chunk_id": chunks[1]["id"], "excerpt": "Repeated synthetic rule."}
        second = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert second.status_code == 201 and second.json()["page"] == 2
        assert "page=2" in second.json()["source_link"]
        replay = client.post("/api/v1/knowledge/bookmarks", headers=headers, json=body)
        assert replay.json()["id"] == second.json()["id"]
        first = client.post("/api/v1/knowledge/bookmarks", headers=headers, json={**body, "chunk_id": chunks[0]["id"]})
        assert first.status_code == 201 and first.json()["page"] == 1 and first.json()["id"] != second.json()["id"]
        assert client.post("/api/v1/knowledge/bookmarks", headers=headers, json={**body, "chunk_id": str(uuid4())}).status_code == 404
