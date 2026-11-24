# 服务器首次插件接入：可执行工具与本地验证

2026-11-22。分支 `codex/agent-server-preflight`。本轮只在本机开发和独立环境验证，没有连接、上传或修改线上服务器。旧统一发布包 `candidate-8e5991ca-r4` 保持原样；本轮作为单独运维附加包交付，不重新构建业务镜像。

后续原镜像与现场复核进展见 `agent-server-remaining-blockers-20261122.zh-CN.md`。R1 曾将计划心跳当成配置漂移，已在修订源码中修正；R1 不用于正式部署。修订工具 14 项门禁测试通过。2026-11-22 原调度镜像本体 ee818f… 已在独立 0166 合成库完成真实入口及重启验收，通过证明位于本地 original-image-acceptance-r1 目录；服务器启动入口与最新业务状态仍待只读复核，尚不能放行部署。原 R2 包及历史证明保持不变。

## 文件与命令

- `scripts/agent-server-cutover.mjs`：独立 Node 22 工具，仅依赖内置模块与主机 Docker/Compose。支持 prepare、check、backup、close-paper、upgrade、complete-migration、rollback、abort-before-migration。
- `deploy/agent-plugins/bootstrap-cutover-runtime.sh`：未来获准准备服务器时，从正在运行的旧 API 复制现有 Node 二进制到一个新的私有目录，并验证能在主机执行。不安装系统包，不停服务。若原主机已具备 Node 22，可直接使用。
- `deploy/agent-plugins/server-cutover-spec.example.json`：填入已核实的线上 Agent、角色、登录卷及两个下载目录，不含凭据。三个审核条件默认关闭，不能为了消除报错直接改成 true。
- prepare 成功后在新私有记录目录生成实际的升级/回退覆盖文件、禁用论文的覆盖文件、冻结的角色参数链、文件/容器指纹以及 `check.sh`、`backup.sh`、`close-paper.sh`、`upgrade.sh`、`complete-migration.sh`、`rollback.sh`。所有原 Compose 文件与 `.env` 不改写。

工具不会预填历史截图中的长 Compose 链：在 prepare 时读取当前每个角色的标签，保持文件顺序、项目名、项目目录与显式 env-file，逐项核对实际镜像、环境和挂载。网站两个下载目录只作为命令的进程环境参数，升级和回退都会带上。

## 实际门禁

1. 固定并验证原/目标/兼容回退镜像 ID；原 API 必须匹配本发布包的旧基线，原 163 条迁移 checksum 必须完全一致；目标迁移逐条与发布清单的 166 条 checksum 比对。
2. 核对现有 Agent、API/调度的同一主密钥和 GitHub token、共享控制密钥文件的同一只读引用。QQ worker 不得持有 Agent 主密钥或 GitHub token。新增执行器只用进程环境引用继承原 API，覆盖文件不写入密钥值；不向聊天或日志输出原始环境与私密错误。
3. 网关镜像/环境/挂载/网络/命令/启动时间不变；两个数据库容器的配置及启动时间不变。保护原登录卷，不重启网关或数据库。
4. 复核原 Compose/env/config/共享密钥文件及生成覆盖文件的 SHA256；代码/依赖/Web 静态入口的绑定覆盖阻止准备。任何角色配置、运行状态或额外 Agent 执行角色变化都会阻止窗口。
5. 两库仅读查询设置 `default_transaction_read_only=on`、语句与锁超时。检查活跃运行、历史文章运行、定时 fire、outbox、模型调用、预算占用、阶段租约、论文队列、未完成交互、未结算子任务及图片页。
6. 冻结原账户、能力授权、策略分配、旧自动化、计划字段和 QQ 设置/控制策略指纹，迁移前及后续门禁都比较。不重置累计预算、不清理历史失败、不改 delivered 状态、不自动重试或发送消息。
7. Unix 命令获取与旧部署工具相同的主机 flock；另有全局操作锁目录阻止跨记录并发操作。异常退出残留锁时必须先检查操作进程及状态，不自动删锁绕过。

## 双库备份

`backup.sh` 对现有两库分别执行 `pg_dump --format=custom --no-owner --no-acl`，将标准输出直接写入新私有文件，不经文本转码。验证 `pg_restore --list` 和 `pg_restore --file=/dev/null`，后者完整解码归档但不连接目标库、不执行恢复 SQL；保存大小、时间与 SHA256。至少预留 1 GiB 空间，不覆盖旧备份。

upgrade 首先生成保护性双库备份，停止原先运行的 API、QQ worker 与调度角色，持久关闭论文、复查空闲，然后生成新的静止窗口双库备份。只有两份静止窗口备份都完整、未变化且不超过 30 分钟，才能进入迁移。backup 独立命令允许一致性逻辑快照，但活跃进程下生成的备份不能用于放行迁移。

rollback 在停止新版执行进程后同样生成新的静止窗口备份。**生产工具没有数据库恢复命令**；回退仅恢复业务镜像/参数，保留全部追加 schema、任务绑定、图片页和历史。任何一库备份失败都不发布新的完整备份记录，保留已生成文件供检查。

## 论文持久关闭

先检查论文没有活跃任务。对已列出的论文角色关闭 Docker restart 策略，停止进程，再用专属覆盖文件将 restart 设为 `no`、六个开关设为 false、加入 `paper-disabled` profile，并将入口改为只执行 `process.exit(0)`。容器正常退出，不清理数据或挂载。

关闭后，所有经本工具执行的同项目 Compose 命令都会追加论文禁用覆盖，包含回退。再次启动该容器也只会退出。其余 API/新执行器/QQ worker 的论文开关保持关闭；原暂停的定时角色不恢复，原启用的定时角色保持原镜像与既有每日 10:00 计划。原 Compose 文件保持原样；**手工绕过管理入口、只执行旧 Compose 链可能重新启用旧论文配置**，后续操作必须使用记录中的工具/命令，不应继续沿用旧入口。

## QQ 权限迁移的显式审核

旧 QQ 白名单存于 control_settings，而新共享交互有独立的参与者绑定表。不迁移绑定会导致升级后原白名单用户被默认拒绝。因此 spec 的 `adoptLegacyQQParticipants` 必须经过审核：仅把当时现有白名单的 QQ 用户追加为同一 Agent 的 QQ 参与者，can_invoke 跟随旧 enabled，不新增用户、不修改旧记录，不授予新能力或发布权限。已有参与者被撤销/禁用时使用 ON CONFLICT DO NOTHING，不能将其重新授权。原 Agent 的能力授权、策略与计划指纹保持不变。

## 中断与回退

- 每个阶段保存状态及已验证的新容器指纹。新 API 启动失败时，能基于明确的目标配置记录执行回退；不会通过无条件重新采集来接受任意环境漂移。
- 若尚未迁移、库仍为 163，回退使用原 API 镜像；库为 166 时使用已验证的兼容回退 API `22b7b18c…`，保留追加表。
- 库处于 164/165 时禁止倒退 schema。排查后用 complete-migration 完成至 166，才允许兼容回退；此恢复动作仍要求进程停止、空闲窗口及有效双库备份。
- 如果停止后备份失败、但尚未迁移且完整 checksum 仍为原 163，可用 abort-before-migration 在配置/空闲门禁通过后恢复原业务进程，不强求再生成一次可能因磁盘不足而失败的备份。它不执行迁移或恢复数据库；论文仍保持关闭。若 checksum 已变化，拒绝此操作。
- 成功回退后可在同一记录重新 upgrade；追加初始化幂等，现有撤销权限不被覆盖。新增执行器回退后保持停止，论文继续关闭。
- 有待处理任务、未结算图片、配置或权限变化时，保留现场停止，不删记录解除门禁。

## 未来服务器上的命令

以下仅是未来获得服务器准备/变更授权后使用的命令，**本轮没有执行**。BUNDLE 为本附加包解压目录，RELEASE 为已验证统一发布包的 delivery 目录；两者必须用当时实际绝对路径。不得用旧 QQ 兼容包代替统一发布包。

```bash
umask 077
cd "$BUNDLE"
sha256sum --check SHA256SUMS
cd "$RELEASE"
sha256sum --check SHA256SUMS
# 准备阶段：只导入已审核镜像，不切换服务。
docker load --input images.tar

bash "$BUNDLE/bootstrap-cutover-runtime.sh" \
  /www/backup/gamehub/agent-cutover-runtime-20261122
NODE=/www/backup/gamehub/agent-cutover-runtime-20261122/node
RECORD=/www/backup/gamehub/agent-cutover-record-20261122

# 先复制 example 到私有 spec 并完成三个审核项；默认 false 会明确拒绝。
"$NODE" "$BUNDLE/agent-server-cutover.mjs" prepare \
  /www/backup/gamehub/agent-cutover-spec.private.json \
  "$RELEASE/release-manifest.json" "$RECORD"

# 初检允许报告既有论文差异；paperClosed=false 时 ready=false。
bash "$RECORD/check.sh" --allow-existing-paper
# 此命令会创建服务器上的备份文件，但不会切换服务。
bash "$RECORD/backup.sh"

# 到这里仍须审核实际生成的文件与窗口，获得正式变更授权后才执行：
bash "$RECORD/upgrade.sh"
# 必要时另行复查窗口后执行回退；不会恢复旧数据库。
bash "$RECORD/rollback.sh"
```

## 本地验证与剩余限制

- `tests/platform/agent-server-cutover.test.mjs`：12 项通过，无跳过，生成的 Bash 文件语法也已验证。覆盖完整首次升级/回退、暂停计划、QQ 撤销绑定、过期/损坏备份、配置/权限漂移、未结算子任务/图片、API 启动失败、部分迁移前向完成再回退、同一记录重试和迁移前安全中止。Docker/业务边界为合成故障注入，不宣称真实镜像完整升级演练。
- `scripts/verify-agent-cutover-local.mjs`：真实本地 PG16.10/0166 双库备份、完整解码、向新建库恢复并比较合成历史及 QQ 消息，通过；损坏备份被拒绝。真实 Docker 论文容器关闭后 restart=no、六开关=false，显式再次启动仍退出，通过。
- 最终版本本地结果：`E:\CodexData\build\Right\agent-server-preflight\20261122\cutover-real-c\verification.json`。本轮独立容器/网络清理，原先停止的本地 QQ 环境未恢复，线上状态未变化。
- 原服务器调度镜像本体仍未在本地完整验证。之前已验证其 70 个模块与历史源码一致，并在目标依赖/0166 上验证核心计划行为；当前还要求 `schema166CompatibilityEvidence` 指向与现场 imageId 相同、scope=original-image 的通过报告。只将 `schema166Compatible` 改为 true 不足以放行，开发替身报告与被替换的证据均会拒绝。
- `allExecutionServicesInventoried` 默认 false，现场需要确认全部 Docker/非 Docker Agent 执行入口后才可填写；工具还会拒绝项目内遗漏的 Agent 执行容器。不能因为当前队列空就忽略其他入口。
- 现有服务器仍未关闭论文、未生成新备份、未导入本次统一镜像、未生成生产私有记录或部署。当前交付是通过本地验证的运维工具，**不是已获准或已完成线上升级**。
