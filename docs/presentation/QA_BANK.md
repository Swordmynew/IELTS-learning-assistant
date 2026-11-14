# Q&A 准备

英文段落可用于课堂回答；中文提示用于内部准备，不放在展示页。回答先由负责成员给结论，其他人仅作必要补充。建议4分钟，普通问题控制在25–40秒。

## 1. Why use RAG instead of fine-tuning?

负责：C。

RAG lets us update reference documents and personal learning records without changing model weights. It also gives learners inspectable sources. We have not run a fine-tuning comparison, so this is a design rationale rather than a measured superiority claim.

中文提示：说明training-free、更新与来源；不能说已做对比证明更好。

## 2. What makes the system personalised?

负责：C。

The context includes the current user's mistakes, notes, topics and review events. The same question can therefore retrieve different personal evidence for different users. Self-review is stored separately from objective attempts.

中文提示：举information笔记或错题的例子；不是每用户训练独立模型。

## 3. Is the study plan driven by RAG?

负责：D。

The current planner uses rule-based diagnosis, task templates and constraint solving. The graph has a retrieval node, but that result does not yet select the tasks. RAG is used in tutoring and writing context.

中文提示：直接承认retrieve未参与排程，不混淆Agent与RAG。

## 4. How do you prevent hallucinations?

负责：C / F。

We limit generation to selected evidence, validate citation identifiers and preserve exact source excerpts. These checks reduce specific failure modes; they do not prove that every claim is semantically supported. A manual citation audit is still needed.

中文提示：程序ID校验和语义支持是两类证据。

## 5. Has the real model been tested?

负责：F。

The recorded local acceptance tests use offline generation and hashing embeddings. Live model adapters exist, but real generation quality and semantic retrieval quality have not yet been validated in this environment.

中文提示：若演示前实际补验收，只能根据新增记录更新这句，不能预先改成通过。

## 6. What does the offline writing example show?

负责：E。

It is a fixed original example of draft revision and progressive hints. It is clearly labelled and does not grade the essay entered during the demonstration or count as a personal learning result.

中文提示：必须指出固定原创，不演假实时调用。

## 7. How is private data isolated?

负责：B。

The API resolves the user from the authenticated session and filters visible records before retrieval. Private source-file routes also enforce ownership. The current tests cover selected cross-user access cases, not a full independent security audit.

中文提示：不直接承诺绝对安全或整套合规认证。

## 8. What happens after a note is edited?

负责：C。

The personal knowledge revision changes. Relevant exact-context caches are invalidated, older contexts can become stale, and a revision guard prevents newly generated results from being saved against changed memory.

中文提示：可用编辑笔记后重新检索的行为解释。

## 9. Why does a plan require approval?

负责：D。

A learner should inspect the generated schedule before it replaces the active plan. Approval rechecks constraints and freshness. Transactions and a unique index enforce one approved plan per user.

中文提示：举修改画像后旧草案不能启用。

## 10. What do 152 tests and 20 browser flows prove?

负责：F。

They check defined software behaviours such as scheduling, approval, memory operations and source access. Fourteen browser flows mock interfaces and six use the real offline API. They do not measure learning gains or examiner agreement.

中文提示：152/20是既有验收记录，不是模型准确率。

## 11. Can it read scanned PDFs or score speaking?

负责：B / E。

Text-based PDF extraction and page references are supported. OCR and independent speech scoring are not implemented in the current branch. Optional DOCX parsing and production service paths still need environment validation.

中文提示：不要把偏好中的听力语速说成完整语音评分能力。

## 12. How are the test materials licensed?

负责：A / B。

The starter dictionary comes from a pinned ECDICT snapshot with its MIT licence. The demonstration questions and offline writing example are project-original synthetic material. Private documents require an appropriate source and permission.

中文提示：官方评分摘要是短篇释义和链接，不是完整授权官方题库。

## 13. What is the main limitation and next step?

负责：F。

We need real-provider and embedding validation, authorised data with manual review, and deployment and recovery checks. Some legacy capabilities are archived and require compatible migration before integration.

中文提示：未验收项目按优先级解释，不虚构提分、成本或线上运行。

## 14. What does training-free mean here?

负责：C。

The application supplies retrieved context and structured instructions at inference time. We do not update model weights for this application. Constraint solving is a separate deterministic component.

中文提示：不把前端用户练习叫训练大模型。

## 15. How did the six members contribute?

负责：A / All。

We will describe each member's actual work using our confirmed contribution record. The presentation responsibility table is a preparation plan and should not be used as evidence of past implementation work.

中文提示：成员姓名和历史贡献待小组确认，不按演讲角色反推谁写了代码。
