# 从这里开始

本轮唯一运行目录为 **DSAI5206/group project/IELTS-learning-assistant**；团队仓库为 **[Swordmynew/IELTS-learning-assistant](https://github.com/Swordmynew/IELTS-learning-assistant)**，整理版分支为 **ccy最新-20261114**。原团队 main、原功能分支与个人仓库此前交付保留。代码、文档结构见 [PROJECT_STRUCTURE](PROJECT_STRUCTURE.md)。

IELTS Adaptive Coach 是 Next.js + FastAPI 的 IELTS Academic 学习原型，帮助用户按目标与可用时间安排练习，将错题、作文问题和随手笔记组织成个人知识，并用于带来源的答疑。

## 按目的阅读

| 目的 | 文档 |
| --- | --- |
| GitHub 克隆和后续更新 | [仓库使用](docs/guides/GITHUB_WORKFLOW.md) |
| 第一次启动 | [快速启动](docs/guides/QUICKSTART.md) |
| 运行维护与配置 | [运行维护](docs/guides/OPERATIONS.md) |
| 开发接口 | [API 清单](docs/development/API_REFERENCE.md) |
| 理解整个系统及使用方式 | [完整功能与使用指南](docs/guides/USER_GUIDE.md) |
| 跟着操作一遍 | [系统演示步骤](docs/guides/DEMO_WALKTHROUGH.md) |
| 交给下一位开发者或 AI | [开发交接](docs/development/HANDOVER.md) |
| 了解最新实现和测试 | [第二轮验收](docs/history/ITERATION_2026-11-12.md)、[可携带验证摘要](docs/validation/VALIDATION_SUMMARY.json) |
| 理解个人记忆与 RAG 设计 | [个性化 RAG 方案](docs/rag/PERSONALIZED_RAG_PLAN.md)、[首轮实现](docs/rag/PERSONALIZED_RAG_IMPLEMENTATION.md) |
| 研究评测、数据与架构 | [评测](docs/validation/EVALUATION.md)、[数据政策](docs/reference/DATA_POLICY.md)、[架构](docs/development/ARCHITECTURE.md) |

## 当前交付状态

- 已实现并实测：本地离线学习流程、考前排程与事务审批、词卡、题目练习、碎片笔记、个人检索预览、文本型 PDF 页码查看/收藏。
- 已实现模型调用代码：Task 2 多稿反馈、提示、个人助手与来源引用；本机真实供应商效果尚未验收。离线固定示例有明确标识。
- 本次基线验收：152 项后端测试、20 条浏览器流程、类型检查及生产构建通过。测试使用合成资料；不代表真实评分或语义检索准确率。
- 仍需：真实模型/向量配置和人工样本评测、外部服务部署验证、课程报告与 PPT、旧目录成熟功能的兼容整合。
- 最新迁移：`0008_plan_approval_guard`。旧原目录的 `0012_model_calls` 属于另一迁移历史，不可直接混用数据库。

## 仓库包含和不包含什么

包含源代码、迁移、测试、依赖清单、文档与标明为合成测试的截图。`.env`、JWT 本地密钥、数据库、备份、用户上传、缓存、node_modules、构建产物和临时目录不上传。

8,520 词基础库由固定版本 ECDICT 下载生成，校验和与许可见导入脚本和仓库许可文件；新检出必须先生成。所有项目资产留在本项目目录。

## 本轮整理（2026-11-14）

当前唯一项目入口位于 DSAI5206/group project/IELTS-learning-assistant。[目录结构](PROJECT_STRUCTURE.md) 说明代码分类；运行资料在 local-data，受 Git 忽略保护。当前整理版本准备上传原团队仓库的新分支，个人仓库 main 保留历史交付。旧独有实现已归档，兼容合入待办仍见开发交接。

本轮目录调整与验证见 [整理验收](docs/validation/REORGANIZATION_2026-11-14.md)，重跑命令为 scripts/verify-local.ps1。

## 展示与分工

英文PPT与中文排练材料见 [展示安排](docs/presentation/PRESENTATION_PLAN_ZH.md)。用户版本15分钟讲解/演示＋4分钟Q&A；课程PDF版本14＋4，已有压缩安排。
