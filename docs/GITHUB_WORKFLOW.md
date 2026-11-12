# 个人仓库与后续更新

交付仓库：[Charles-art36/IELTS-learning-assistant](https://github.com/Charles-art36/IELTS-learning-assistant)，默认 main，初始设为私有。这个仓库独立于已有 IETLS；原始来源为 Swordmynew/IELTS-learning-assistant。保留原 Git 历史与许可文件，避免丢失来源记录。

## 新电脑接手

先用自己的 GitHub 账号取得此私有仓库的正常访问权限，再克隆；不要通过聊天传递密码或令牌。

```powershell
git clone https://github.com/Charles-art36/IELTS-learning-assistant.git
cd IELTS-learning-assistant
git status
```

先读 START_HERE，再按 QUICKSTART 配置依赖并初始化词库。Git 不包含数据库、上传、密钥、缓存、node_modules 或本机临时日志；新电脑会初始化独立预览数据。若交接真实数据，通过适当的受控方式另行传递并验证迁移历史。

## 后续提交

当前按用户要求直接维护 main。修改前先确认没有未保存的本地工作，正常同步：

```powershell
git pull --ff-only origin main
# 修改、验证后，只添加确实需要的源文件或文档。
git add <reviewed-files>
git commit -m "Describe the change"
git push origin main
```

不使用 force，不用覆盖远端历史解决冲突。若快进失败，先查看差异并整合。提交前检查 git diff --cached，确认无实际密钥、个人作文、上传材料或数据库。使用独立测试库执行浏览器回归。

## 本机检出目录的远端

本次现有检出目录保持原位置：upstream/personal-learning-coach。origin 指向个人仓库；upstream 保留 Swordmynew 来源供只读对照。不把本机目录名当作当前分支名。仅推送 main，不使用原先拟定的 ccy最新 功能分支。

后续开发优先级、未验收资源与旧版兼容整合见 HANDOVER。私有仓库的接手者需要访问权限；分享链接本身不会授予权限。
