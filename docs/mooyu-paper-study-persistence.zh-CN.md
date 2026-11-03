# 论文研读持久化与服务适配

论文研读复用平台 `/v1/me/paper-studies` 账号接口、既有 Bearer 会话、Agent 研究运行时及冻结的策略快照。网页和桌面使用相同接口。服务默认关闭；本轮只在本机隔离 PostgreSQL 和 Redis 验证，不包含生产迁移、部署、模型调用或发布。

## 保存与恢复

迁移 `0159_paper_study_private_workspace.sql` 新增两个私有表。文档表保存用户归属、PDF、来源 SHA-256、解析结果、完整证据包和私有待审稿；任务表保存操作唯一键、预分配运行 ID、检查点及校验哈希。PDF 仅由已鉴权的原文接口读取，不放入公共静态目录。

相同账号、相同 PDF 哈希的并发导入只创建一个文档和一个任务；不同账号有各自归属。分析与成稿按文档和操作去重。每账号最多 20 个文档、总计 100 MiB，单文件最多 20 MiB、80 页。Redis 限流为每账号每分钟 60 次写请求，Redis 不可用时新写入返回 503，已保存内容仍从 PostgreSQL 读取。

文档与任务在同一事务写入。worker 将任务派发到既有研究运行时，运行创建使用事务幂等锁，派发后未关联运行就崩溃也不会重复创建。解析检查点与文档更新同一事务落库，并校验阶段租约与 fencing token；旧 worker 无法覆盖新结果。检查点完成后、阶段结束前崩溃，重启只完成运行，不重复解析。检查点有哈希校验，已保存的来源和阶段内容禁止原地覆盖。

Redis 仅用于限流与通知，不保存唯一任务状态。通知失败不能撤销已提交任务，worker 继续轮询 PostgreSQL。worker 的过期阶段恢复限定到论文处理路由，不扫描其他业务的 outbox 或阶段。

派发在 SQL 内先按执行 Agent 和支持的操作过滤，再取前 25 条，其他 Agent 或关闭的模型操作不会占用当前 worker 批次。CLI 保留固定 worker ID：异常退出后，旧登记仍活跃时输出 `waiting-for-worker-lease`，最多等待 5 分钟，旧实例登记超过既有 240 秒失活门限后再注册并恢复。仍在心跳的实例不会被抢占，等待超时明确失败；等待期间支持正常退出，其他错误仍立即停止，不吞掉质量门禁失败。

## 开关与治理边界

- `PAPER_STUDY_ENABLED`：默认 `false`，控制正式账号接口注册。
- `PAPER_STUDY_EXECUTION_AGENT_USER_ID`：启用时必须配置现有、活跃且已分配策略的研究 Agent UUID；调用方不能指定执行 Agent。文档所有者仍是登录用户。
- `PAPER_STUDY_WORKER_ENABLED`：默认 `false`；显式运行 `node apps/api/src/paper-study-worker-cli.mjs` 的独立进程才处理任务。API 不自动启动后台 worker。
- `PAPER_STUDY_MODELS_ENABLED`、`PAPER_STUDY_PUBLISH_ENABLED`：只允许缺省或 `false`，尝试开启会拒绝启动。

当前正式适配只开放持久导入、解析、阅读和已有结果恢复。分析/生成接口在创建任务前返回 `PAPER_STUDY_MODELS_DISABLED`，界面同时禁用按钮。运行预算中 provider/tool/token 均为零，冻结能力与策略继续拒绝模型和发布动作。不提供发布路由。后续真实模型接入仍需单独完成来源外发授权、治理预算及恢复验收，不能通过本轮开关直接开启。

测试专用的 `offline-verified-recording` 处理器允许已有录制经过当前证据和全文门禁后保存分析、草稿，用于验证重启恢复；正式 API 和 worker 入口均不注入它。录制验证不等于重新调用模型，也不代表任意论文已经过真实模型验收。

## 本地隔离验证

需要本机 Docker Desktop、已存在的 `postgres:17`、`redis:7.4-alpine` 镜像及本地公开 PDF 样本 `.runtime/paper-layout-audit/1706.03762v7.pdf`。测试不会加载凭据文件。缺少样本会失败，不会改用生产资源。

```powershell
node scripts/verify-paper-study-persistence.mjs
node scripts/test-researcher-qa-db.mjs tests/platform/agent-runtime-foundation-db.test.cjs
node scripts/verify-paper-study-clean.mjs
```

持久化脚本仅接受本机 Docker endpoint；自动创建临时 PostgreSQL、Redis、环回端口和随机测试账号，数据目录均为 tmpfs，结束时校验容器身份后清理。结果写入被忽略的 `.runtime/paper-study/persistence-latest.json` 和各轮 `tests.log`、`checks.json`。

2026-11-03：隔离持久化回归 7 项通过，覆盖真实平台账号鉴权、并发去重、跨账号拒绝、真实 PDF 解析、检查点后进程崩溃、过期租约恢复、离线验证分析/草稿跨实例保留、Redis 重启、配额和不可用拒绝、其他业务阶段不受干扰，以及治理拒绝。共享运行时 PostgreSQL 基础回归通过。模型调用数为零，临时数据库容器已清理。

两项 P2 修复后重新运行隔离 PostgreSQL/Redis，8 项通过（`persistence-1b59a89dab184f24a4fc068b73702ff2`）：新增 25 条其他 Agent、25 条不支持操作、27 条可派发任务的批次回归；原崩溃场景改为同默认 `paper-study-worker` 身份，通过与 CLI 相同的等待循环恢复。测试只在隔离库推进旧登记时间，避免真实等待 4 分钟；生产失活门限没有缩短。另有 11 项 worker/正式路由/等待循环测试通过，覆盖竞争实例等待上限、取消与非预期错误停止。模型调用为零，临时 PostgreSQL 和 Redis 已清理。

修复后干净目录回归更新为 222 项：216 通过、6 项数据库测试跳过，构建通过（`check-XXP1Tp`）。本次修复未改变窗口界面，窗口验收沿用下述已通过记录。

干净导出回归共 219 项：213 通过、6 项数据库测试按离线规则跳过，构建通过；数据库验收以上述独立隔离轮次为准。共享 worker 与配置另有 6 项回归通过。Electron 离线录制窗口验收 `check-Fyd6s6` 通过原文阅读、逐段证据跳页、全文门禁、960 像素窄窗口、刷新恢复和退出清理；该窗口验证仍使用本地回放适配器，不宣称已经部署持久化服务。首次沙箱内窗口启动因 GPU/缓存访问受限失败，使用相同配置在本地窗口权限下重跑通过，失败日志保留于 `check-dFDBvp`。
