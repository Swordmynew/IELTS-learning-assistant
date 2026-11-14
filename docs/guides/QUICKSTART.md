# 快速启动

## 本机推荐方式（Windows + 现有 Conda）

本机已验证 Python：`D:\Anaconda3\envs\ielts-coach\python.exe`（3.11）。不要改动 ai-dev 的 AI/CUDA 配套；不要默认创建 uv/venv。其他电脑先找兼容的已有 Conda 环境，再设置解释器路径。

```powershell
git clone --branch "ccy最新-20261114" https://github.com/Swordmynew/IELTS-learning-assistant.git
cd IELTS-learning-assistant
$IeltsPython = 'D:\Anaconda3\envs\ielts-coach\python.exe'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONUTF8 = '1'
& $IeltsPython -c "import sys, fastapi, sqlalchemy, ortools, pypdf; print(sys.executable)"
```

先核对 `backend/pyproject.toml` 的版本约束。若确实缺包，再用该目标解释器安装；已有包满足约束时直接复用：

```powershell
& $IeltsPython -m pip install -e './backend[dev]'
```

Node.js 使用满足根 package.json 的版本（本机已验证 Node 24），随后执行：

```powershell
npm ci --prefix frontend
& $IeltsPython backend/scripts/import_starter_vocabulary.py
.\scripts\start-conda-preview.ps1 -PythonPath $IeltsPython
```

打开 http://127.0.0.1:3000 ，点击“体验演示”。API 健康检查为 http://127.0.0.1:8000/api/v1/health ，接口文档为 http://127.0.0.1:8000/docs。

## 预览数据与进程

启动脚本强制离线生成模式和哈希向量。无需 API 密钥；不调用收费模型。它将独立 SQLite、上传、日志、缓存、JWT 本地密钥与 PID 写到本项目 `local-data/runtime/`，先迁移再启动，保留演示数据。

- 前端缺失、后端已运行：` .\scripts\start-conda-preview.ps1 -FrontendOnly `。
- 后端缺失、前端已运行：` .\scripts\start-conda-preview.ps1 -BackendOnly `。
- 端口已占用时不要重复启动。读取 `processes.json`，核对对应进程和端口后仅停止自己的服务。不要批量结束所有 Python/Node。
- 后端错误见 backend.err.log，前端错误见 frontend.err.log；前端首次编译需数秒。

## 真正使用 AI

预览脚本始终离线。需要真实调用时，按 `.env.example` 和 `COACH_DEMO.md` 配置，使用自己的受保护环境启动后端；不要把密钥粘贴到聊天或提交 Git。

- 多稿作文、提示、助手、作文提词：`COACH_API_KEY`、`COACH_BASE_URL`、`COACH_MODEL`，并关闭 `COACH_OFFLINE`。
- 保留的单次 Responses 批改接口：独立 `OPENAI_*` 配置。两套密钥不互相回退。
- 语义向量配置见 README 和 embeddings 服务；哈希向量只作演示，切换模型后需重建对应索引。
- 手工运行需明确设置数据库和上传/缓存路径到项目内，配置安全 JWT 密钥，在 backend 执行 `python -m alembic upgrade head` 后运行 uvicorn；前端设 `BACKEND_INTERNAL_URL`。

当前本地验收仅覆盖 SQLite；PostgreSQL、Redis/RQ、Docker 和公网须另验收。使用任何已有数据库前先备份，确认迁移历史。不要将此分支直接连接旧目录的 0012 数据库。
