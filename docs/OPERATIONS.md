# 配置与运行维护

## 已验收模式

本机仅验收 Windows + 既有 Conda ielts-coach + SQLite + Next.js。本地离线启动见 [QUICKSTART](QUICKSTART.md)。Docker Compose、PostgreSQL/pgvector、Redis/RQ 是已有配置/代码路径，仍须实际启动验收后用于部署；不是本次已验证的生产环境。

## 主要配置

以根 `.env.example` 与 `backend/app/config.py` 为完整定义。根 `.env`、backend 工作目录的 `.env` 和进程环境可能覆盖彼此；排查时只检查是否设置，避免输出密钥。前端环境单独设置，根 `.env` 不自动进入 Next.js。

| 配置 | 用途 |
| --- | --- |
| DATABASE_URL | SQLite 或 PostgreSQL；已有库先确认 Alembic 历史 |
| JWT_SECRET | 后端会话签名密钥；安全生成、持久保存、禁止提交 |
| LEARNING_TIMEZONE | 统一学习日，预览为 Asia/Shanghai |
| UPLOAD_DIR / FASTEMBED_CACHE_PATH | 上传与模型缓存，保留在项目内 |
| REDIS_URL | 队列服务；离线脚本禁用可达 Redis 并走本地回退 |
| COACH_API_KEY / COACH_BASE_URL / COACH_MODEL | 多稿写作、助手与提词的独立 Chat Completions 供应商 |
| COACH_OFFLINE | 关闭实时生成，仅使用匹配缓存/显式离线演示 |
| OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL / LLM_PROVIDER | 保留的单次 Responses 批改接口；不向 COACH 自动回退密钥 |
| EMBEDDING_PROVIDER | hashing 仅演示；fastembed 为本地模型；openai 为兼容向量接口 |
| EMBEDDING_API_KEY / EMBEDDING_BASE_URL / OPENAI_EMBEDDING_MODEL | 外部向量模式，接口须支持本项目 384 维 |
| VOCABULARY_WORKER_ENABLED | 独立作文提词后台任务 |
| RAG_EVIDENCE_CHARS / RAG_SOURCE_CHARS | 总证据与每来源字符预算，默认 18000 / 5000 |
| BACKEND_INTERNAL_URL | Next.js 服务端代理，预览为 http://127.0.0.1:8000 |
| NEXT_PUBLIC_API_URL | 浏览器 API 前缀，默认同源 /api/v1；不可放密钥 |

预览脚本会清空模型密钥并强制离线。测试真实模型请另启后端，不要误以为修改 `.env` 会覆盖该脚本的强制值。真实调用会向供应商发送作文、问题与选中的证据；先使用无个人信息的合成输入。真实模型测试不是普通自动化测试的一部分。

## 手动启动真实模型路径

先在受保护的本机环境设置必要参数，安装并核对已有依赖，停止相同端口上的旧预览。显式把数据库、上传、缓存路径指向本项目自己的目录，保留 PYTHONNOUSERSITE=1。

```powershell
# 仓库根目录，示例解释器路径需按本机实际情况设置。
$IeltsPython = 'D:\Anaconda3\envs\ielts-coach\python.exe'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUTF8 = '1'
cd backend
& $IeltsPython -m alembic upgrade head
& $IeltsPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 另一终端在 frontend 中执行 npm run dev；设 BACKEND_INTERNAL_URL。
```

模型或向量配置改变后重启后端。切换向量模型需用目标解释器运行 `backend/scripts/reembed_knowledge.py`；先在备份副本演练。文本 PDF 无需 Docling，DOCX 需要可选 documents 依赖，扫描 PDF 的 OCR 尚未实现。

## 数据与备份

- 当前 Alembic head：0008_plan_approval_guard。旧目录 0012_model_calls 是另一条迁移链，禁止直接混接。
- 预览库、上传和 JWT 密钥在项目 tmp/review-20261111；真实环境路径由配置指定。
- 备份应覆盖数据库、上传原文件和安全保存的必要配置，词库与向量可重建。不要把它们上传公共 GitHub。
- 本分支尚未完成备份恢复实机演练。SQLite 冷备份需先停写入并关闭服务；在线备份使用 SQLite backup API，避免仅复制主文件而遗漏 WAL。
- 0008 会规范历史重复 approved 状态；降级只移除约束，不恢复重复状态。完整回退依赖备份。

## 故障定位

| 现象 | 首先检查 |
| --- | --- |
| 网页打不开 | 3000 监听、frontend.err.log、首次编译 |
| API 不可用 | /api/v1/health、8000 监听、backend.err.log、数据库迁移 |
| 登录失效 | 重新登录；重启时是否误换 JWT 密钥 |
| 模型不可用 | 是否离线、COACH 与 OPENAI 是否配错、供应商模型 ID、错误提示；不要打印 key |
| 检索不理想 | 是否 hashing、资料状态/权限/范围、检索预览、索引模型是否一致 |
| PDF 失败 | 加密/扫描/空白、上传大小、解析错误；不要把半套索引当成功 |
| 草案不能启用 | 时间冲突、画像改变、另一正式计划已启用；重新生成 |

停止服务前读取 PID 文件并核对端口、可执行文件和项目；只停止本项目进程，避免影响其他 Python/Node 项目。

## 部署前待验收

在隔离服务中验证 PostgreSQL 迁移/唯一约束、队列与 worker 恢复、向量重建、上传权限、HTTPS/反向代理、会话与跨用户访问、请求限流与模型费用控制、备份恢复，再发布公网。托管 OIDC/机构登录与旧版限流需要按交接计划整合。课程报告与演示应按实际验证范围描述。
