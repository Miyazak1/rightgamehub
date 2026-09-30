# G0 Web ZIP 隔离校验器实施与运维

状态：已实现并进入生产部署验证
更新日期：2026-09-30
关联路线：[49 GitHub 开源作品导入与共建路线](./49-github-open-source-import-roadmap.zh-CN.md)

## 1. 本次完成范围

Web ZIP 不再由生产 Worker 直接解析。生产环境现在强制使用独立 `validator` 容器，Worker 与校验器通过共享卷上的原子 JSON 信箱交换任务和结果。

```text
API 写入 quarantine
  -> Worker 领取数据库任务并写 requests/<id>.json
  -> Validator 原子领取到 processing/
  -> Validator 在 attempt-*/output 解包和校验
  -> Validator 写 responses/<id>.json
  -> Worker 再次校验报告并发布到 runtime-assets
```

信任边界：

- 正常上传链路由 API 写入隔离区；本增量没有重构其他应用容器的既有卷挂载。
- Validator 只能只读隔离区，只能写验证工作卷，不能写运行时发布卷。
- Worker 只读隔离区，读取验证结果后才可写运行时发布卷。
- Validator 不连接应用网络，不持有数据库、Redis、对象存储或部署密钥。
- Release 的不可变发布和数据库租约仍由 Worker 控制，Validator 无权发布作品。

## 2. 容器硬限制

生产 Compose 对 `validator` 固定以下约束：

- 独立精简镜像 `deploy/Dockerfile.validator`，非 root 用户运行。
- `network_mode: none`，无默认出网和内网访问。
- 根文件系统只读；只有验证工作卷可写。
- `/tmp` 使用 64 MiB `tmpfs`，带 `noexec,nosuid`。
- 删除全部 Linux capabilities，并启用 `no-new-privileges`。
- 1 vCPU、384 MiB 内存、64 个 PID。
- ZIP 校验最长 120 秒；报告最大 8 MiB，错误输出最多保留 64 KiB。
- ZIP 策略继续限制 100 MiB 压缩包、300 MiB 解压总量、100 MiB 单文件、5000 个文件和 16 层路径。

生产配置为 fail-closed：`NODE_ENV=production` 时，`VALIDATOR_EXECUTION_MODE` 只能是 `isolated`。本地开发和测试仍默认 `local`，便于不依赖 Docker 运行测试。

## 3. 信箱协议和故障语义

- 请求与响应协议当前为 `version: 1`。
- 请求 ID 必须是 UUID；输入只能匹配 `quarantine/<uuid>/<uuid>.zip`。
- 输出只能匹配验证卷内的 `attempt-*/output`。
- 文件先写 `.partial`，完成后使用同卷原子重命名提交，读取方不会看到半个 JSON。
- Worker 每 10 秒续租数据库任务；租约丢失会写取消标记，Validator 终止子进程。
- Validator 重启后优先恢复 `processing` 中已领取的请求。
- Worker 超时或退出不会产生 Release；只有收到有效报告并再次通过报告结构校验后才发布。
- 请求、响应、取消标记和 `attempt-*` 残留超过 1 小时会被自动清理；正在处理的请求不在清理目录内。

## 4. 可观测性

验证卷根目录提供两个不含作品名、用户路径或令牌的状态文件：

- `service.ready`：存在即表示服务已完成启动和首次残留清理，供容器健康检查使用。
- `service.state.json`：包含 `status`、`startedAt`、`processedTotal`、`failedTotal`、`lastCompletedAt`、`lastDurationMs` 和 `lastErrorCode`。

常用检查：

```powershell
docker compose -f deploy/compose.prod.yml ps validator worker
docker compose -f deploy/compose.prod.yml logs --tail=100 validator worker
docker compose -f deploy/compose.prod.yml exec worker node -e "console.log(require('node:fs').readFileSync('/data/validator/service.state.json','utf8'))"
```

首期告警建议：

- Validator 连续 2 次健康检查失败。
- `failedTotal` 的五分钟增量超过 10，或失败率超过 20%。
- `lastDurationMs` 连续超过 90 秒。
- 验证卷使用率超过 70% 告警、85% 阻止新上传。
- Worker 有待处理任务，但 `lastCompletedAt` 超过 5 分钟未变化。

## 5. 部署和回滚

部署：

```powershell
git pull --ff-only origin main
docker compose -f deploy/compose.prod.yml build validator worker api
docker compose -f deploy/compose.prod.yml up -d --wait validator worker api
docker compose -f deploy/compose.prod.yml ps
curl -fsS https://mooyu.fun/ready
```

生产环境不能通过切换回 `local` 绕过隔离。需要回滚时应回滚整个已知正常的代码版本并重新构建相关服务；未完成任务由数据库租约恢复，已发布 Release 不受验证工作卷清理影响。

## 6. 验收清单

- 合法 Web ZIP 经隔离信箱生成报告和输出目录。
- 隔离区之外的输入路径被拒绝。
- 验证工作卷之外的输出路径被拒绝。
- 生产环境配置为本地执行时启动失败。
- Validator 容器无网络、只读根、非 root、无 capabilities，资源限制生效。
- Worker 对隔离区只读，Validator 不挂载 `runtime-assets`。
- 服务退出后删除 ready 标记；重启恢复已领取任务。
- 自动测试、Compose 解析、镜像构建和容器属性检查全部通过后才允许推送部署。

## 7. 尚未完成的 G0 工作

本增量完成的是“不可信 ZIP 解析与生产服务隔离”核心。路线 49 中以下 G0 项仍需单独完成，不能因本文件标记已实现而视为整个 G0 完成：

- 生产备份恢复演练及证据。
- 应用层 70/85 磁盘门禁、管理面板与残留清理已由 [51 G0 存储容量门禁](./51-g0-storage-capacity-guard.zh-CN.md) 完成；外部集中告警接入仍未完成。
- Runtime Edge CSP、Permissions-Policy 和 capability 版本的再次固化审计。
- 将状态文件计数接入集中指标与告警平台。
- 磁盘满、容器强杀和高并发积压的生产等价故障演练。
