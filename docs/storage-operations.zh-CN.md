# ECS 存储巡检与安全清理

生产作品运行包、头像和封面启用阿里云 OSS 后，ECS 根盘仍会保存 Docker 镜像与构建缓存、容器日志、数据库卷、系统日志和本地备份。OSS 不能替代这些主机级容量治理。

## 默认保护边界

- 容量告警线为 60%，与当前阿里云 ECS 告警保持一致。
- 上传阻断线为 80%，为数据库、日志和故障恢复保留空间。
- 所有 Compose 服务的 `json-file` 日志限制为单文件 10 MiB、最多 3 个文件。
- 部署成功并通过 Compose 健康等待后，只清理七天前的停止容器、悬空镜像和未被使用的可重建 BuildKit 缓存（包括仍可复用但已过保留期的内部缓存层）。
- 自动维护绝不清理 Docker volume、正在使用的镜像、数据库数据或备份。
- `rules-incoming/` 是待审核规则包的运行数据：Git 忽略、巡检只报告，自动维护不删除。

## 只读巡检

```sh
cd /www/gamehub/deploy
./storage-maintenance.sh --report
```

## 安全清理

```sh
cd /www/gamehub/deploy
PRUNE_AGE_HOURS=168 ./storage-maintenance.sh --apply
```

紧急情况下也不要使用 `docker system prune -a --volumes` 或 `docker volume prune`。本地备份必须在确认已有异机或 OSS 副本并通过恢复校验后，才按单独的备份保留策略删除；本脚本只报告备份大小，不会删除备份。

`rules-incoming/` 中可能包含尚未安装的签名包或人工复核证据。它不会再让生产 Git 工作区变脏，但也不会被缓存清理脚本误删；应在确认规则已经安装或明确废弃后，通过规则发布运维流程单独归档。

如果需要暂时关闭部署后的自动清理，可为单次部署设置 `DEPLOY_PRUNE=false`。这不会取消日志轮转和容量门禁。
