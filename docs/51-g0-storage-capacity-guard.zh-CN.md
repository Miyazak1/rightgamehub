# G0 存储容量门禁与运维

状态：已实现，等待生产部署验收
更新日期：2026-09-30
关联路线：[49 GitHub 开源作品导入与共建路线](./49-github-open-source-import-roadmap.zh-CN.md)、[50 G0 Web ZIP 隔离校验器](./50-g0-isolated-web-validator.zh-CN.md)

## 1. 目标与边界

本增量防止上传、解压和发布把生产磁盘写满。它只限制**新的上传任务创建**，不会因容量预警或阻断而关闭已发布作品、下载、Runtime Edge、登录或管理读取。

默认阈值：

- 磁盘使用率达到 70%：进入 `warning`，继续接受上传并记录状态变化。
- 当前使用量加全部活动上传预留达到 85%：进入 `blocked`，新上传返回可重试的 HTTP 507、错误码 `STORAGE_CAPACITY_EXCEEDED`。
- 任意必需存储根无法探测：fail-closed，新上传返回可重试的 HTTP 503、错误码 `STORAGE_CAPACITY_UNAVAILABLE`。
- 使用率恢复到阈值以下后自动重新开放，不需要重启服务。

容量门禁不替代宿主机监控、备份、扩容或人工处置。集中监控尚未接入时，管理员面板和结构化容器日志是首期观测入口。

## 2. 计量和并发语义

API 每 60 秒检查以下逻辑存储根：

- `quarantine`：上传隔离区；
- `validator`：Web ZIP 校验工作区；
- `runtime`：已发布运行资源；
- `avatars`：头像；
- `covers`：作品封面。

创建上传任务前，API 会先读取数据库中所有活动上传任务的预留，再加入本次请求的最坏情况占用。Web ZIP 按上传字节加 300 MiB 校验展开空间及 300 MiB 运行资源空间估算；Windows 单文件按声明字节估算。若多个逻辑根位于同一文件系统，预留会按底层设备合并，而不是把它们误当成相互独立的磁盘。

同一 API 进程内的“检查容量 → 创建上传预留”会串行执行，避免并发请求同时穿过门禁。当前生产 Compose 只有一个 API 副本；扩展为多个 API 副本前，必须把这段互斥升级为 PostgreSQL 事务级全局锁或等价的跨副本协调，不能只水平扩容后继续依赖进程内队列。

幂等重放不会被新的容量状态阻断：已成功创建过的同一请求直接返回原结果，不会重复占用配额。

## 3. 自动清理

容量服务启动时执行一次清理，之后每 10 分钟清理一次。清理范围严格限定为：

- `quarantine` 下扩展名为 `.partial` 的普通文件；
- 最后修改时间超过 2 小时；
- 不跟随符号链接；
- 不删除已提交上传、校验产物、运行资源、头像或封面。

有残留被清理时输出 `storage.cleanup.completed`；清理失败输出 `storage.cleanup.failed`。管理员面板显示最近一次清理时间、文件数和回收字节数。

## 4. 配置

生产 Compose 已设置：

```dotenv
STORAGE_WARN_PERCENT=70
STORAGE_BLOCK_PERCENT=85
STORAGE_MONITOR_INTERVAL_SECONDS=60
```

要求：`STORAGE_WARN_PERCENT` 必须小于 `STORAGE_BLOCK_PERCENT`。配置非法时 API 启动失败，避免带着不可信阈值运行。

调整阈值时应同时评估最大 100 MiB Web ZIP、300 MiB 解压上限、活动上传数量、数据库和 Docker 自身空间；不要为了临时恢复上传而把阻断阈值调到 100%。

## 5. 管理入口与日志

管理员进入“平台运营”页即可看到 `STORAGE GUARD`：总体状态、最高使用率、70/85 阈值、各逻辑目录实际字节、卷剩余容量及最近清理结果。

API 还提供管理员专用、禁止缓存的接口：

```text
GET /v1/admin/storage
Authorization: Bearer <admin access token>
```

重要结构化日志事件：

- `storage.capacity.transition`：仅在 `healthy`、`warning`、`blocked`、`unavailable` 状态变化时记录；
- `storage.capacity.unavailable`：某个存储根无法探测；
- `storage.capacity.failed`：周期检查异常；
- `storage.cleanup.completed` / `storage.cleanup.failed`：残留清理结果。

日志不包含作品名、用户路径、访问令牌或真实存储路径。

## 6. 部署与验收

```bash
cd /www/gamehub
git pull --ff-only origin main
bash deploy/deploy.sh
docker compose --env-file .env.prod -f compose.prod.yml ps api worker validator
docker compose --env-file .env.prod -f compose.prod.yml logs --tail=100 api | grep 'storage\.'
curl -fsS https://mooyu.fun/ready
```

上线后由管理员打开“平台运营”页，确认：

1. `STORAGE GUARD` 可见且不是“容量探测失败”；
2. 五个存储区均显示卷可用容量；
3. `warning` 仍允许上传，预测达到 `blocked` 时新上传得到 507；
4. 阻断期间既有作品仍可游玩和下载；
5. 释放空间后，下一次检查自动恢复上传；
6. API 日志中至少出现一次 `storage.capacity.transition`，且无路径或用户信息。

不要为了演练直接写满生产盘。磁盘满场景应在与生产 Compose 等价的暂存主机或受控小容量卷中完成，并把命令、阈值、HTTP 响应、恢复时间和日志保存为证据。

## 7. 故障处置

### `warning`

检查 Docker 镜像、容器日志、数据库备份、历史发布资产和异常上传增长；安排扩容或按既定保留策略清理。不要手工删除数据库仍引用的运行资源。

### `blocked`

上传已自动止血。先确认既有作品读取正常，再定位占用来源；扩容或清理后等待周期检查恢复。若必须立即复查，可重启 API，但重启不是解除阻断的必要条件。

### `unavailable`

检查卷是否挂载、目录权限、宿主文件系统和 Docker volume 状态。此状态下保持上传关闭；不要通过删除容量检查或临时改代码绕过 fail-closed。

## 8. 仍未关闭的 G0 项

本增量完成应用层磁盘阈值门禁、管理可见性、结构化状态日志和隔离区残留清理。以下仍需单独完成：

- 生产备份恢复演练及证据；
- 将结构化日志和 Validator 状态接入外部集中指标/告警系统；
- Runtime Edge CSP、Permissions-Policy 和 capability 版本复核；
- 磁盘满、容器强杀及高并发积压的生产等价故障演练；
- 多 API 副本前的跨副本容量预留互斥。
