# GitHub 分支本地审查与接续说明（2026-11-11）

最新状态见 [第二轮补充与验收](ITERATION_2026-11-12.md)，本文件保留首轮基线与当时状态。

## 本次接手的代码

- 仓库： https://github.com/Swordmynew/IELTS-learning-assistant
- 分支：`feature/personal-learning-coach`
- 起点提交：`1b9d3d1c23a007077bc1464acc112e2d3187bcdb`。
- 本次检出位于原 IELTS 项目内 `upstream/personal-learning-coach`。原目录的旧实现和实际用户数据库保留。
- 下文检查针对该提交加本次本地修复。没有提交或推送 GitHub。旧交接包的测试数量和功能清单不能直接套用到此分支。

## 现在如何查看

前端：http://127.0.0.1:3000 ；API 健康检查：http://127.0.0.1:8000/api/v1/health 。页面已使用演示账号登录，浏览器已打开写作工作台。退出后可以在登录页再次进入演示空间。

建议先看“背单词”的翻卡和复习，再看写作工作台中的离线示例、资料和个人助手。当前启动强制 `COACH_OFFLINE=true`、`LLM_PROVIDER=offline`、`EMBEDDING_PROVIDER=hashing`。固定作文示例有明确标记；新作文的真实 AI 评分及生成式问答需要另行配置模型。当前哈希向量用于功能演示，不代表语义检索质量。

运行数据、日志、进程 PID、截图均在 `tmp/review-20261111/`。预览使用该目录的独立 `preview.db`，迁移到本分支 `0007_personal_coach`；没有连接旧项目的 `0012_model_calls` 数据库。

## 启动方式（现有 Conda，不创建 venv）

本次新增 `scripts/start-conda-preview.ps1`。默认使用 `D:\Anaconda3\envs\ielts-coach\python.exe`，保留 `PYTHONNOUSERSITE=1`。已安装的 Python 依赖满足本次测试；没有修改 ai-dev 或 CUDA。前端使用已有 Node 与 `npm ci` 安装的锁定依赖。

在本分支根目录执行：

```powershell
.\scripts\start-conda-preview.ps1
```

该命令仅用于本地离线预览，并会检查端口占用、迁移独立预览数据库、后台启动服务。服务已运行时直接访问网址即可；不要重复启动。`-BackendOnly` 可在仅后端已停止时启动后端。`-PythonPath` 可指定其他已验证兼容的现有 Conda 解释器。

首次新检出需先使用目标解释器运行 `backend/scripts/import_starter_vocabulary.py` 生成 ECDICT 词库，并在 frontend 执行 `npm ci`。当前词库已生成 8,520 个词条；生成数据和依赖没有提交 Git。

查看或停止进程时先读取 `tmp/review-20261111/processes.json`，用 `Get-Process -Id <PID>` 核对记录的 API/Web 进程，再停止本次预览进程。不要按所有 python/node 进程批量结束。后端日志为 `backend.err.log`，前端日志为 `frontend.out.log`/`frontend.err.log`。预览 JWT 密钥存放在忽略目录，不应上传。

## 已核对的功能

代码与本地页面显示该分支已有：Task 2 多版本作文、分层提示与问题跟踪，个人知识的积累/编辑/合并/删除/历史回填，带来源的生成式 RAG 助手，按用户和完整上下文隔离的缓存，8,520 词基础库及个人词卡、间隔复习、后台作文提词任务，以及规划工作流和人工批准。

这与旧目录 11 月 3 日快照不同：不能继续描述成“只有检索接口、没有生成式问答”。不过规划工作流的 retrieve 节点仍不能据此宣称为 RAG 驱动排程。

## 本次完成的修复

`backend/app/services/coach_model.py` 原先允许 `COACH_API_KEY` 缺失时回退使用 `OPENAI_API_KEY`，而 COACH 的默认地址为 DeepSeek。只配置旧接口密钥时，可能将它用于另一个服务地址。本次移除跨供应商密钥回退，Chat Completions 只读 `COACH_API_KEY`；旧 Responses 接口继续使用自己的配置。

新增回归测试 `test_coach_does_not_send_legacy_key_to_its_default_provider`，用合成密钥验证不会创建模型客户端。未使用任何真实密钥。预览 API 已重启加载该修复。

## 接手时基线验证证据（首轮补充前）

| 项目 | 本次结果 | 范围/证据 |
| --- | --- | --- |
| 后端 pytest | 61 通过，0 失败/跳过 | `tmp/review-20261111/backend-final.xml`；包含新密钥隔离回归 |
| Ruff | 通过 | 对 backend 的 app、tests、scripts 检查 |
| 前端类型检查 | 通过 | `frontend` 内 `npm run typecheck` |
| 前端生产构建 | 通过 | `tmp/review-20261111/frontend-build/build.log`；源码副本构建，避免覆盖运行中 dev 的 .next；副本只额外设置 Turbopack root 以容纳共享 node_modules junction |
| 浏览器实际操作 | 通过 | 演示登录、8,520 词词库及写作离线示例打开；截图 `writing-preview.jpg` |
| API/Web 可访问 | 通过 | 本地健康检查及首页 HTTP 200 |
| 实际供应商与模型质量 | 未验收 | 当前没有真实模型调用；仓库作者先前记录不等于本机验收 |
| 完整浏览器回归 | 本次未运行 | 此次页面实操不等于全部自动化流程验收 |
| PostgreSQL/Redis/容器/公网 | 本次未验收 | 当前为本地 SQLite 演示 |

## 下一轮优先事项与验收条件

### P1：排程截止日期、画像变化与批准一致性

1. **考试日期边界已复现**：`backend/app/services/planner.py` 的两个排程分支均使用连续七天，没有截断考试日；`validate_plan` 也没有该校验。输入考试在明天、每天 120 分钟时，生成任务中有任务在考试当天/之后，校验仍为空。实际输出及复现脚本保存在 `tmp/review-20261111/planner-exam-repro.{json,py}`。
   - 建议统一学习时区并明确考试日是否可学习；按产品选择默认考前一天截止。两个算法、计划范围和验证器使用同一边界。
   - 验收包括：考试明天/一周内、跨午夜、当天零时间、强制任务时间不足；不能为了满足周必做任务而越过考试截止。
2. **批准时重新验证**：`backend/app/repository.py::approve_plan` 当前读取计划后直接替换 approved 状态，缺少当前画像版本和草案状态核验。过期/已被替代计划可能被重新批准；并发一致性也需专项验证。本次为代码审查发现，尚未运行并发复现。
   - 建议保存画像/约束版本，批准时拒绝失效草案，使用事务与条件状态更新。
   - 验收包括：改时间后批准旧计划、批准 superseded 计划、两个草案并发批准、同草案重复点击，始终只有一个有效批准计划。

### P2：让工作流展示与实际执行一致

`backend/app/api.py::stream_agent_run` 的 SSE 路径当前按固定顺序发送文字并 sleep，不执行规划工作流。实际生成接口另有真正的 LangGraph 工作流，不应把这两个实现混为一谈。应接入实际节点事件、失败和持久化计划 ID，或移除该样例接口。验收要确保事件来自同一 run，失败不会发送成功完成。

### P2：资料摄入、来源定位与检索质量

- `backend/app/ingestion.py::_extract` 的 PDF/DOCX 路径依赖可选 Docling，本次环境未安装；返回片段页码均为 None。建议补轻量文本型 PDF 摄入、OCR/复杂版式可选路径及页码定位，保留原文与引用对应。TXT/MD 可先用于本地流程。
- `backend/app/services/search_repository.py::retrieve_sources` 读取可访问片段后在 Python 排序；`coach_model.generate` 每次还读取知识与片段计算完整修订指纹。数据增加后需要数据库侧过滤/检索以及修订计数，避免每次全量扫描。
- 建立至少 100 条人工复核检索问题，覆盖中文、英文、无相关答案、权限隔离、错误来源和资料更新，测检索相关性、引用是否支持答案、无答案处理。当前测试只证明部分流程正确，不能给出真实评分或语义检索准确率。
- 真实评分需人工评分作文、词汇作答样本、获授权材料和明确测试集。资料未齐前保留为待外部资源任务，不编造结果。

### P2：与原本地成熟功能整合

原目录已有的材料去重/引用保护、候选材料补入、分次学习记录与历史、统一时区、未完成重排及审批、限时练习、调用诊断、OIDC 和限流等，不能视为此 GitHub 分支已具备。本次应先做接口/模型差异表，再逐项迁移并回归。

特别注意：此分支最新迁移 `0007_personal_coach`，旧目录为 `0012_model_calls`。先设计迁移图和数据兼容方案，使用数据库副本验证升级/回滚；不要直接切换到旧实际数据库或仅复制迁移文件覆盖。

### P3：启动、部署和课程交付

新增 Conda 预览脚本已解决本机演示启动；原 `start-local.ps1` 的 .venv 假设仍存在。后续可统一启动入口、环境配置检查和错误提示。

需要继续完成并记录：真实模型带来源回答/失败重试验证，PostgreSQL/Redis 与任务队列、Docker、备份恢复、机构登录和公网部署验收。课程报告和 PPT 要按本分支真实功能与证据更新，第 20 组的命名及时间要求以课程说明/Canvas 为准。不要把离线截图写成真实模型质量实验。

## 接手后先做什么

先打开本地页面体验，再读本文、README、`docs/COACH_DEMO.md`、`docs/COACH_VALIDATION.md`、`docs/VOCABULARY_LEARNING.md`。随后优先修复上述 P1 排程/批准问题，再安排真实模型和检索评测；最后逐项整合旧目录功能。执行前先 `git status`，保留本次密钥修复、回归测试、启动脚本和审查文档。`frontend/next-env.d.ts` 的 dev 类型路径变化是 Next.js 启动生成的。

个性化 RAG 的课程依据、功能补齐和验收方案见 [PERSONALIZED_RAG_PLAN.md](PERSONALIZED_RAG_PLAN.md)；首轮实现和最新验收见 [PERSONALIZED_RAG_IMPLEMENTATION.md](PERSONALIZED_RAG_IMPLEMENTATION.md)。
