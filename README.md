# IELTS Adaptive Coach

**团队仓库：[Swordmynew/IELTS-learning-assistant](https://github.com/Swordmynew/IELTS-learning-assistant)，整理版分支 `ccy最新-20261114`。首次使用从 [START_HERE.md](START_HERE.md) 开始。**

Next.js + FastAPI 的 IELTS Academic 学习原型。用户设置目标与时间，审核周计划，进行词汇、题目与写作练习，并将错误、碎片笔记和原文收藏积累为可检索的个人知识。

## 文档入口

| 想做什么 | 阅读 |
| --- | --- |
| 本地启动 | [快速启动](docs/guides/QUICKSTART.md) |
| 理解所有模块 | [功能与使用指南](docs/guides/USER_GUIDE.md) |
| 跟着操作一遍 | [演示步骤与本次实操](docs/guides/DEMO_WALKTHROUGH.md) |
| 接手开发 | [交接与剩余工作](docs/development/HANDOVER.md) |
| 配置、运行与部署 | [运行维护](docs/guides/OPERATIONS.md) |
| 接口开发 | [API 清单](docs/development/API_REFERENCE.md)，运行时 `/docs` 提供完整 Schema |
| 理解算法与 RAG | [架构](docs/development/ARCHITECTURE.md)、[个性化 RAG 设计](docs/rag/PERSONALIZED_RAG_PLAN.md) |
| 查看测试与限制 | [最新验收](docs/history/ITERATION_2026-11-12.md)、[验证摘要](docs/validation/VALIDATION_SUMMARY.json) |
| 数据与实验 | [数据政策](docs/reference/DATA_POLICY.md)、[评测方案](docs/validation/EVALUATION.md) |

## 系统功能

- 账号、个人资料、设置和显式演示入口；业务数据按用户隔离。
- 学习档案与周计划：LangGraph 执行轨迹、OR-Tools 容量约束、考前截止、草案审批、过期检测和任务完成/恢复。
- 词汇：固定版本 ECDICT 生成的 8,520 词、翻卡、间隔复习、个人积累及独立后台提词。
- 题库：四科原创仿真题、私人题目录入、客观判分、错题复习与来源收藏。
- Task 2 写作：保存多稿、逐项反馈、三层提示和修改对照；保留单次批改接口。
- 个人知识：自动错误记录、碎片笔记、原文收藏、知识点关联、编辑/合并/删除、回填和自评复习。
- RAG：公共资料、私人文档和个人记忆检索；关键词/向量/学习状态排序、上下文预算、引用校验与修订感知缓存。
- 文档：TXT/MD/文本型 PDF 摄入、片段与页码查看、鉴权原文件访问。扫描 PDF 需另做 OCR。

## 当前验证范围

152 项后端测试、20 条浏览器流程（14 条模拟接口、6 条真实离线 API）、类型检查、Ruff、生产构建与 SQLite 迁移验证通过。验证记录对应当前实现及合成样例，不等于真实模型评分或语义检索质量。

本机预览为独立 SQLite、离线生成和哈希向量。真实模型、PostgreSQL、Redis/RQ、Docker、公网与恢复演练仍待实际验收。规划 retrieve 尚未参与任务选择，不能称为 RAG 驱动排程。

旧原目录的部分成熟功能尚待兼容合入；此分支迁移 head 为 `0008_plan_approval_guard`，不可直接连接旧 `0012_model_calls` 数据库。代码交接、真实数据评测和课程第 20 组报告/PPT 待办见 [HANDOVER](docs/development/HANDOVER.md)。

## 快速体验（本机已有 Conda 环境）

```powershell
$env:PYTHONNOUSERSITE = '1'
$IeltsPython = 'D:\Anaconda3\envs\ielts-coach\python.exe'
# 首次检出先按 QUICKSTART 核对依赖，再执行 npm ci --prefix frontend。
& $IeltsPython backend/scripts/import_starter_vocabulary.py
.\scripts\start-conda-preview.ps1 -PythonPath $IeltsPython
```

打开 http://127.0.0.1:3000 ，点击“体验演示”。已经运行时直接打开网页，避免重复占用端口。

密钥、数据库、上传文件、缓存、依赖和临时资产不提交 Git；所有本地项目资产保留在本项目目录。ECDICT 来源与 MIT 许可见 [词汇说明](docs/guides/VOCABULARY_LEARNING.md)。
