"""Environment resource preparation without a network dependency in tests."""

import hashlib
import json

import pytest
from fastapi import HTTPException

from app.services import word_deck
from scripts import import_starter_vocabulary as importer


@pytest.fixture
def setup_dictionary(tmp_path, monkeypatch):
    output = tmp_path / "backend/app/data/vocabulary"
    output.mkdir(parents=True)
    (output / "LICENSE.ecdict.txt").write_text("Synthetic MIT license", encoding="utf-8")
    csv = "word,translation,phonetic,pos,tag,oxford,frq,bnc\nbenefit,益处,,n.,ielts,,1000,1000\nExcluded,排除,,n.,ielts,,1000,1000\n".encode()
    monkeypatch.setattr(importer, "ROOT", tmp_path)
    monkeypatch.setattr(importer, "OUTPUT", output)
    monkeypatch.setattr(importer, "SOURCE_SHA256", hashlib.sha256(csv).hexdigest())
    monkeypatch.setattr("sys.argv", ["import_starter_vocabulary.py"])
    return output, csv


def test_fresh_setup_downloads_pinned_snapshot_and_reuses_ready_dictionary(setup_dictionary, monkeypatch):
    output, csv = setup_dictionary
    downloads = []

    def download(url, path):
        downloads.append(url)
        path.write_bytes(csv)

    monkeypatch.setattr(importer.urllib.request, "urlretrieve", download)
    importer.main()
    artifact = output / "starter.json"
    original = artifact.read_bytes()
    data = json.loads(original)
    assert data["count"] == 1
    assert data["words"][0]["meaning"] == "益处"
    assert data["revision"] == importer.REVISION
    assert downloads == [f"https://raw.githubusercontent.com/skywind3000/ECDICT/{importer.REVISION}/ecdict.csv"]
    importer.main()
    assert len(downloads) == 1
    assert artifact.read_bytes() == original


def test_checksum_failure_preserves_existing_dictionary(setup_dictionary, monkeypatch):
    output, _ = setup_dictionary
    artifact = output / "starter.json"
    artifact.write_text('{"previous": true}', encoding="utf-8")
    monkeypatch.setattr(importer.urllib.request, "urlretrieve", lambda url, path: path.write_bytes(b"corrupt download"))
    with pytest.raises(SystemExit, match="checksum mismatch"):
        importer.main()
    assert json.loads(artifact.read_text()) == {"previous": True}


def test_missing_runtime_dictionary_reports_setup_command(tmp_path, monkeypatch):
    monkeypatch.setattr(word_deck, "__file__", str(tmp_path / "app/services/word_deck.py"))
    with pytest.raises(HTTPException) as error:
        word_deck.starter_data.__wrapped__()
    assert error.value.status_code == 503
    assert "npm run setup:vocabulary" in error.value.detail
