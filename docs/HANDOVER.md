# 开发交接

## 接手顺序

先读 ../START_HERE.md、QUICKSTART.md、USER_GUIDE.md 和 ITERATION_2026-11-12.md，再跑 DEMO_WALKTHROUGH.md。不要先连接真实数据库或更换环境。

## 代码地图

| 区域 | 主入口 |
| --- | --- |
| FastAPI 与登录/题库/计划 API | backend/app/main.py、api.py、auth.py |
| 排程与执行轨迹 | services/planner.py、services/planning_runs.py、agents/workflow.py |
| 事务审批与画像 | repository.py、db.py；0008 迁移中的 approved 唯一索引 |
| 写作与个人知识接口 | coach_api.py、memory_api.py |
| 个人记忆事件 | services/learning_memory.py、personal_knowledge.py |
| 检索、预算与模型 | services/search_repository.py、retrieval_context.py、coach_model.py |
| 摄入与页码原文 | ingestion.py、document_api.py |
| 词卡与提词 | vocabulary_api.py、services/word_deck.py、vocabulary_extraction.py |
| Next.js 页面 | frontend/app/ 下按路由划分 |
| 个人知识与来源阅读 | resources/、coach-components.tsx、floating-tutor.tsx |
| 客户端 API | frontend/lib/api.ts、coach.ts、vocabulary.ts |

## 数据库与状态

当前 head 为 0008_plan_approval_guard。CoachRecord 保存知识、事件、对话、缓存和记忆修订；练习事实与派生笔记分开。计划草案保存画像签名与基准正式计划 ID，执行和审批会重新核对。索引保证每用户最多一条 approved。

旧原目录的 0012_model_calls 与此分支不是同一迁移链。整合旧代码前先做模型/接口差异表，在数据库副本验证。不要复制迁移文件后直接升级真实库。0008 规范重复 approved 状态时不删任务，downgrade 不恢复旧重复状态，完全回退需数据库备份。

## 验证命令

在本机现有解释器环境，所有产物留在项目 tmp 子目录：

```powershell
$env:PYTHONNOUSERSITE='1'
$env:PYTHONUTF8='1'
cd backend
& 'D:\Anaconda3\envs\ielts-coach\python.exe' -m ruff check app tests scripts
& 'D:\Anaconda3\envs\ielts-coach\python.exe' -m pytest -p no:cacheprovider --basetemp ../tmp/verification --junitxml ../tmp/backend-tests.xml
cd ../frontend
npm run typecheck
# 与 next dev 共用 .next 时先停止开发服务，再构建；本次验收使用独立副本构建。
npm run build
# 先启动本地两端；可用现有 Edge，避免重复下载浏览器。
$env:PLAYWRIGHT_CHANNEL='msedge'
npx playwright test --output=../tmp/browser-results
```

Playwright 有 14 条模拟接口界面回归与 6 条真实离线 API 流程。后者创建可丢弃测试账号，仅对隔离预览库运行。后端测试默认内存数据库，部分审批/迁移用临时文件 SQLite。不要将浏览器验收指向正式服务。

可携带的基线摘要见 VALIDATION_SUMMARY.json；详细日志、数据库和密钥不上传。本分支的公开截图使用合成测试账号与内容。

## 优先待办

1. 配置真实生成/向量模型，测真实 RAG 与写作完整链路；密钥仅在本机安全配置。
2. 补授权语料、人工评分作文与人工复核检索集。EVALUATION.md 的发布门槛不能用合成测试代替。
3. 旧版学习记录、限时练习、材料保护及重排逐项合入，先设计兼容迁移。
4. PostgreSQL、Redis/RQ、Docker、机构登录、恢复演练及公网部署验收。
5. OCR、数据库侧检索、独立重排序、指代解析和微练习作为后续候选。
6. 第 20 组报告与 PPT 按真实功能更新，保留离线演示备份，真实模型效果尚未验证。

不要为凑结果编造评分准确率、检索指标或模型调用记录。已实现、已验收和待资源的事项分别记录。
