# 墨鱼变更雷达：数据库备份与恢复演练

状态：本地空库恢复工具已实现；生产异地备份、定时保留和 RPO/RTO 仍需在目标服务器演练后验收。

## 1. 恢复目标与边界

- 内部试运行目标暂定为 **RPO 24 小时、RTO 4 小时**，与平台现有部署基线一致；这是待验证目标，不是已经兑现的承诺。
- PostgreSQL 备份包含完整数据库，恢复核验重点覆盖 `tool_research_*` 研究账本、`schema_migrations`、数据库约束、索引和非系统触发器。
- 搜索供应商密钥、Researcher 密钥和部署环境变量不进入数据库备份，必须使用独立的密钥恢复流程。
- 本地演练不能证明异地副本可用、生产磁盘吞吐、定时任务可靠性、RPO 或 RTO；这些必须在目标服务器测量。

## 2. 生产备份

生产仍使用 `deploy/backup.sh`。它在专用私有目录写入 PostgreSQL custom-format dump、必要数据卷和 SHA-256 清单。备份目录不得由 Web/Caddy 静态路由公开，也不得与 API 运行凭据共用删除权限。

每次备份后至少检查：

1. `pg_restore --list` 能读取数据库 dump；
2. `SHA256SUMS` 校验通过；
3. 独立备份位置已收到副本；
4. 备份时间、字节数、哈希和执行结果进入运维记录，记录中不含正文、密钥或用户数据。

## 3. 本地空库恢复演练

只允许针对显式的本机测试库和测试容器运行。不要在生产库、远程数据库或包含用户唯一副本的环境运行。

PowerShell 示例：

```powershell
$env:GAMEHUB_RESEARCH_DATABASE_URL = 'postgresql://gamehub_test:test@127.0.0.1:55432/gamehub_research_test'
$env:GAMEHUB_REHEARSAL_CONTAINER = 'gamehub-research-restore-test'
npm run research:restore-rehearsal
```

工具会：

1. 拒绝非 loopback 地址、非 `gamehub_*_test` 数据库和非 `gamehub-*-test` 容器；
2. 在 repeatable-read 快照内计算研究表行指纹并执行 `pg_dump`；
3. 校验 dump 可列举及复制前后 SHA-256；
4. 创建随机命名的全新空数据库并恢复，绝不清空或覆盖现有数据库；
5. 比较所有研究表行指纹，以及列、约束、索引、触发器指纹；
6. 检查当前专题契约、运行契约、当前结论修订与账单账号归属不变量；
7. 在 `.runtime/research-restore-rehearsals/` 写入权限受限的 dump、哈希和 JSON 报告。

恢复数据库会保留供人工检查；操作员确认报告后再显式清理测试数据库。脚本故意不包含自动删除命令，避免目标识别错误时扩大损失。

### 3.1 已执行迁移校验冲突

若迁移进程报 `checksum changed for applied migration`，立即停止部署，不得修改 `schema_migrations`、删除数据库或覆盖已执行迁移文件。该错误通常表示两个未合并的功能分支复用了同一个迁移编号，或已经上线的 SQL 后来被改写。

处理顺序：

1. 从错误中的 `actual` 取得生产库记录的 SHA-256，并在曾上线的远端分支中定位内容完全一致的迁移文件；
2. 把该已上线分支合入当前发布分支，保留已经执行的迁移文件及其原始字节；
3. 将当前分支尚未在生产执行的冲突迁移整体顺延到下一个连续编号，同时更新引用和迁移数量测试；
4. 在空库运行完整迁移测试，并对已上线文件的固定 SHA-256 加回归断言；迁移器必须先把 CRLF/CR 统一为 LF 再计算摘要，避免 Windows 与 Linux 对相同 Git 内容得到不同结果；
5. 推送后仅允许服务器快进到明确提交，再重新构建并执行迁移。

2026-10-22 的已知实例：生产已执行 `0073_guess_baike_strict_selection.sql`，SHA-256 为 `7fd6aa9628c28b766fe223a3782d65a5b3fe8740c5776f974bd0c4656ad6236e`。变更雷达原先误从 `0073_autonomous_research_topics.sql` 开始，修复后保留猜百科 `0073`，雷达迁移顺延为 `0074`—`0107`。这条记录是迁移谱系约束，不允许通过修改数据库校验和绕过。

## 4. 生产恢复顺序

1. 停止调度 worker、Researcher worker、迁移和所有写入；保留维护页，不允许继续生成研究运行。
2. 在隔离环境验证 dump 清单与 SHA-256，不直接覆盖当前生产库。
3. 恢复到新数据库，核对迁移版本和研究账本指纹/不变量。
4. 核对备份时间之后发生的暂停、归档、权限撤销和预算门禁变化；RPO 窗口内的数据不能凭空重建。
5. 使用只读 API 验证账号隔离、专题数量、最近运行、结论/指标证据链和账单快照。
6. 切换数据库连接前再次停止外部搜索与 Researcher 发送；不确定行动保留为 `uncertain`，不得自动重发。
7. 切换后先开放只读，再恢复人工写入，最后恢复有预算和熔断保护的自动调度。

## 5. 验收记录

一次有效的生产演练必须记录备份开始/结束、恢复开始/结束、实际 RPO、实际 RTO、备份大小、SHA-256、表与模式指纹、失败步骤和人工决定。只有在目标服务器完成至少一次从独立备份位置到新数据库的演练后，才能把“备份恢复”标记为通过。

## 6. Researcher Worker 健康处置

启用 `researcher` profile 后，每个 Worker 必须使用部署内唯一且重启后稳定的 `RESEARCHER_WORKER_ID`。Compose 健康检查通过内部服务密钥读取该实例已经写入 PostgreSQL 的最近心跳；检查本身只读，不会领取任务、续租或刷新心跳。

发现 `researcher-worker` 为 `unhealthy` 时：

1. 先查看容器状态与最近日志，记录实例 ID、首次失败时间和最后成功心跳；日志及工单不得包含 Worker token 或供应商密钥；
2. 在专题页面确认显示的是“心跳过期”还是“尚未报到”，并检查供应商/模型配置是否与 API 预约配置一致；
3. 不要通过手工领取任务来“测试”，也不要重发已经进入 `sent` 或 `uncertain` 的调用；
4. 如需重启，只重启已精确识别的 Worker 服务；`restart: unless-stopped` 仅处理进程退出，Docker Compose 不会因为 `unhealthy` 自动重启仍在运行的进程；
5. 恢复后确认同一实例 ID 的心跳重新变为在线，并核对租约过期任务是否按账本进入 `uncertain`、失败或重新开放缺口；不要把恢复在线解释为旧任务已经完成；
6. 目标服务器必须另行接入外部告警并演练 `unhealthy` 处置，完成前只能声明“具备健康信号”，不能声明“已具备自动故障恢复”。

## 7. API 内专题调度器健康处置

API 容器的 `/ready` 会同时读取本进程专题调度循环状态。空队列仍会完成轮询并保持 `online`；前两轮顶层异常会显示 `degraded`，成功一轮即清零，不会仅因一次瞬时错误重启整个平台。调度器未启动、已停止、连续 3 轮顶层失败、超过 3 个轮询周期没有完成新循环，或单轮超过 15 分钟仍未结束时返回非就绪。

发现 API 因 `researchScheduler` 非就绪时：

1. 记录 `status`、最近循环开始/完成时间、连续错误次数和有界错误码，不记录研究正文、密钥或用户数据；
2. 若为 `degraded`，先检查数据库、迁移和最近运行账本；只要循环持续推进，不要把来源失败冒充为调度器宕机；
3. 若为 `stale` 或 `stalled`，检查进程日志、数据库锁等待、连接池和外部调用超时；不得通过手动重复触发专题来验证，以免制造重复运行或费用；
4. Compose 健康检查会把持续非就绪的 API 标为 `unhealthy`，但仍需目标环境的告警和处置策略；恢复后确认至少两个轮询周期持续推进，再恢复高成本自动阶段；
5. 该状态只覆盖单个 API 进程中的调度循环，不证明专题完成时限、供应商 SLA、通知送达或多实例整体容量。

## 8. 14 天就绪持续运行验收

生产 Compose 提供默认不启动的 `research-acceptance` profile。它运行独立、只读的监测进程，每分钟读取 API `/ready`，把 HTTP、数据库、迁移和本 API 进程调度循环的有界状态逐行写入专用 volume；不会读取账号、专题、正文、证据或密钥，也不会触发 Search、Fetch 或 Researcher 调用。

启动前先确认本次确实用于目标服务器验收，并记录版本、环境和负责人：

```bash
cd /www/gamehub/deploy
docker compose --env-file .env.prod -f compose.prod.yml --profile research-acceptance up -d research-soak
docker compose --env-file .env.prod -f compose.prod.yml --profile research-acceptance logs research-soak
```

启动日志会输出唯一运行目录和预计结束时间。正常配置为 336 小时、60 秒一次。采样写入 `samples.jsonl`，固定参数写入 `state.json`，结束后写入 `report.json`。进程或主机中断后，不得新建运行冒充连续结果；使用原日志中的目录续跑：

```bash
docker compose --env-file .env.prod -f compose.prod.yml --profile research-acceptance run --rm --no-deps research-soak \
  node scripts/run-research-soak.mjs --resume <启动日志中的 runDirectory>
```

结束后可从已停止容器复制报告供审核：

```bash
docker compose --env-file .env.prod -f compose.prod.yml --profile research-acceptance cp \
  research-soak:/data/research-soak ./research-soak-reports
```

门禁要求：达到完整 14 天；采样覆盖率至少 99%；健康样本至少 99.5%；不得连续超过 3 次非健康；调度完成时间必须持续推进。报告始终固定 `productionReady=false`：通过只代表取得 API/数据库/迁移/本进程调度循环的持续就绪证据，不包含 10 个专题结果抽样、供应商账单核对、通知、备份恢复、账号隔离、容量或整套产品生产验收。

本机只能用 loopback 地址运行短 smoke；它会标记为 `smoke-only`，不能替代 14 天结果：

```bash
npm run research:soak -- --smoke --target http://127.0.0.1:3090 --environment local-smoke
```
