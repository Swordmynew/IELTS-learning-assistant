# Evaluation protocol

## Retrieval

The committed `evals/retrieval_gold.jsonl` is a smoke dataset for pipeline development. Before publishing resume metrics, expand it to at least 100 manually reviewed cases with:

- Chinese and English paraphrases;
- Task 1 and Task 2 distinctions;
- all four scoring criteria;
- deliberately unanswerable questions;
- expected source/chunk IDs and reviewer notes.

Run three fixed configurations against the same dataset:

1. vector-only top-k;
2. vector + full-text RRF;
3. vector + full-text RRF + reranker.

Report Recall@5, MRR, nDCG@10, citation correctness, p50/p95 latency and per-query cost. The release gate is Recall@5 ≥ 0.85 and citation correctness ≥ 0.95. If hybrid retrieval does not outperform vector-only, publish the negative result and failure analysis instead of claiming an improvement.

## Agent workflow

Trajectory fixtures should cover:

- the exact `intake → diagnose → retrieve → plan → validate` order;
- no approved state before an authenticated approval call;
- repeated idempotent generation returns the original plan;
- a new approval supersedes only previous approved plans;
- infeasible calendars return conflicts rather than overflowing daily capacity.

Report tool-call accuracy, goal completion, constraint pass rate, retries and token/cost totals. Hard calendar constraints must pass 100% of generated-property tests.

## Writing calibration

Use only official or explicitly licensed essays with human labels. Keep synthetic essays in a separate robustness set and never count them as human ground truth.

Report criterion-level MAE, overall MAE, agreement within ±0.5 band and failure slices for short, off-topic, memorized-looking and code-switched responses. Every published example must retain its license/source record.

## Result template

| Experiment | Dataset revision | Metric | Result | Date | Commit |
|---|---|---|---|---|---|
| Vector baseline | TBD | Recall@5 | Not measured | — | — |
| Hybrid RRF | TBD | Recall@5 | Not measured | — | — |
| Citation audit | TBD | Correctness | Not measured | — | — |
| Writing calibration | TBD | Overall MAE | Not measured | — | — |

## Vocabulary calibration

The vocabulary path must be evaluated separately from RAG and writing scoring. Before publishing a numeric vocabulary-size claim:

1. collect consented, anonymized item responses from the intended adult Chinese EFL population;
2. split calibration and validation samples before fitting item parameters;
3. report item fit, test information, conditional standard error and test-retest reliability;
4. inspect differential item functioning across relevant learner groups;
5. validate against an independently administered vocabulary measure and IELTS outcomes without claiming causation.

Until those steps are complete, report only algorithmic tests and label the UI result as a prototype estimate. The current 39-item bank is sufficient to demonstrate adaptive orchestration, not to establish psychometric validity.
