# 项目整理与搬迁验收

日期：2026-11-14。目标：DSAI5206/group project/IELTS-learning-assistant。团队仓库新分支：ccy最新-20261114。

## 整理内容

- 采用最后已交付提交 1e0c22f 的源码与 Git 历史作为运行基线。
- 五组 HTTP 路由统一归入 backend/app/routes；算法、RAG 与个人记忆实现保留在 services；修复 main 与路由间导入。
- 文档按 guides、development、rag、validation、reference、history 分类，重写相对链接。前端新增资料/记忆组件继续放在原 resources 页面目录，没有另建新版应用。
- 运行数据与备份统一放 local-data，Git 显式忽略。启动器动态解析项目根目录，支持 group project 中的空格。
- 既有 ielts-coach 环境的 editable .pth 从旧 backend 更新到新 backend，原值保存在本机 local-data/environment；未改 ai-dev 或创建环境。
- 历史独有项目归档 1961 文件，之前预览归档 1629 文件，归档内容逐项 SHA-256 校验通过。依赖、构建产物、下载缓存与 junction 不计入档案；前端现有依赖移动到新目录。
- 保留此前预览 SQLite、上传、词库与签名密钥。旧 0012 实际库仅归档，不连接当前 0008 迁移链。旧限时练习、重排、OIDC 等仍是兼容移植待办。

## 验证记录

后端初次执行因 pytest basetemp 父目录未预先创建出现 13 项初始化错误；创建目录并将该步骤写入 verify-local.ps1 后，完整重跑 152 项通过（26.01 秒）。Ruff 导入排序检查通过，前端在新目录生产构建通过。预览迁移与启动通过，访问地址为 http://127.0.0.1:3000。

机器可读的最终复查、浏览器结果、文档链接和删除/上传状态见 REORGANIZATION_SUMMARY.json。本机原始测试报告在 local-data/verification，不提交数据库、密钥或私人归档。

真实模型质量、PostgreSQL/Redis/Docker、公网和旧版兼容能力不因本次目录整理而变成已验收。
