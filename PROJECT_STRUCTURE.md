# 项目结构与运行边界

唯一项目目录：`D:\mission\polyu\DSAI5206\group project\IELTS-learning-assistant`。

```text
IELTS-learning-assistant/
├── backend/
│   ├── app/
│   │   ├── routes/        # core、coach、documents、memory、vocabulary HTTP 接口
│   │   ├── services/      # 规划、检索、模型、学习记忆、词卡等业务逻辑
│   │   ├── agents/        # LangGraph 工作流
│   │   └── data/          # 公共种子资料，生成词库不提交
│   ├── alembic/          # 当前兼容迁移链，head 0008
│   ├── tests/            # 后端验证
│   └── scripts/          # 后端维护、数据准备与评测工具
├── frontend/
│   ├── app/              # 页面及页面所属组件；资料相关组件集中在 resources
│   ├── lib/              # 客户端接口、类型和共用工具
│   ├── public/           # 静态资源与题库模板
│   └── tests/            # 浏览器流程
├── scripts/              # 项目级启动与准备
├── evals/                # 检索 smoke 样本
├── docs/                 # 分主题文档，见 docs/README.md
├── local-data/           # 本机私有档案、预览库与日志；不上传 GitHub
└── .github/              # CI
```

新旧检索、个人记忆、PDF 接口按业务类别整合到现有 app/routes 与 services；没有另建一套新版运行项目。导入与测试使用同一入口 app.main:app。

旧 0012 项目的独有源码与资料保存在 local-data/legacy-project.zip；此前预览日志保存在 previous-preview.zip，均有逐文件 SHA-256 清单，归档内容逐项验证。旧迁移链与当前 0008 不兼容，旧库仅归档，不自动升级。旧限时练习、重排、OIDC 等未移植能力在交接文档列为候选；归档不代表这些功能已合入或通过当前验收。

上传时只提交 Git 管理的源码、测试、配置模板和文档。local-data、node_modules、.next、真实 .env、数据库与用户上传不提交；项目位置由配置/脚本动态计算，不依赖旧目录。5206 既有 Group_Project 为另一目录，本次不修改。
