# 学习练习发布，论文功能保持关闭

本次发布从已提交的 `66db6ab7` 建立独立工作树，不带入论文会话的未提交文件。

- 发布数学练习、练习筛选和本轮非论文问题修复。
- 网页目录、网页直链、能力搜索和 MCP 不提供论文研读。
- 生产 Compose 固定关闭 `PAPER_STUDY_ENABLED`、`PAPER_STUDY_WORKER_ENABLED`、`PAPER_STUDY_MODELS_ENABLED`、`PAPER_STUDY_PUBLISH_ENABLED`，不受 `.env.prod` 中旧值影响。
- 不启动桌面论文预览服务或新增的可选任务；保留当前正在运行的其他服务。

## 宝塔终端更新

使用本次验证完成后给出的完整提交 SHA。以下操作针对现有 `/www/gamehub` 安装，不用于初始化新数据库：

```bash
set -euo pipefail
cd /www/gamehub
git fetch origin codex/release-practice-no-paper
RELEASE_SHA=替换为完整的40位发布提交SHA
git show "$RELEASE_SHA":deploy/prepare-practice-release.sh > /tmp/mooyu-prepare-practice-release.sh
bash /tmp/mooyu-prepare-practice-release.sh "$RELEASE_SHA"
```

脚本会拒绝存在本地改动、未包含当前线上提交、或修改了旧迁移的版本。不使用 `reset`、`clean`、强制切分支或删除数据卷。

## 执行顺序和恢复

1. 保存原提交、原分支、原 Compose 和环境配置到 `/www/backup/gamehub/practice-时间戳`。
2. 为当前运行中的服务保留回滚镜像。API 等镜像仅补入新的迁移清单，业务代码仍为旧版本，以兼容升级后的健康检查。
3. 串行构建目标镜像，保留正在运行的旧服务。Web 复用当前线上镜像中的 Caddy 和 DNS 插件，仅更新应用静态资源及项目内代理配置，不额外升级 Caddy。
4. 导出数据库并用 `pg_restore --list` 检查备份。
5. 在同一个事务中执行新增的 `0159` 和 `0160`；失败则两者一起撤回。`0159` 只建论文表结构，不启用论文功能。
6. 仅重建原来运行中的应用服务，检查健康状态、练习目录、题目引擎、论文 API 关闭状态和 MCP 工具列表。
7. 若应用启动或检查失败，自动切回旧业务镜像，保留新表和用户数据。人工回滚命令会在终端中输出：

```bash
bash /www/backup/gamehub/practice-实际时间戳/rollback.sh
```

备份及其环境文件应留在服务器；不要粘贴到聊天中。若脚本停止，请提供停止原因和末尾的非敏感输出，不要强行重置线上目录。

## 发布后人工验收

登录后从“学习 → 解题和练习”创建练习，完成答题、查看解析，并刷新恢复进度。确认工具目录没有论文研读，旧论文直链不显示可操作工作区。桌面安装包下载和原有研究任务沿用原发布渠道，本次脚本不会激活新的桌面论文服务。
