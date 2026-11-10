"""Prepare the local IELTS/common-English starter deck from a pinned ECDICT snapshot."""

import argparse
import csv
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "backend/app/data/vocabulary"
REVISION = "39cfb9672c0906b63569e0453c2e6abfb9ab182a"
SOURCE_SHA256 = "d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default=REVISION, help="Upstream commit; defaults to the project's pinned snapshot")
    parser.add_argument("--force", action="store_true", help="Rebuild even when the local dictionary is ready")
    args = parser.parse_args()
    revision = args.revision
    artifact = OUTPUT / "starter.json"
    license_path = OUTPUT / "LICENSE.ecdict.txt"
    if artifact.exists() and license_path.exists() and not args.force:
        try:
            current = json.loads(artifact.read_text(encoding="utf-8"))
            if (current.get("revision") == revision and current.get("words")
                    and current.get("count") == len(current["words"])
                    and (revision != REVISION or current.get("source_sha256") == SOURCE_SHA256)):
                print(f"Vocabulary ready: {current['count']} words ({artifact.relative_to(ROOT)})")
                return
        except (ValueError, TypeError):
            pass
    base = f"https://raw.githubusercontent.com/skywind3000/ECDICT/{revision}"
    cache = ROOT / f"tmp/ecdict-{revision}.csv"
    cache.parent.mkdir(exist_ok=True)
    if not cache.exists():
        partial = cache.with_suffix(".csv.part")
        print(f"Downloading ECDICT snapshot {revision}...", flush=True)
        urllib.request.urlretrieve(f"{base}/ecdict.csv", partial)
        partial.replace(cache)
    source_hash = hashlib.sha256(cache.read_bytes()).hexdigest()
    if revision == REVISION and source_hash != SOURCE_SHA256:
        raise SystemExit(f"ECDICT checksum mismatch. Remove {cache} and run npm run setup:vocabulary again.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if revision != REVISION or not license_path.exists():
        with urllib.request.urlopen(f"{base}/LICENSE", timeout=30) as response:
            license_path.write_bytes(response.read())
    entries = {}
    with cache.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            word = row["word"].strip()
            if not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*", word) or not row["translation"].strip():
                continue
            tags = row.get("tag", "").split()
            frequency = min([int(row[key]) for key in ("frq", "bnc") if row.get(key, "").isdigit() and int(row[key]) > 0] or [999999])
            if "ielts" not in tags and row.get("oxford") != "1" and frequency > 6000:
                continue
            entries[word] = {
                "word": word,
                "meaning": row["translation"].replace("\\n", "\n").strip(),
                "phonetic": row.get("phonetic", ""),
                "part_of_speech": row.get("pos", ""),
                "tags": [tag for tag in tags if tag in {"ielts", "cet4", "cet6", "toefl"}],
                "frequency": frequency,
            }
    words = sorted(entries.values(), key=lambda item: (item["frequency"], item["word"]))
    data = {
        "source": "ECDICT", "license": "MIT", "revision": revision,
        "source_url": "https://github.com/skywind3000/ECDICT",
        "source_sha256": source_hash,
        "selection": "lowercase English headwords with IELTS tag, Oxford flag, or BNC/COCA rank <=6000",
        "count": len(words), "words": words,
    }
    partial_output = artifact.with_suffix(".json.part")
    partial_output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    partial_output.replace(artifact)
    print(json.dumps({key: value for key, value in data.items() if key != "words"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
