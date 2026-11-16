# 回滚后的统一发布重试

正式项目和配置目录仍是 `/www/gamehub`、`/www/gamehub/deploy`。`/www/backup/gamehub/incoming` 仅存放上传包；`unified-*` 和 `retry-blog-*` 分别保存回滚材料和诊断日志，不是新的项目目录。

生产重试在构建阶段报错 `resolve : lstat /www/backup/gamehub/deploy: no such file or directory`。当时尚未迁移数据库或重建业务容器，运行中的旧镜像保持不变。该错误不能解释前一次更新后验证失败的具体原因；后续仍需保留完整日志。

原因是回滚命令使用备份 Compose 文件及 `rollback-images.yml`。Docker 将这组文件写入运行容器标签；下一次更新复用标签时，以备份首文件所在目录解析相对构建、Dockerfile 和挂载路径，并把旧回滚镜像覆盖层当成新构建目标。

修复：

- 所有更新期间的 Compose 构建、迁移、启动和验证命令明确使用 `--project-directory /www/gamehub/deploy`，与原回滚命令一致。
- 对本发布系统记录的备份首文件，恢复以正式项目的 Compose 主文件作为新发布基线，继续保留其他实际生效的配置覆盖文件。
- 已识别的历史 `rollback-images.yml` 只收入本轮回滚快照，不参与新发布构建；缺少发布记录标识时停止，避免猜测或覆盖。
- 保存完整原文件顺序及旧镜像快照，用于本轮失败后的恢复，不删除或重写旧回滚材料。
- 不修改 `.env.prod`、历史迁移、数据卷、论文开关或机器人调度状态。

回归包含正常更新、锁/本地改动/校验和/模型/配置失败阻断、构建失败、启动失败、下载指针和 HTTP 验证失败回滚，以及回滚后再次更新成功和再次失败恢复。新增真实 Docker Compose CLI 配置解析检查，验证相对构建和规则挂载路径仍指向正式项目。测试不连接生产服务。

完整串行回归：366 个文件、1698 项测试，1616 项通过、0 失败、0 超时取消、82 项条件跳过，耗时约 8 分 18 秒。报告为 `.runtime/release-after-rollback/full/result.json` 和 `results.tap`。针对性部署及真实 Compose 检查另行通过，日志为 `.runtime/release-rollback-deploy-tests.tap`、`.runtime/release-rollback-retry-verified.tap`。原有机器人真实数据库回归结果见前两轮修复文档；本轮未修改机器人代码。
