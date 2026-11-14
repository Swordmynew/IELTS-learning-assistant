# 英文 PPT 逐页内容与中文讲稿

展示页全部英文；中文备注不投屏。12页主内容15分钟，第13页Q&A另4分钟。

## 1. IELTS Adaptive Coach

成员：A；时间：30秒。

### 展示页英文

Personal learning with source-grounded retrieval

- **Group 20** — A training-free application for IELTS Academic practice

### 中文讲稿与证据

开场：项目把学习目标、练习事实和可核对的来源连接起来。今天展示可运行的本地学习闭环。提前说明当前现场用离线预览；固定示例不会冒充对新作文的实时模型输出。

来源：`README.md; Guidance.md`。

## 2. The learning scenario

成员：A；时间：90秒。

### 展示页英文

Practice records and useful advice are often separated

- **Learner** — An IELTS Academic candidate with limited study time
- **Practical need** — Keep mistakes, notes and reference material available during practice
- **Proposed value** — Use past evidence to support the next learning decision

### 中文讲稿与证据

先讲使用场景，不宣称已经做过用户调研。假设备考者每天时间有限，错误散落在不同练习。系统提供目标、可审批安排、练习与个人记忆。价值是设计目标，尚未证明提分。转交 B 解释实现。

来源：`docs/guides/USER_GUIDE.md`。

## 3. System architecture

成员：B；时间：60秒。

### 展示页英文

A shared API connects the learning workspaces

- **Next.js** — Profile, plan, vocabulary, question bank, writing and knowledge pages
- **FastAPI + SQLite** — Authenticated records, document chunks and persisted learning events
- **Services** — LangGraph, OR-Tools, retrieval and configurable model adapters

### 中文讲稿与证据

解释前端页面通过同源代理请求 FastAPI，事实和派生知识保存在本机 SQLite。routes 按 core、coach、documents、memory、vocabulary 归类；services 放算法。PG、Redis、Docker 仅是已有配置路径，尚未实测，不能说当前演示已在生产架构部署。

来源：`backend/app/main.py; backend/app/routes/; docs/development/ARCHITECTURE.md`。

## 4. The learning loop

成员：B；时间：60秒。

### 展示页英文

A practice result becomes evidence for later use

- **Plan and practise** — Set goals, approve a draft and complete a learning activity
- **Collect and review** — Keep mistakes, source excerpts, notes and revision events
- **Retrieve and continue** — Find relevant evidence, inspect its source and return to practice

### 中文讲稿与证据

依次指明记录来自客观题、词卡或作文，再进入个人知识。原始事实和笔记分开；自评只表示用户自报状态。公共文档与私人知识分别标明身份，不把个人笔记当官方标准。转交 C 讲个性化检索。

来源：`backend/app/services/learning_memory.py; backend/app/services/personal_knowledge.py`。

## 5. Personal learning memory

成员：C；时间：75秒。

### 展示页英文

Mistakes and fragments retain their provenance

- **Capture** — Question errors, writing issues, manual notes and exact quotations
- **Organise** — Topic tags, linked items and separate practice or self-review events
- **Maintain** — Edit, merge and delete notes while preserving practice facts

### 中文讲稿与证据

说明个性化不是训练模型，也不把一次自评当掌握。规则生成的标签可以编辑。原文收藏保留逐字快照、文档页码或原题链接；修改笔记与原始证据分开。准备 information 不可数名词笔记作为演示素材。

来源：`backend/app/routes/memory.py; backend/app/services/learning_memory.py`。

## 6. Personalised RAG

成员：C；时间：75秒。

### 展示页英文

Retrieval-augmented generation uses evidence without changing model weights

- **Find evidence** — Filter by user access; combine vector, keyword and learning-state signals
- **Ground the model** — Put bounded evidence into the prompt and validate returned citation IDs
- **Update without training** — Refresh documents and personal memory; invalidate stale answer contexts

### 中文讲稿与证据

解释先做用户可见性过滤，再取候选与排序。预览 hashing 不代表语义向量质量。总证据默认18000字符、每来源5000字符。引用ID校验并不能证明句句被语义支持。未配置模型时助手仍返回检索来源，不伪造生成结果。转交 D。

来源：`backend/app/services/search_repository.py; backend/app/services/retrieval_context.py; backend/app/services/coach_model.py`。

## 7. Constrained study planning

成员：D；时间：90秒。

### 展示页英文

The schedule must fit the learner calendar

- **Workflow** — Intake, diagnosis, retrieval, planning and validation
- **Constraints** — Daily capacity, workload limits and a horizon before the exam
- **Solver** — OR-Tools CP-SAT with a validated deterministic fallback

### 中文讲稿与证据

说明任务模板和差距规则确定候选，CP-SAT负责容量与训练约束；最多7天且不排考试当天。任务不一定填满所有空闲时间。不把 retrieve 说成 RAG 驱动规划：当前检索结果还没有用于任务选择。

来源：`backend/app/agents/workflow.py; backend/app/services/planner.py`。

## 8. Draft approval and reliability

成员：D；时间：60秒。

### 展示页英文

A generated schedule becomes active after approval

- **Human control** — Inspect a draft before enabling it; reject conflicting schedules
- **Freshness checks** — Detect changed profiles and a different active plan
- **Transaction safety** — Idempotent approval and one active plan per user

### 中文讲稿与证据

用档案改了但还审批旧草案的例子解释为什么要检查签名和基准计划。数据库唯一索引与用户级事务串行化负责并发边界，不由模型决定批准。任务完成可以恢复。讲完交给 E，E 始终操作同一电脑。

来源：`backend/app/repository.py; backend/alembic/versions/0008_plan_approval_guard.py`。

## 9. Live demonstration

成员：E；时间：180秒。

### 展示页英文

A mistake enters the personal retrieval workflow

- **Start** — Inspect a profile, generate a draft and approve the plan
- **Practise** — Reveal a word and submit one synthetic reading answer
- **Inspect** — Find the captured error, retrieve a note and check a source

### 中文讲稿与证据

切到浏览器执行 DEMO_RUNBOOK_ZH 的0:00至3:00。使用演示账号、原创题与预置笔记。故意答错需明确说明是操作样例。先预热页面，避免现场首次编译。若模型未连接，明确展示检索结果和离线提示。保持一个操作人，其他成员不要抢鼠标。

来源：`docs/presentation/DEMO_RUNBOOK_ZH.md; frontend/tests/personal-memory.spec.ts; frontend/tests/reliability.spec.ts`。

## 10. Writing and the evidence boundary

成员：E；时间：60秒。

### 展示页英文

Revision support is visible in a fixed offline example

- **Version 1** — "However, it helps students get jobs."
- **Feedback** — The two reasons support the same claim; the contrast is unsupported
- **Version 2** — A specific beneficiary and example replace the invalid contrast

### 中文讲稿与证据

执行操作单余下1分钟：看来源片段，打开离线写作示例V1、方向提示、V2，再看助手离线检索反馈。英文句子来自项目固定原创示例。它不是对现场新作文生成的真实批改，也不计入个人成绩。若使用真实模型，必须提前验证且展示实际模式标记。转交F。

来源：`backend/app/services/coach_demo.py; docs/guides/DEMO_WALKTHROUGH.md`。

## 11. What has been verified

成员：F；时间：75秒。

### 展示页英文

Local functional checks use synthetic test data

- **152 backend tests** — Planning, approval, personal memory, PDF sources and migration checks
- **20 browser flows** — 14 mocked-interface checks and 6 real offline API flows
- **Build and contracts** — Type checks, production build and 62 retained API method/path pairs

### 中文讲稿与证据

数字来自2026-11-14本地整理验收，不是此次README更新新做的模型评测。20条包括14模拟和6真实离线API，避免全说成真实模型E2E。没有人工评分一致率、检索准确率或真人提分结论。程序测试只能支持对应行为的正确性。

来源：`docs/validation/REORGANIZATION_SUMMARY.json; docs/validation/REORGANIZATION_2026-11-14.md`。

## 12. Benefits and next steps

成员：F；时间：45秒。

### 展示页英文

The prototype connects practice with inspectable personal evidence

- **Current benefit** — A working interface for planning, collecting mistakes and checking sources
- **Next validation** — Real generation, semantic embeddings and manually reviewed evaluation data
- **Further work** — Deployment checks and compatible integration of archived legacy features

### 中文讲稿与证据

总结价值是闭环与来源可核对，不夸大为已经实测改善成绩。旧0012独有功能仍待兼容移植，不能说已经全部融合。真实模型、PG/Redis/Docker、公网与恢复仍待验收。结束后进入Q&A，A分配问题，F计时。

来源：`docs/development/HANDOVER.md; docs/validation/REORGANIZATION_SUMMARY.json`。

## 13. Questions & answers

成员：All；时间：240秒。

### 展示页英文

Personalisation, retrieval, planning and validation

- **Personalisation** — What changes in the context when a learner makes mistakes?
- **Reliability** — How are access control, stale evidence and approval handled?
- **Evidence** — What has been tested, and what still needs measurement?

### 中文讲稿与证据

本页保持显示4分钟。A按领域分派，C负责RAG，D负责计划，B负责架构与权限，E负责界面操作，F负责验证。回答先给结论，再举一个代码或演示证据；超出证据时直接说明未验证，不编造模型效果。

来源：`docs/presentation/QA_BANK.md`。
