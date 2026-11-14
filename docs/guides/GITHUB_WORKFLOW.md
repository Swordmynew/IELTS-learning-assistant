# 团队仓库新分支与后续更新

本轮完整项目上传到 [Swordmynew/IELTS-learning-assistant](https://github.com/Swordmynew/IELTS-learning-assistant) 的新分支 `ccy最新-20261114`。main 和 feature/personal-learning-coach 保留；个人仓库 Charles-art36/IELTS-learning-assistant 的 main 保留此前交付。

新电脑克隆本分支后，先读根 START_HERE，再按 QUICKSTART 配置 Conda、npm 和词库。数据库、上传材料、密钥、缓存以及本机 legacy 档案不在 GitHub 源码中。

本机 origin 指向此前个人仓库，upstream 指向团队仓库。后续提交应先确认目标远端和分支；本轮仅将指定的新分支推送到 upstream，不执行 force 或合并 main。项目仍保留完整来源历史与许可。

使用网页上传时，先选新分支再 Upload files。不要拖入 local-data、node_modules、.next、真实 .env 或本地数据库。需要纯源码时使用本分支的 Code → Download ZIP；不要把整个本地运行目录直接拖上网页。
