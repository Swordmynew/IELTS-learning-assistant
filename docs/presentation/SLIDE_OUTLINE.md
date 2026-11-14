# 演示版逐页内容与中文讲稿

共18页：17页主内容900秒，Q&A另240秒。英文标题与页面内容投屏，中文备注只供演讲者使用。图片链接指向本地页面，英文标签为展示译注。

## 1. IELTS Adaptive Coach

A guided product demonstration

主讲：A；时长：30秒；版式：cover。

中文讲稿：开场30秒：这次按真实操作而不是模块清单讲解。以合成用户Alex为例；截图来自本地离线运行，英文标签是展示译注，不代表产品已经国际化。

核对来源：README.md

## 2. Meet Alex: a synthetic learner

A target, a deadline and limited study time

主讲：A；时长：50秒；版式：case。

中文讲稿：这是真实保存到演示库的合成画像，不是用户研究对象。当前输入5.5、目标7.0，考试在30天后；不能暗示30天必然提到7分。右侧为档案实际画面。

核对来源：backend/app/routes/core.py

操作截图：[profile-targets](assets/demo/profile-targets.png)

## 3. The product at a glance

One workspace connects goals, tasks and practice

主讲：A；时长：40秒；版式：tour。

中文讲稿：结合概览画面指出目标、完成率和入口。完成率10%来自把一项任务标记完成，不是正确率，也不是学习效果。图片可点击打开本地首页，另一个浏览器账号的数据会不同。

核对来源：frontend/app/page.tsx

操作截图：[overview](assets/demo/overview.png)

## 4. What runs behind the interface

The demonstrated stack uses local SQLite and offline retrieval

主讲：B；时长：60秒；版式：architecture。

中文讲稿：用表格解释页面、接口、事实存储、工作流、求解器与检索服务。当前62个接口；PG/Redis/Docker不是本次已实测运行栈。不要将哈希演示向量讲成已验证语义检索。

核对来源：backend/app/main.py; docs/development/ARCHITECTURE.md

## 5. Time limits become planning inputs

90 minutes per day gives 630 available minutes for this week

主讲：B；时长：60秒；版式：time。

中文讲稿：指出每天90分钟和每周10小时30分钟的实际UI。它是容量上限，不是要求安排满630分钟。新计划仍需后续审批。讲解目标和时间如何从表单进入后端。

核对来源：frontend/app/profile/page.tsx; backend/app/services/planner.py

操作截图：[profile-minutes](assets/demo/profile-minutes.png)

## 6. A wrong answer produces a learning record

The server returns a reference answer and explanation

主讲：C；时长：45秒；版式：reading。

中文讲稿：这是项目原创阅读模拟题，明确说明是故意选True。参考False，因为原文说种植计划效果并不完全相同。这个事实来自客观判分，不是模型推断。

核对来源：frontend/app/question-bank/page.tsx

操作截图：[reading-feedback](assets/demo/reading-feedback.png)

## 7. Errors and fragments remain different records

One objective error and one manually collected note

主讲：C；时长：45秒；版式：memory。

中文讲稿：左边however笔记是人工写的碎片；右边题目错误是实际作答事件。二者知识点相关但来源不同，不能说系统从这道题自动推断了however错误。原练习事实不会因编辑笔记而被改写。

核对来源：backend/app/services/learning_memory.py; backend/app/routes/memory.py

操作截图：[memory-cards](assets/demo/memory-cards.png)

## 8. Inspect the retrieved personal source

Query: however supporting evidence

主讲：C；时长：60秒；版式：retrieval。

中文讲稿：在实际结果中选择however手记展开，来源序号可能不是第一，因此不宣称它总排第一。页面显示向量匹配（演示）和关键词匹配。本次无生成模型，仅验证检索、原文和来源能回查。

核对来源：backend/app/services/search_repository.py

操作截图：[retrieval-first](assets/demo/retrieval-first.png)

## 9. Check the exact PDF page

The original excerpt keeps its physical page number

主讲：C；时长：30秒；版式：pdf。

中文讲稿：演示上传的是临时生成的两页文本PDF。显示第二页，英文内容与所选页一致。打开原文件需要当前用户权限；扫描PDF需要OCR，当前未实现。

核对来源：backend/app/routes/documents.py; frontend/app/resources/document-reader.tsx

操作截图：[pdf-page-two](assets/demo/pdf-page-two.png)

## 10. A generated schedule is still a draft

The learner reviews the plan before approving it

主讲：D；时长：60秒；版式：draft。

中文讲稿：指出Draft和Approve按钮。实际例子是10项320分钟，630分钟只是每周上限。LangGraph节点真实执行，CP-SAT与后置校验处理约束；retrieve当前不参与任务选择，不说RAG驱动排程。

核对来源：backend/app/agents/workflow.py; backend/app/services/planner.py

操作截图：[plan-draft-summary](assets/demo/plan-draft-summary.png)

## 11. Approval and completion are explicit actions

An approved plan can track and restore task status

主讲：D；时长：60秒；版式：approval。

中文讲稿：上图是批准后状态与1项完成，下方任务有恢复操作。审批重新检查画像和基准计划，事务与唯一索引限制单一正式计划。完成状态是用户操作记录，不表示任务已客观评分合格。

核对来源：backend/app/repository.py

操作截图：[plan-active-summary](assets/demo/plan-active-summary.png)、[task-completed](assets/demo/task-completed.png)

## 12. Recall first, then reveal and review

The pinned dictionary works without a generation model

主讲：E；时长：45秒；版式：vocabulary。

中文讲稿：先展示翻面前hall，再展示释义与忘了/模糊/记住了。8,520词为ECDICT固定版本生成。释义是为了展示翻译为英文，应用原版为英汉词卡；复习间隔是程序规则，不是模型输出。

核对来源：backend/app/services/word_deck.py

操作截图：[word-recall](assets/demo/word-recall.png)、[word-reveal](assets/demo/word-reveal.png)

## 13. A first draft exposes a logical problem

A fixed original example illustrates the writing workflow

主讲：E；时长：60秒；版式：writing-v1。

中文讲稿：切到独立离线示例。初稿两句都支持教育好处，however的转折不成立。右侧特写展示方向提示，用户仍需修改。此固定示例没有读取Alex刚刚新建的笔记，不能宣称系统刚实时分析了Alex的作文。

核对来源：backend/app/services/coach_demo.py

操作截图：[writing-v1](assets/demo/writing-v1.png)、[writing-hint](assets/demo/writing-hint.png)

## 14. The revised draft makes its support explicit

Comparison retains both the improvement and the remaining issue

主讲：E；时长：75秒；版式：writing-v2。

中文讲稿：修改稿用For example具体展开受益者；连接关系改善，但立场范围仍需解释为何不是everyone。状态同时保留已改善和部分改善，不给虚构分数。仍然是固定原创离线例子，不计入个人成绩。

核对来源：backend/app/services/coach_demo.py

操作截图：[writing-v2](assets/demo/writing-v2.png)

## 15. The tutor shows its evidence and mode

Offline retrieval is visible instead of a fabricated new answer

主讲：E；时长：60秒；版式：assistant。

中文讲稿：真实请求询问however，用当前账号的知识与文档检索。界面明确显示模型不可用及来源列表。此处验证的是检索回退而非实时生成成功；需要真实生成演示时必须另行配置模型并预验收。

核对来源：backend/app/services/search_repository.py

操作截图：[assistant-sources](assets/demo/assistant-sources.png)

## 16. Verification behind the demonstration

Recorded checks cover behaviour on synthetic local data

主讲：F；时长：65秒；版式：verification。

中文讲稿：152后端测试、20浏览器流程来自2026-11-14整理验收。20中14为模拟接口、6为真实离线API；62为保留的方法路径对。截图本次单独用合成账号采集，不把图片数量当新功能测试数量。没有真实模型质量或真人提分指标。

核对来源：docs/validation/REORGANIZATION_SUMMARY.json

## 17. Current capabilities and next validation

The interface works; quality and deployment need separate evidence

主讲：F；时长：55秒；版式：boundaries。

中文讲稿：总结现在能互动、积累和回查来源；真实生成、语义质量、人工复核语料及外部服务部署还需验证。旧0012独有功能仍待兼容移植。展示不是宣称项目已满足所有最终验收。按PDF正式课堂使用14分钟备选。

核对来源：docs/development/HANDOVER.md

## 18. Questions & answers

Personal memory, retrieval, scheduling and verification

主讲：All；时长：240秒；版式：qa。

中文讲稿：本页4分钟。A分派，C答RAG，D答排程，B答架构，E答界面，F答验证；普通问题25–40秒。对不具备证据的真实模型、评分或生产问题，直接说明未验证。

核对来源：docs/presentation/QA_BANK.md
