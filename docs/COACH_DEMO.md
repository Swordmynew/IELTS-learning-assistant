# Personal IELTS Coach

## Local setup

The course build adds Task 2 revision coaching, a personal knowledge base and vocabulary learning. It uses training-free retrieval and structured generation. Writing sends a separate background vocabulary request; the **背单词** page combines a locally prepared dictionary with personal practice words. Listening and Reading feed personal records. Task 1 retains the single-assessment interface and also supports independent vocabulary accumulation. See [VOCABULARY_LEARNING.md](VOCABULARY_LEARNING.md).

Follow the complete [first-time installation steps](../README.md#不使用-docker): install Python 3.11–3.14 and Node.js 22+, create `backend/.venv`, install `backend/.[dev]`, and run `npm ci` in `frontend/`. From the repository root, run `npm run setup:vocabulary` to download and generate the ignored local dictionary. This step is required before word study and backend tests; it reuses ready files on later runs and does not need an API key. Copy `.env.example` to the root `.env` if it does not already exist, replace `JWT_SECRET`, and configure:

```env
COACH_API_KEY=your-key
COACH_BASE_URL=https://api.deepseek.com
COACH_MODEL=deepseek-chat
COACH_MAX_OUTPUT_TOKENS=6000
COACH_OFFLINE=false
VOCABULARY_WORKER_ENABLED=true
EMBEDDING_PROVIDER=fastembed
```

Use a model ID actually available to the account. `COACH_*` serves the new workspace through Chat Completions; `OPENAI_*` is the independent legacy Responses adapter. Keep keys out of source control. Only the context needed for an AI request is sent to the provider.

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe scripts/reembed_knowledge.py
cd ..
.\scripts\start-local.ps1
```

Open <http://localhost:3000>. `scripts/start-local.ps1 -Restart` restarts the process trees started by that script after backend/config changes. Logs and process IDs are under ignored `tmp/`. The API uses SQLite; no Docker or Redis is necessary for TXT/Markdown ingestion. PDF/DOCX still requires the existing optional Docling dependency; improving its page extraction is outside this release.

## Five-minute walkthrough

1. Register an account or enter the demo account. In **个人知识库**, use the circular import control to backfill previous learning records. New wrong real-word answers and objective-question mistakes accumulate automatically. Nonwords are excluded from the vocabulary knowledge base.
2. Open a knowledge card. Expand its original record, follow its source, or add a personal note. Entries are ready to use automatically. Expanded vocabulary entries include one compact source line. Same-type records can be selected and merged; subsequent answers still refresh the merged facts. Delete removes the knowledge entry and vector, while preserving the original practice history.
3. In **写作工作台**, create a Task 2 practice and submit an original essay. Use the exercise selector and version strip to switch saved drafts. Four criterion colors connect the score cards to highlights in the essay; click a margin annotation to expand its explanation on the right. Reveal thinking questions, directions and examples as needed.
4. Edit and submit a revision. Compare old/new quotations and the status of each earlier issue. Personal learning sources can inform advice; the public rubric alone supplies scoring authority. Only the initial version updates the aggregate Writing profile; later revisions remain visible in history and the overview.
5. Ask the tutor how a relevant Reading mistake or vocabulary misunderstanding applies to the essay. Expand the numbered sources. In **资料与笔记**, upload a TXT/Markdown note and select documents to constrain a query; leaving the selection empty enables cross-subject retrieval.

For a deterministic offline presentation, open **离线示例**. It contains original fixed essays, a vocabulary record and a Reading mistake, with two versions and progressive hints. It never submits these examples as the user's practice results.

## Failure and caching behavior

Live calls validate JSON and evidence, retry invalid structured output once, and use bounded provider retries for transport failures. A failed writing request retains its submitted draft so it can be retried.

Validated responses are cached per user. The cache key includes the operation, full relevant input/history, knowledge revision, prompt/schema version, model and provider address. A provider failure or `COACH_OFFLINE=true` can replay only an exact match. The UI labels it **历史缓存** and displays the original generation time. Changing notes or deleting a source invalidates previous-context caches. A cache miss exposes an independent **离线示例**, rather than presenting its result as feedback on the current input.

The new RAG path retrieves permission-filtered, completed documents and active personal knowledge using vectors plus keyword RRF. It uses the portable implementation on SQLite and PostgreSQL in this release; the older PostgreSQL FTS/vector helpers remain for existing deployment work. This is intended for a course-sized knowledge base, not a large corpus. Missing semantic models are explicitly marked as hashing demo fallback. RRF ranks are not confidence probabilities. The model can report insufficient evidence, and source IDs and exact writing quotations are validated server-side. These checks do not establish examiner-grade scoring or guarantee every generated explanation is correct.

## Reproducible validation

```powershell
cd backend
.\.venv\Scripts\ruff.exe check app tests scripts
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider
.\.venv\Scripts\python.exe scripts/smoke_local_embedding.py
.\.venv\Scripts\python.exe scripts/smoke_coach.py
# Optional focused live source-attribution check (separate report).
.\.venv\Scripts\python.exe scripts/smoke_coach.py --attribution-only
# Optional focused learner-facing response check (separate report).
.\.venv\Scripts\python.exe scripts/smoke_coach.py --tutor-style-only
cd ../frontend
npm run typecheck
npm run build
# Start the local servers before the browser tests.
npx playwright install chromium
npm run test:e2e
```

Automated backend checks use synthetic responses, in-memory SQLite, and no live keys. Browser fixtures are explicitly synthetic and test layout/interactions, not model quality. Screenshots go to ignored `tmp/`. The live smoke script uses its own temporary SQLite database and project-authored examples, checks initial/revised writing, cited RAG, cross-subject sources, insufficient evidence and offline cache replay, and saves inspectable synthetic outputs to `tmp/coach-live-report.json`. It never reads the developer's learning database.

The course validation register is [COACH_VALIDATION.md](COACH_VALIDATION.md). Broader retrieval benchmarks and human writing calibration in `EVALUATION.md` remain future work, not measured claims.
