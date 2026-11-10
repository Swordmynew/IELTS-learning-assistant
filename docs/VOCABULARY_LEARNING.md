# Vocabulary learning

The vocabulary page is a learning deck. Choose **开始学习**, recall the word, reveal its meaning, and select **忘了 / 模糊 / 记住了**. Each card can show the learner's original sentence and correction, with a link back to the exact practice. Meanings and notes are editable; suspended words can be restored from **已搁置**. Reading the starter deck and reviewing words require no model request.

## Local starter dictionary (environment resource)

- Source: [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT), upstream commit `39cfb9672c0906b63569e0453c2e6abfb9ab182a`.
- License: MIT, preserved verbatim at `backend/app/data/vocabulary/LICENSE.ecdict.txt`.
- Upstream CSV SHA-256: `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`.
- Selection: lowercase English headwords with an IELTS tag, Oxford flag, or BNC/COCA rank at most 6,000, with nonempty Chinese translation.
- Result: **8,520** unique headwords, including **4,972** tagged IELTS entries. The resulting JSON is about 2.3 MB and is generated at `backend/app/data/vocabulary/starter.json`, ignored by Git.

The dictionary's own labels and frequency ranks determine selection; no numerical IELTS coverage claim is inferred from these counts. Study ordering favours IELTS-tagged words with frequency rank at least 800, then other words beyond the most frequent function words. The full selection remains searchable. Prepare the dictionary before starting the application. The backend reads the generated JSON locally and makes no dictionary download during study. A missing file returns HTTP 503 with the setup command.

From the repository root (Node.js 22+ and Python 3.11–3.14; no root npm dependencies):

```powershell
npm run setup:vocabulary
# Optional: regenerate from the cached CSV rather than reuse the generated JSON.
npm run setup:vocabulary -- --force
```

The npm wrapper uses `backend/.venv` when present, otherwise system `python` on Windows or `python3` on other platforms. Its Python importer uses only the standard library. The default upstream revision is pinned, not upstream master. It verifies the source CSV SHA-256 before writing the JSON and uses a temporary file before replacing the output. Matching generated files are reused without network access; source CSVs are cached under ignored `tmp/`, keyed by revision. The license is tracked separately and retained alongside the generated dictionary. The importer never executes upstream code. Direct Python invocation is also supported: `python backend/scripts/import_starter_vocabulary.py` from the repository root. An explicit `--revision` is for deliberate source updates; update the documented pin/hash and validation when adopting one.

Fresh clones must run setup before backend tests or local study. CI runs the npm command, and Docker builds invoke the same Python importer before packaging the backend. Initial downloads require network access to `raw.githubusercontent.com`; after preparation, dictionary study is offline. Distribute the generated JSON together with its MIT license when preparing an offline installation. The FastEmbed model is a separate downloaded resource: warm its local cache before offline semantic retrieval. DeepSeek keys are needed for fresh AI extraction, not dictionary generation or word review; see [README environment setup](../README.md#不使用-docker).

## Independent writing extraction

Task 2 version assessments and the single-assessment writing route enqueue automatic extraction after persisting the assessment. The version route also queues extraction when the model cannot grade a saved draft. The grading response does not wait for vocabulary generation. The default local worker runs inside the API process; no Redis, Docker or additional server is needed.

Automatic extraction and learner-requested accumulation are separate request types (`vocabulary_extract` and `vocabulary_suggest`). They use separate schemas and prompts from essay feedback. Maximum output is eight automatic or twelve requested entries, and `{ "words": [] }` is a successful result. There is no minimum list length. Each entry includes:

- Correct English word or short phrase, Chinese meaning and part of speech.
- Reason: spelling, usage, or useful vocabulary to accumulate.
- Exact original form and essay quotation, a concrete explanation and a new example sentence.

The server checks that quotations and original forms occur in the saved essay. A valid dictionary word changed to another form is treated as a usage issue rather than a spelling mistake. These structural checks complement the model's explanation; users can correct a card's meaning and note directly.

Jobs are idempotent for the user, source, and request type. The worker claims jobs with a conditional update and a lease (at least five minutes, extended for longer model timeouts), requeues interrupted work on orderly shutdown, and recovers expired leases after an unexpected exit. Statuses are queued, running, completed, unavailable, and failed. Failed/unavailable jobs are retried explicitly without regrading. Valid exact-context cache entries may be used during model failure; a miss adds no words. `VOCABULARY_WORKER_ENABLED=false` disables automatic processing, useful for deterministic tests. The local SQLite setup uses WAL and a 30-second busy timeout to accommodate background and interactive writes. Running multiple API worker processes with SQLite is outside the local setup.

Normalized English keys merge repeated words and preserve every source. Re-extracting the same writing event does not reset an existing review schedule. A new actual mistake can bring the word back into review. User edits and suspension survive later extraction. Cards are private overlays on the shared dictionary; new words and phrases are persisted in the account's database, while the generated starter JSON stays shared and read-only. Personal words are indexed into the existing RAG knowledge base.

## Review scheduling

The study queue chooses overdue personal practice words first, then other overdue cards, then up to ten new words, with a batch limit of twenty. A single word can also be opened from the dictionary. The following is a simple recall-based schedule:

| Choice | Next review |
| --- | --- |
| 忘了 | In 10 minutes; reset the day interval. |
| 模糊 | At least one day; previous interval multiplied by 1.2 and rounded. |
| 记住了 | One day initially, then at least three days and about 2.3 times the previous interval, capped at 90 days. |

Review events carry an idempotency ID and expected card revision. Repeated network submission does not count twice, and stale browser tabs cannot overwrite newer progress. The weekly planner now creates vocabulary review tasks using due-card and personal-word counts, without using the old ability estimate. Existing diagnostic history can still be opened through old source links. Historical wrong answers to real words import into the deck, including old “none of the above” items whose meanings now come from the local dictionary; nonwords are excluded.

## Verification

Final local verification on 2026-11-11 (Asia/Hong_Kong) passed backend lint and **56 tests**, including fourteen new vocabulary scenarios. Frontend build/type checking passed and **7 browser tests** passed, including word-card reveal/review persistence, the independent writing request, and a 390px layout check. Restarted local services returned healthy responses, and the authenticated deck API reported 8,520 starter entries.

`backend/scripts/smoke_word_learning.py` runs real DeepSeek calls against a disposable SQLite database and original synthetic sentences. It checks actual spelling and grammatical-use extraction, explicit accumulation, persisted merged cards, an empty result for ordinary correct text, and offline non-fabrication. All **5 checks** passed. Full inspectable synthetic outputs are written to ignored `tmp/word-learning-live-report.json`. The first live run classified an adjective-to-adverb correction as spelling; the prompt and dictionary-based normalization were corrected and the five checks were rerun successfully. No synthetic word reviews or writing results were added to the user's real learning account.

```powershell
cd backend
.\.venv\Scripts\ruff.exe check app scripts tests
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider --disable-warnings
.\.venv\Scripts\python.exe scripts/smoke_word_learning.py
cd ../frontend
npm run build
npm run test:e2e
```
