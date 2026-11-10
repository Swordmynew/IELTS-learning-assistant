# Learning material and privacy policy

## Allowed content

- Links and short paraphrases derived from publicly accessible official IELTS guidance.
- Original prompts and exercises written for this repository.
- Project-authored English words and pseudowords used by the vocabulary prototype.
- ECDICT dictionary subset generated locally by the environment setup under its MIT license; the fixed upstream revision and SHA-256 are in the importer, and the generated JSON records its provenance and selection rule. The license text is tracked in Git and must accompany any distributed generated vocabulary.
- Files uploaded by a user who confirms they are entitled to use them privately.

## Disallowed content

- Scraped or redistributed Cambridge IELTS books and commercial test banks.
- Public sharing of another user's upload or generated derivative question bank.
- Training or evaluation claims based on material whose provenance is unknown.
- Reproduction of proprietary or externally published vocabulary-test item sets without an explicit compatible license.

Each document records `owner_id`, source URL, filename, license type and ingestion status. Public records have no owner; private records always do. Deleting a user must cascade to their documents, chunks, plans and assessments.

Uploaded text is untrusted data. It may supply evidence but cannot change system policies, tool permissions or identity filters. Production deployments should add malware scanning, object-store retention rules, deletion/export endpoints and a published privacy notice.

## Personal learning records

Wrong real-word responses, objective-question mistakes and writing issues can produce private knowledge entries. These preserve links to original learning records. Entries are available automatically without per-item confirmation. Learner edits and notes do not change original answers. Expanded vocabulary entries show a concise source description linked to their practice. Knowledge entries can be edited, merged or deleted. Deletion removes their vector and active retrieval entry but retains the original practice history and historical conversations. Tombstones prevent backfill from recreating deleted entries.

Generated caches are private to one user and keyed by exact context and knowledge revision. Editing or deleting knowledge makes old-context caches ineligible for a new request. Cache rows and historical messages remain stored locally; deployment-wide retention and full account export/deletion workflows are still future work. No cache or provider request logs contain API keys, and application logs omit full essays. Relevant retrieved learning records are sent to DeepSeek only as part of a requested AI operation.

The fixed offline example is clearly labelled synthetic. It is never inserted as the user's practice result, knowledge, vocabulary score or ability estimate. Browser fixtures and the live smoke script likewise use isolated synthetic data; successful algorithmic checks are not evidence of examiner calibration or learning gains.

## Vocabulary learning

The shared starter dictionary is read-only. Word progress, personal meanings, notes, writing quotations and extraction jobs are private to the current account. A requested essay assessment also schedules a separate DeepSeek vocabulary extraction request; the background request receives that essay and its task prompt. Explicit “积累词汇” requests use the same source ownership checks. Empty results add nothing. Word cards retain source links and can be edited or suspended; original essays and historical practice remain available. Review events store the learner's own recall choice and update a revision-checked schedule, without generating a vocabulary ability score. Only personal or forgotten study words create personal RAG knowledge entries; loading the shared dictionary does not index thousands of starter words into a learner's knowledge base.
