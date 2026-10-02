# GameHub 通用竞赛成绩与排行榜基础设施设计

> 状态：架构设计 v0.2，已完成第一次交叉评审；共享前置切片已完成，领域业务仍待实施（见 [实施状态](game-services-implementation-status.zh-CN.md)）<br>
> 日期：2026-10-02<br>
> 首个验收游戏：2048 类确定性单人游戏<br>
> 适用对象：Web 游戏、Agent 内嵌游戏、Windows 游戏，以及平台权威多人对局

## 1. 决策摘要

GameHub 现有多人基础设施解决的是房间、席位、实时连接、规则适配器、服务端权威对局和结算；它可以产生可信的多人比赛结果，但不能完整覆盖 2048、跑酷、解谜、计时挑战等“独立游玩后提交成绩”的场景。

平台应新增一项横向能力：**Competition / Leaderboards（竞赛成绩与排行榜）**。它不是 2048 专用接口，也不替换多人基础设施，而是接收不同来源的标准化、可验证竞赛结果：

```text
单人游戏运行记录 ──回放验证──┐
多人权威对局 ─────服务端结算──┼──> 统一成绩账本 ──> 排行榜投影
平台第一方挑战 ───服务端计算──┘                     ├─ 全站榜
                                                     ├─ 关注榜
                                                     ├─ 自己附近
                                                     └─ 历史赛季
```

核心结论：

1. 排行榜不能接受浏览器直接写入的“最终分数”作为可信成绩。
2. 排名规则必须声明式、版本化；不得允许游戏上传任意 JavaScript、SQL 或比较器。
3. 每次竞赛先由平台签发运行会话，再提交证据；验证器根据证据重新计算成绩。
4. 可信与非可信成绩必须分层，公开竞技榜默认只收录平台验证通过的成绩。
5. 排行榜按作品、模式、规则版本、榜单和赛季隔离，避免游戏更新后新旧规则混排。
6. 2048 只作为第一种验证器和验收样例，核心表、API、SDK 和状态机不得出现 2048 专属字段。
7. 2 核 4G 可以作为封闭内测起点，但必须通过统一资源门禁和混合负载测试验证；不要求在开工前立即引入独立服务器或 Redis 排行榜。

## 2. 与现有基础设施的边界

### 2.1 直接复用

| 现有能力 | 复用方式 |
| --- | --- |
| 用户身份、登录与隐私 | 成绩始终绑定平台用户；查询遵守屏蔽、注销和主页可见性规则 |
| 作品、发布版本与启动描述 | 竞赛运行绑定 `workId`、`releaseId`，禁止客户端自行声明来源 |
| Web 游戏 MessageChannel 桥 | 新增 `competition.*` 方法，令牌仍只保留在父页面 |
| 多人对局与规则适配器 | 权威终局事件转换为统一竞赛结果，不重复实现房间和实时服务 |
| Worker 与任务租约 | 异步验证、超时回收、榜单投影和重算 |
| 管理后台与审计 | 增加成绩作废、赛季冻结、验证器健康和异常成绩治理 |
| 社交关系 | 支持全站、关注者和自己附近等查询范围 |
| 创作者审核与发布流程 | 竞赛定义和验证器随发布审核，不允许未经审核直接进入公开榜 |

### 2.2 必须新增

- 竞赛模式与排行榜定义。
- 赛季版本、冻结和历史查询。
- 竞赛运行会话与一次性运行凭证。
- 证据上传、摘要和保留策略。
- 验证器注册表及隔离执行协议。
- 仅追加的标准化成绩账本。
- 每用户最佳成绩的排行榜投影。
- 通用查询 API、Web Game SDK 和宿主桥方法。
- 作废、重算、申诉证据和完整审计。

### 2.3 明确不做

- 不把 `localStorage`、客户端内存或客户端声称的分数作为可信来源。
- 不允许 Web ZIP 携带服务端代码并在平台主进程中执行。
- 不构建一个万能、可上传代码的反作弊系统。
- 不在首期支持现金奖励、博彩、付费锦标赛或强法律合规赛事。
- 不把访问量、游玩时长等分析指标混进竞技成绩账本。

## 3. 成熟平台设计原则

### 3.1 定义版本化，成绩只追加

修改规则、计分方式、随机算法或验证器，都必须创建新的 `rulesetVersion`，不能原地改变历史成绩含义。已接受的结果不可直接覆盖；同一来源纠错通过追加 decision/result-set revision 并原子切换 source head 完成。

### 3.2 排名只使用确定类型

排名字段只允许：

- 有符号 64 位整数；
- 以整数表示的毫秒、步数、关卡数；
- 固定精度整数，例如把 12.34 存为 1234；
- 枚举值仅用于分组，不参与自由比较。

禁止使用浮点数直接排名，避免跨语言和跨平台精度差异。

### 3.3 服务器决定身份与时间

`userId`、`workId`、`releaseId`、服务器开始时间、截止时间和接受时间均由平台产生。游戏只能提交动作证据和允许的客户端摘要，不能覆盖这些字段。

### 3.4 验证等级不可伪装

每条结果都有明确的 `verificationLevel`：

| 等级 | 来源 | 公开竞技榜 |
| --- | --- | --- |
| `authoritative` | 平台多人规则服务或平台服务端直接计算 | 允许 |
| `replay_verified` | 平台按种子和动作回放后重新计算 | 允许 |
| `reviewed_import` | 管理员审核的历史导入 | 可配置，必须标识 |
| `client_reported` | 仅客户端声明，无法可靠复算 | 默认禁止，只用于开发/休闲展示 |

同一公开榜不得把 `client_reported` 与已验证成绩无标识混排。

### 3.5 核心通用，验证器具体

核心只理解“模式、运行、证据、指标、结果、排名”。每种游戏的规则存在独立验证器中。平台提供固定输入输出协议、资源边界和审核流程，而不是试图用一个算法理解所有游戏。

## 4. 领域标识与隔离维度

一项可排名成绩的完整身份为：

```text
workId
+ modeKey
+ rulesetVersion
+ leaderboardKey
+ seasonVersion
```

- `workId`：平台作品。
- `modeKey`：作品内稳定模式，如 `classic`、`time_attack`。
- `rulesetVersion`：决定初始状态、合法动作和计分的不可变版本。
- `leaderboardKey`：同一模式可有多张榜，如 `best_score`、`fastest_finish`。
- `seasonVersion`：某张榜的时间窗口版本。
- `releaseId`：记录产生结果的具体发布版本，用于审计；多个经过审核且规则相同的发布可写入同一规则版本。

数据库中使用内部 UUID 关联；对创作者暴露的 `modeKey` 和 `leaderboardKey` 采用小写 ASCII、数字、短横线，发布后不可改名，只能停用并创建新定义。

## 5. 数据模型

建议新增独立数据库迁移，表名使用 `competition_` 前缀。

### 5.1 `competition_modes`

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `work_id` | 所属作品 |
| `mode_key` | 作品内稳定键 |
| `title` / `description` | 展示信息 |
| `ruleset_version` | 不可变规则版本 |
| `ruleset_digest` | 标准化规则配置摘要 |
| `verifier_id` / `verifier_version` | 已审核验证器 |
| `verification_level` | 此版本可产出的最高验证等级 |
| `run_policy_json` | 时限、并发数、证据上限等受控配置 |
| `status` | `draft/review/active/retired` |

唯一约束：`(work_id, mode_key, ruleset_version)`。

### 5.2 `competition_leaderboard_definitions`

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `mode_id` | 所属规则模式 |
| `leaderboard_key` | 稳定键 |
| `metric_schema_json` | 指标白名单及类型 |
| `ranking_clauses_json` | 有序排名子句 |
| `entry_policy` | 首期固定 `best_per_user` |
| `visibility` | `public/unlisted/private` |
| `status` | `draft/active/retired` |

排名子句示例：

```json
[
  { "metric": "score", "direction": "desc" },
  { "metric": "moves", "direction": "asc" },
  { "metric": "durationMs", "direction": "asc" }
]
```

平台在最后自动追加 `achievedAt ASC, participantResultId ASC`，保证并列成绩顺序确定。首期不支持创作者自定义比较代码。

### 5.3 `competition_seasons`

| 字段 | 说明 |
| --- | --- |
| `id` | UUID 主键 |
| `leaderboard_id` | 榜单定义 |
| `version` | 单调递增版本 |
| `starts_at` / `ends_at` | UTC 时间窗口 |
| `timezone` | 日历赛季所用 IANA 时区 |
| `status` | `draft/scheduled/active/closing/frozen/archived` |
| `late_submission_grace_seconds` | 已签发运行的宽限期 |

重置排行榜的正确方式是冻结旧赛季并创建新版本，绝不删除旧数据。日榜、周榜也按版本生成，不能依赖查询时临时截断历史。

### 5.4 `competition_runs`

| 字段 | 说明 |
| --- | --- |
| `id` | 不可猜测 UUID |
| `user_id` / `mode_id` / `release_id` | 服务端绑定上下文 |
| `season_snapshot_json` | 开始时适用的榜单和赛季 |
| `seed` / `rng_algorithm` | 可选的服务端随机源 |
| `public_config_json` | 验证所需且可暴露的不可变配置 |
| `config_digest` | 配置摘要 |
| `issued_at` / `expires_at` | 服务端时间 |
| `status` | 运行状态 |
| `idempotency_key_hash` | 创建幂等键 |
| `client_context_json` | 平台允许的版本/设备诊断信息 |

运行状态机：

```text
issued -> active -> submitted -> verifying -> accepted
                   |             |          -> rejected
                   |             -> failed_retryable
                   -> abandoned
issued/active --------------------------------> expired
```

状态只能由服务端按允许的边迁移。

### 5.5 `competition_evidence`

保存动作证据的元数据，正文可以首期存 PostgreSQL `bytea`，后续迁移对象存储：

- `run_id`、`content_type`、`encoding`；
- 未压缩长度和压缩长度；
- SHA-256 摘要；
- 分片数量、上传完成时间；
- 存储位置；
- 保留期限和删除时间。

数据库保存的摘要和结果不可随证据正文过期而删除。

### 5.6 `competition_submissions`

一次运行最多完成一次不可变提交，提交与最终成绩分开：

- `id`、`run_id`（唯一）；
- 完整证据摘要、`evidence_id`；
- `received_at`：API 收到完整证据并原子接受 `finish` 的服务端时间；
- `idempotency_key_hash`、请求摘要；
- `status`：`received/verifying/decided/failed_retryable`；
- `current_decision_id`：当前有效验证判定指针。

重复 `finish` 只返回同一 submission；不能以重复请求创建第二次提交。

### 5.7 `competition_verification_decisions`

每次验证或人工纠错产生不可变判定：

- `id`、`submission_id`、单调 `decision_revision`；
- `verdict`：`accept/reject/platform_error`；
- 规范化指标输出或稳定拒绝码；
- `verification_level`、`verifier_id/version/digest`；
- `started_at`、`decided_at`、资源统计；
- `supersedes_decision_id`、审计关联 ID。

唯一约束：`(submission_id, decision_revision)`。验证器重试可以产生多个 attempt，但只有形成业务判定时才追加 decision；平台故障重试不会伪装成玩家的新提交。

### 5.8 `competition_result_sets` 与 `competition_participant_results`

权威成绩账本按“来源结果集合”建模，避免单人 run 和多人 match 使用互相矛盾的唯一键。

`competition_result_sets`：

- `id`；
- `source_type`：`single_run/multiplayer_match/platform_event`；
- `source_id`：runId、matchId 或平台事件 ID；
- `result_revision`：同一来源的纠错版本，单调递增；
- `decision_id`：单人回放来源的判定，可为空；
- `status`：`accepted/invalidated/superseded`；
- `supersedes_result_set_id`、理由、审计 ID；
- `effective_event_seq`、`superseded_event_seq`：支持按账本水位重建历史有效视图；
- `accepted_at`。

唯一约束：`(source_type, source_id, result_revision)`。

`competition_result_source_heads` 使用 `(source_type, source_id)` 唯一键指向当前有效 result set。纠错时追加新 result set 和参与者行，并在同一事务更新 head；旧集合标记 superseded/invalidated，不能覆盖或删除。

`competition_participant_results`：

- `id`、`result_set_id`、`user_id`、可选 `participant_key/team_key`；
- `work_id`、`mode_id`、`release_id`；
- `metrics_json` 及受控索引列；
- `season_id`、`source_received_at`、`achieved_at`；单人来源取 submission.received_at，多人来源取权威终局被平台接受的时间；
- `verification_level`。

唯一约束：`(result_set_id, participant_key)`；单人运行恰好一行，多人比赛每位参与者一行。排行榜只消费 source head 指向集合中的有效参与者成绩。

### 5.9 排行榜投影代际

`competition_projection_generations`：

- `id`、`leaderboard_id`、`season_id`、`generation`；
- `status`：`building/catching_up/active/retired/failed`；
- `snapshot_event_seq`、`caught_up_event_seq`；
- 构建摘要、行数、开始/完成时间。

`competition_leaderboard_state` 以 `(leaderboard_id, season_id)` 唯一键保存 `active_generation_id` 和当前事件水位。

`competition_leaderboard_entries` 是可重建读取投影：

- `generation_id`、`user_id`；
- `best_participant_result_id`；
- 排名用规范化指标列、`achieved_at`、`updated_at`。

唯一约束：`(generation_id, user_id)`。新旧代可以并存；首期每个玩家每代只保留一个最佳条目。

### 5.10 事件、审计与治理表

- `competition_ledger_events`：结果、作废、恢复的单调事件序列/outbox；
- `competition_result_moderation_actions`：作废、恢复、备注和操作者；
- `competition_verification_attempts`：租约、耗时、结果码和资源统计；
- `competition_projection_jobs`：重算代际、快照水位、追赶游标和完成状态。

所有管理员动作写入既有审计系统，理由必填。

## 6. 运行与提交流程

### 6.1 启动

1. 游戏调用宿主桥 `competition.runs.start`，只传 `modeKey` 和客户端幂等键。
2. 父页面先创建短期 game session；iframe 永远拿不到平台令牌或 gameSessionId。
3. API 从服务端 game session 确定用户、作品、发布版本、channel 和已批准能力，校验模式已激活、发布版本获准、用户未被限制。
4. API 创建运行，签发种子、算法版本、公开配置、截止时间和证据限制。
5. SDK 将这些受控数据返回给游戏。

### 6.2 游玩

游戏在本地即时渲染。对于回放验证模式，游戏记录最小动作序列，而不是持续上传画面或每一帧状态。断网不自动使已开始的运行失效，但必须在截止时间前完成提交。

### 6.3 证据上传

现有桥单消息上限约 32 KiB，不能把大型回放塞进一次 RPC。新增分片协议：

```text
competition.evidence.begin
competition.evidence.append
competition.evidence.commit
competition.runs.finish
```

约束：

- 默认总证据上限 256 KiB；模式可申请提高，平台硬上限首期 2 MiB。
- 单分片正文固定不超过 16 KiB，分片序号严格递增。现有 32 KiB 上限作用于完整 JSON 信封，Base64 与字段开销使 32 KiB 正文必然超限。
- `begin` 声明总长度、编码和 SHA-256；`commit` 必须匹配。
- Competition 与 Cloud Save 共用同一个受限分片传输合同和宿主实现；父页面流式转发给 API，不把长期令牌交给游戏。
- 限制压缩比、解压后长度和解析深度，防止压缩炸弹。
- 未完成上传按 TTL 清理。

### 6.4 完成与验证

1. `finish` 只创建一个 submission；重复请求返回同一状态，不能产生第二个提交。
2. 客户端可附带 `clientSummary` 供 UI 即时显示，但它不是排名依据。
3. Worker 租用验证任务，在受限环境中执行注册验证器。
4. 验证器从种子和动作序列重放，输出规范化指标或稳定错误码。
5. API 追加 verification decision、result set 和 participant result，更新 source head，并通过同事务 outbox 产生账本事件。
6. 若新结果优于当前条目则替换投影，否则保留当前最佳，但尝试历史仍可查询。

## 7. 验证器协议

### 7.1 固定输入

```json
{
  "protocolVersion": 1,
  "workId": "...",
  "modeKey": "classic",
  "rulesetVersion": 1,
  "releaseId": "...",
  "seed": "...",
  "rngAlgorithm": "xoshiro128ss-v1",
  "publicConfig": {},
  "issuedAt": "...",
  "expiresAt": "...",
  "evidence": {
    "contentType": "application/vnd.gamehub.actions+json",
    "sha256": "...",
    "path": "/input/evidence"
  }
}
```

### 7.2 固定输出

```json
{
  "protocolVersion": 1,
  "decision": "accept",
  "metrics": {
    "score": 18452,
    "moves": 912,
    "maxTile": 2048,
    "durationMs": 346221
  },
  "facts": {
    "completed": true
  },
  "reasonCode": null
}
```

验证器不能返回用户、作品、赛季或排名；这些由平台上下文决定。`reasonCode` 使用稳定枚举，例如 `ILLEGAL_ACTION`、`EVIDENCE_TRUNCATED`、`RULESET_MISMATCH`、`LIMIT_EXCEEDED`、`VERIFIER_ERROR`。

### 7.3 执行安全

验证器沿用规则适配器的可信发布思路，但采用一次性批处理执行：

- 只运行平台审核并构建的固定镜像/制品摘要；
- 非 root、只读根文件系统、无网络；
- 独立临时目录，仅挂载只读输入；
- CPU、内存、进程数、输出字节和执行时间限制；
- 验证器标准输出只能是协议 JSON，日志单独限长；
- 超时或崩溃为平台错误，可重试，不应立即判玩家作弊；
- 相同输入必须得到相同输出，发布前运行确定性测试向量。

创作者提交的是源码和测试向量，经平台审核、构建和登记后才能成为公开榜验证器；不能由游戏运行时指定验证器地址或代码。

## 8. 排名、并列与赛季

### 8.1 最佳成绩更新

首期只实现 `best_per_user`：

- 按定义的排名子句逐项比较；
- 完全相同时，较早 `achievedAt` 优先；
- 再相同时，以 `participantResultId` 稳定排序；
- 作废最佳成绩后，从该用户在相同榜单和赛季的其余有效结果中重选。

`latest`、累计积分、段位分和团队榜以后作为不同投影策略加入，不能偷用 `best_per_user` 表达。

### 8.2 赛季切换

- 定时任务提前创建 `scheduled` 下一赛季；到 `ends_at` 时下一赛季变为 `active`，旧赛季从 `active` 进入 `closing`，而不是立即 frozen。
- `closing` 后停止为旧赛季签发新运行，但允许已在 `ends_at` 前签发的运行完成上传。
- 赛季归属以运行快照加 `competition_submissions.received_at` 判定：只有完整证据已经 commit，且 API 在 `ends_at + late_submission_grace_seconds` 前原子接受 `finish`，才进入旧赛季。
- Worker 何时完成验证不影响赛季归属；队列积压不能把合规提交推到新赛季。
- 宽限期结束后停止接受旧赛季 submission，继续等待已接收 submission 的验证、纠错和投影追赶。
- 所有已接收 submission 得到终局判定、投影追到最终账本水位后，赛季才从 `closing` 进入 `frozen`。
- `frozen` 后不再接受普通 submission；管理员纠错仍可通过审计追加 result-set revision 和账本事件，但不重开赛季，读取端继续显示旧活动投影，直到新投影代安全切换。
- 历史赛季永久可按版本查询，是否公开由榜单策略决定。

状态机：

```text
draft -> scheduled -> active -> closing -> frozen -> archived
```

跨边界上传以 `finish` 被服务端接受为准：只上传了部分证据、只完成 evidence commit 但未 finish、或客户端声称已在截止前完成，都不能获得旧赛季资格。

### 8.3 查询范围

首期标准范围：

- `global`：符合隐私和治理规则的全站用户；
- `following`：当前用户关注的人加自己；
- `around_me`：自己排名前后固定窗口；
- `top`：榜首分页。

查询返回名次、规范化指标、达成时间、验证等级、公开用户摘要和 participant result ID，不返回原始证据。

## 9. 平台 API 草案

所有写接口要求登录、CSRF/来源校验、限流和幂等；客户端不能提交 `userId`。

```text
GET  /v1/works/{workId}/competition/modes
POST /v1/competition/runs
GET  /v1/competition/runs/{runId}
POST /v1/competition/runs/{runId}/evidence/begin
PUT  /v1/competition/runs/{runId}/evidence/chunks/{index}
POST /v1/competition/runs/{runId}/evidence/commit
POST /v1/competition/runs/{runId}/finish
POST /v1/competition/runs/{runId}/abandon

GET  /v1/works/{workId}/leaderboards/{leaderboardKey}
GET  /v1/works/{workId}/leaderboards/{leaderboardKey}/me
GET  /v1/me/competition/runs
```

创作者控制面：

```text
POST /v1/creator/works/{workId}/competition/mode-proposals
GET  /v1/creator/works/{workId}/competition/modes
GET  /v1/creator/works/{workId}/competition/verification-health
```

管理员控制面：

```text
POST /v1/admin/competition/modes/{id}/approve
POST /v1/admin/competition/result-sources/{sourceType}/{sourceId}/correct
POST /v1/admin/competition/result-sets/{id}/invalidate
POST /v1/admin/competition/leaderboards/{id}/rebuild
POST /v1/admin/competition/seasons/{id}/freeze
```

分页使用不透明游标；API 不接受任意排序字段。公开读取设置合理缓存，用户附近和关注榜为私有响应。

## 10. Web Game SDK 与清单

### 10.1 能力协商

启动握手新增 `competition` 能力。只有作品发布版本绑定了至少一个已激活模式时，宿主才声明此能力。

当前 `packages/player-core/src/index.mjs` 仅在 `descriptor.capabilities.multiplayer` 为真时创建桥。Competition 与 Cloud Save 必须先共同完成通用 `createWebGameHost` 切片：任一批准的桥能力都可创建通道，handler 按 capability 注册，frame stop/账号切换/release 撤下统一销毁，旧 multiplayer 行为有完整回归测试。证据和存档共用 16 KiB 正文分片、摘要、顺序、TTL 与中止合同；不得分别实现两套近似传输器。

公开 catalog launch descriptor 不是写入授权。可信宿主在挂载游戏前通过认证 API 创建短期 game session，服务端绑定：

```text
userId + workId + releaseId + channel
+ approvedCapabilities + allowedModeIds
+ issuedAt + expiresAt + revocationGeneration
```

每次创建运行、上传证据和 finish 都从 game session 解析并复核作用域；忽略或拒绝客户端自带的用户/作品/release/模式范围。iframe 只得到 MessagePort，不得到 cookie、gameSessionId 或 bearer。Agent/Windows 用一次性 ticket 交换同等作用域的短期 token。该授权证明平台允许访问，不能证明客户端代码未被修改，因此仍需验证器和权威来源。

SDK 方法：

```js
const modes = await gamehub.competition.listModes();
const run = await gamehub.competition.start({
  modeKey: 'classic',
  idempotencyKey: crypto.randomUUID()
});

await gamehub.competition.uploadEvidence(run.id, actionBytes, {
  contentType: 'application/vnd.gamehub.actions+json'
});

const submission = await gamehub.competition.finish(run.id, {
  clientSummary: { score: 18452 }
});
```

SDK 必须明确显示 `clientSummary` 只是临时 UI 信息，最终结果以异步验证响应为准。

### 10.2 发布清单

作品可以声明希望接入的模式，但清单只是提案，不是授权：

```json
{
  "capabilities": ["competition"],
  "competition": {
    "modes": [
      {
        "key": "classic",
        "rulesetVersion": 1,
        "evidenceFormat": "actions-v1"
      }
    ]
  }
}
```

发布校验器检查字段格式、SDK 版本和模式引用；平台审核决定它是否可写公开榜。

## 11. 2048 首个参考接入

2048 采用 `replay_verified`，而不是信任页面显示的分数。

### 11.1 平台签发

- 初始随机种子；
- 固定 PRNG 算法和版本；
- 棋盘尺寸、生成方块概率、规则版本；
- 运行截止时间；
- 最大动作数和证据字节数。

首期把完整种子交给 2048 客户端只适用于休闲性质的“规则回放已验证”榜；它意味着客户端可以预演未来随机序列，不能据此宣传实时公平。

### 11.2 游戏提交

动作证据只包含方向序列和必要的客户端时序信息，例如：

```json
{
  "format": "2048-actions-v1",
  "moves": ["L", "U", "R", "D"]
}
```

不得提交初始棋盘、后续随机数或可控制生成方块的状态。

### 11.3 验证器计算

验证器使用同一种子完整重放，自己计算：

- `score`；
- `maxTile`；
- `moves`；
- 是否已结束；
- 合法的服务端观察时长或受限客户端时长。

首张榜建议：

```json
{
  "leaderboardKey": "classic-score",
  "ranking": [
    { "metric": "score", "direction": "desc" },
    { "metric": "maxTile", "direction": "desc" },
    { "metric": "moves", "direction": "asc" }
  ]
}
```

客户端自报 `score` 与复算值不同直接拒绝或仅记录诊断；不得“取两者较小值”后接受。

### 11.4 关于计时榜

纯 Web 客户端无法提供强可信的精确操作时长。首期 2048 不应把客户端 `durationMs` 作为主要公开排名指标。若以后做速通榜，应采用平台开始/提交时间、前后台可见性信号和更严格的暂停规则，并在产品上说明其可信边界。

### 11.5 随机信息与公平性边界

`replay_verified` 只证明“这份动作证据在指定规则和随机序列下能得到该结果”，它不能证明：

- 玩家按实时顺序、不可回退地完成操作；
- 玩家没有提前读取公开种子并预演未来随机方块；
- 玩家没有使用搜索器挑选高分路径；
- 证据来自真人而非程序或复制的解法。

2048 首期可以接受这一边界，但产品必须标记为“规则回放已验证”，不能宣称强反作弊或实时公平。不要用回放验证结果发放有现实价值的奖励。

隐藏牌序、战争迷雾或未来随机信息影响决策的游戏，不能在开始时把完整种子交给客户端后仍宣称同等公平。它们必须选择：

1. 服务端权威地按需产生和披露下一随机事件；
2. 在线随机服务使用秘密 PRF/承诺值，逐步返回事件并记录服务端收据，终局再审计；
3. 降级为明确标识的休闲 replay-verified 榜；
4. 不开放公开排行榜。

具体模式的公平声明属于已审核规则定义的一部分，不得仅依据 `verificationLevel` 自动生成夸大文案。

## 12. 多人游戏接入统一成绩账本

现有多人规则服务已经是权威来源。对局进入终态后，由服务端转换器产生标准结果：

- `sourceType = multiplayer_match`；
- `sourceId = matchId`，在 `competition_result_source_heads` 上唯一，防止重复结算；
- 一次对局生成一个 result set，每位参赛者产生一条 participant result，指标可包含胜负、回合数、用时和经规则服务计算的积分变化；
- `verificationLevel = authoritative`；
- 原始对局事件和快照作为审计证据引用。

房间、匹配、掉线重连仍由多人基础设施处理。Competition 模块只消费终局，不反向控制对局状态。

Elo、Glicko 或赛季积分属于“排名投影策略”，与最佳分数榜不同。首期不要为了 2048 同时重构多人段位；后续可以让两者共享成绩账本和查询外壳，但保留不同投影器。

## 13. 安全与滥用防护

### 13.1 必须实现

- 每用户每模式的活动运行数上限，默认 2。
- 创建、分片、完成和榜单查询的用户/IP/设备分层限流。
- 运行过期、一次提交、幂等键和数据库唯一约束。
- 证据摘要、严格结构校验、大小/深度/动作数限制。
- 验证器无网络、资源配额、稳定错误码和重试上限。
- 异常高分、异常完成速度、重复证据摘要和密集重开检测。
- 作废不物理删除，保留管理员、原因和时间。
- 隐私、屏蔽和注销处理与社交系统一致。

### 13.2 风险分级

| 风险 | 处理 |
| --- | --- |
| 修改前端变量 | 验证器不采信最终分数 |
| 构造非法动作 | 回放时拒绝 |
| 重放旧提交 | run 唯一且只能完成一次 |
| 猜测他人运行 ID | 不可猜 UUID + 所有权校验 |
| 超大/恶意证据 | 分片、总量、解压和解析限制 |
| 验证器供应链 | 审核、固定摘要、无网络、制品签名/来源记录 |
| 机器人自动游玩 | 统计检测与治理；首期不承诺完全阻止 |
| 修改游戏逻辑但伪装版本 | 发布 ID、规则摘要和允许列表绑定 |

必须诚实说明：回放验证可证明“这串动作在该规则下得到这个结果”，不能证明动作一定由人类完成。需要人机对抗时再增加行为分析、挑战或客户端完整性能力。

## 14. 运维、容量与当前服务器方案

### 14.1 2 核 4G 首期部署

- API、Worker 和 PostgreSQL 继续在现有部署中运行。
- 竞赛验证自身并发设为 1，但不能把这个数字视作整机资源保证。
- 2048 回放应为毫秒级 CPU 工作，单任务设置短超时。
- 榜单直接查询投影表并建立复合索引，不用每次扫描全部结果。
- Redis 可用于以后热点缓存和分布式锁，但不是首期正确性的依赖。
- 证据量较小时存 PostgreSQL；接入 OSS 后只迁移正文，数据库仍保留摘要和定位信息。

2 核 4G 仅是封闭内测的待验证起点。平台必须建立跨域资源门禁，将 PostgreSQL/API/Realtime 置于最高优先级，存档当前正文写入和比赛终局提交次之，竞赛验证再次，榜单重建/导出/源码构建/规则构建/批量迁移最低。同一时刻只允许一个重型后台任务占用 CPU/磁盘预算；数据库 p95、Realtime event-loop lag、WAL、磁盘剩余或备份窗口越线时暂停后台任务。正式开放前必须运行实时对局、存档写、竞赛验证和构建/备份的混合负载测试。

建议索引：

```text
competition_runs(user_id, mode_id, status, issued_at desc)
competition_submissions(run_id unique, received_at)
competition_result_sets(source_type, source_id, result_revision)
competition_participant_results(mode_id, user_id, source_received_at desc)
competition_leaderboard_entries(generation_id, <ranking columns>, achieved_at, best_participant_result_id)
competition_verification_attempts(status, lease_expires_at)
```

排名指标必须在激活榜单时生成受控的投影列/索引方案，不能对任意 JSON 表达式开放查询。

### 14.2 监控指标

- 活动运行数、签发/提交/接受/拒绝率；
- 验证队列深度、最老任务年龄、p50/p95 验证耗时；
- 各 `reasonCode` 数量；
- 验证器超时、崩溃和重试次数；
- 榜单查询 p95、投影延迟、重算进度；
- 单用户/单作品异常提交速率；
- 证据存储量和清理失败数。

告警优先级：验证器系统性失败、队列持续增长、投影与账本不一致、磁盘水位，其次才是个别玩家成绩被拒绝。

## 15. 管理与创作者体验

### 15.1 创作者页面

创作者应能看到：

- 模式和规则版本状态；
- 榜单定义与当前赛季；
- SDK 接入示例、测试向量和本地验证命令；
- 最近验证成功率、稳定错误码分布；
- 发布版本是否获准写入榜单；
- 申请新规则版本或验证器审核的入口。

创作者不能直接编辑已激活规则、修改玩家成绩或绕过审核激活公开榜。

### 15.2 管理员页面

管理员需要：

- 模式/验证器审核队列；
- 运行、结果和证据摘要检索；
- 异常高分与异常频率列表；
- 单条结果作废/恢复；
- 冻结赛季、停用模式、暂停验证器；
- 从账本重建榜单及一致性校验；
- 所有操作审计和影响范围预览。

## 16. 故障处理与一致性

- 创建运行使用幂等键；API 超时后重试返回同一运行。
- 每个 `run_id` 最多一个 submission；重复完成返回原状态。重验追加 decision，纠错追加 result set revision，不创建第二个 submission。
- 验证采用租约，Worker 崩溃后可重新领取；验证器必须确定性。
- 结果写入与投影更新尽量同事务；若拆为异步，结果账本提交后写 outbox，投影可重放。
- 榜单投影是派生数据，任何时候都能从有效结果重建。
- 所有结果、作废和恢复在同一事务写 `competition_ledger_events` 单调事件序列。
- 重建先创建 `building` generation，并记录账本快照水位 `S`；按 `effective_event_seq <= S AND (superseded_event_seq IS NULL OR superseded_event_seq > S)` 选择当时有效的 result sets，构建截至 `S` 的完整条目。不能在长事务外直接读取“当前 head”冒充历史快照。
- 完成基础构建后进入 `catching_up`，按事件序列应用 `S+1...N`。在排行榜 state 行短事务锁内再次追到最新水位，原子把 `active_generation_id` 切到新代。
- 切换后新事件只投递到活动代；旧代转为 retired 并延迟清理。查询始终只读取活动代，不会看到半张榜。
- 若追赶期间持续高写入无法收敛，任务让出并稍后重试短切换窗口，不能长时间锁住成绩提交。
- 验证器故障时状态保持 `failed_retryable`，不把平台故障显示成玩家作弊。

## 17. 分阶段实施路线

### C0：合同与骨架

- 先完成 Cloud Save 共用的通用 Web Game Host、短期 game session 授权上下文和 16 KiB 分片传输合同。
- 数据库迁移和领域仓储。
- 竞赛定义、运行状态机、固定错误码。
- OpenAPI/共享合同、权限与审计模型。
- Worker 任务租约和空验证器注册表。

验收：状态迁移、幂等、越权和数据库约束测试通过，无前端游戏接入。

### C1：通用运行与榜单核心

- 运行签发、证据分片、完成和查询 API。
- 结果账本、`best_per_user` 投影、赛季版本。
- 全站、关注、自己附近查询。
- 管理员作废和重建。

验收：使用平台测试验证器完成端到端流程；故意重复和越权请求不能污染榜单。

### C2：Web SDK 与 2048 验证接入

- `competition` 能力协商、SDK 和宿主桥。
- 2048 确定性 PRNG、动作格式、验证器和测试向量。
- 2048 游戏改为由平台签发运行，公开显示验证状态和榜单。

验收：篡改自报分数无效；非法动作被拒；相同种子/动作跨环境产生相同指标；榜单可查询。

### C3：创作者工作流

- 模式提案、验证器源码审核、受控构建和发布绑定。
- 创作者接入指南、示例游戏、契约测试工具。
- 验证健康页和错误诊断。

验收：第二款不同类型的游戏无需修改核心表和核心 API 即可接入。**这是“足够通用”的硬性验收标准。**

### C4：多人结果统一与高级投影

- 多人终局到成绩账本的幂等转换。
- 权威战绩查询外壳。
- 按实际产品需要新增 Elo/Glicko、团队榜或累计赛季积分投影。

验收：多人游戏继续使用原房间/规则系统，同时可通过统一榜单读取层展示权威排行。

## 18. 完成定义

只有同时满足以下条件，才能称为平台通用竞赛基础设施完成：

1. 不修改核心表/API 即可接入至少两种规则不同的游戏。
2. 客户端不能通过直接提交分数进入可信公开榜。
3. 规则、验证器和赛季全部版本化，历史可解释。
4. 重复、超时、断网重试和 Worker 崩溃不会生成重复结果。
5. 榜单能从成绩账本完整重建并通过一致性校验。
6. 作废、恢复、冻结和重算都有权限与审计。
7. Web iframe 不接触平台令牌，证据上传受大小和资源限制。
8. 隐私、屏蔽、注销和关注榜行为有自动化测试。
9. 创作者有接入文档、示例、测试向量和明确审核流程。
10. 2048 端到端通过后，再用第二款非 2048 游戏完成通用性验证。

## 19. 推荐的首期工程拆分

为降低返工，按以下模块组织，而不是在 2048 页面内直接加接口：

```text
apps/api/src/competition/                 # 控制面与查询 API
apps/worker/src/competition/              # 验证任务、赛季、投影与重建
packages/contracts/src/competition/       # API/桥/错误码合同
packages/platform-client/src/web-game-host/ # 与 Cloud Save 共用的宿主核心
packages/platform-client/src/competition/ # Competition handler
packages/web-game-sdk/src/competition/    # 创作者 SDK
packages/competition-verifier-sdk/        # 验证器输入输出与测试工具
verifiers/2048/                           # 首个具体验证器
docs/                                     # 创作者指南、API 与运维手册
```

实际仓库若已有集中路由或 Worker 目录，应遵循现有结构；模块边界不应因此消失。

## 20. 已确定事项与暂缓事项

### 已确定

- 使用独立 Competition 模块，不扩充 Guess Baike 专用排行接口。
- 使用运行会话 + 证据 + 验证器，而非直接写分。
- 第一版公开榜只接收 `authoritative` 和 `replay_verified`。
- 第一种投影为每用户最佳成绩；赛季采用版本化冻结。
- 2048 采用服务端种子和动作回放。
- 当前 2 核 4G 可作为封闭内测起点；是否承载公开负载由统一资源门禁和混合压测结果决定。

### 暂缓但已留扩展点

- Elo/Glicko、团队榜、锦标赛和奖励发放。
- OSS 证据正文存储和多区域部署。
- 高强度机器人识别和客户端完整性证明。
- 允许第三方验证器的完全自动化沙箱发布。
- 跨作品总榜；它需要先定义可比较的统一指标，不应直接混合不同游戏分数。

## 21. 业界设计参照

本设计吸收但不照搬以下成熟平台做法：

- [Steam Leaderboards 官方文档](https://partner.steamgames.com/doc/features/leaderboards?language=english)：榜单按应用持久化、每用户一条、支持升/降序、保留最佳或强制更新，并可限制为可信服务端写入。
- [PlayFab Leaderboards 官方文档](https://learn.microsoft.com/en-us/xbox/playfab/community/leaderboards/)：多列排序、元数据和确定性并列处理。
- [PlayFab 可重置统计与排行榜](https://learn.microsoft.com/en-us/gaming/playfab/community/leaderboards/tournaments-leaderboards/using-resettable-statistics-and-leaderboards)：以版本创建新榜并保留历史，而不是原地清空。
- [PlayFab Statistics 官方文档](https://learn.microsoft.com/en-us/gaming/playfab/player-progression/statistics/)：统计定义、版本和排行榜投影分离。

GameHub 额外强调创作者内容的隔离运行、回放验证和发布审核，因为平台承载的是多创作者作品，不能假设所有游戏客户端或上传代码天然可信。

## 22. 游戏类型适配矩阵

“通用”不等于所有游戏都使用同一种验证办法。平台核心保持不变，但根据游戏特征选择证据与验证等级：

| 游戏类型 | 推荐证据 | 验证方式 | 首期支持结论 |
| --- | --- | --- | --- |
| 2048、数独、棋盘解谜 | 服务端种子 + 离散动作序列 | 确定性回放 | 优先支持 |
| 计步、关卡闯关 | 关卡版本 + 离散输入/关键事件 | 规则状态机回放 | 支持 |
| 回合制单人卡牌 | 服务端逐步披露随机事件 + 选择序列 | 权威随机收据或回放 | 支持，但不能预先公开完整隐藏牌序 |
| 平台多人回合制 | 权威对局事件 | 多人规则服务直接结算 | 支持，无需再次回放 |
| 跑酷、平台跳跃 | 输入时间线 + 固定物理版本 | 固定步长模拟回放 | 后续支持，跨引擎确定性风险较高 |
| 节奏游戏 | 谱面版本 + 输入时间戳 | 时间窗复算 | 后续支持，需要校准延迟策略 |
| 实时射击、复杂物理 | 高频输入、服务端状态 | 权威或专用服务器 | 不属于首期轻量验证器范围 |
| 随机抽卡或纯运气游戏 | 服务端随机源 + 选择记录 | 服务端复算 | 技术可支持，但不建议做竞技主榜 |
| 玩家创作/主观评分 | 投票和治理事件 | 不是游戏成绩验证 | 使用独立社区排行，不能复用竞技分数榜 |

若某款游戏无法在合理资源内复算，可以选择：

1. 仅提供标有“未经验证”的休闲成绩；
2. 改为服务端权威运行；
3. 暂不开放公开排行榜。

平台不能为了“看起来都支持”而降低可信榜的定义。

## 23. 默认策略表

所有可配置项必须有安全默认值，避免开发人员或创作者遗漏配置后产生开放式行为。

| 策略 | 默认值 | 说明 |
| --- | --- | --- |
| 公开榜允许的验证等级 | `authoritative`, `replay_verified` | 其余等级必须显式标识且不能默认进入公开榜 |
| `replay_verified` 展示文案 | “规则回放已验证” | 不使用“真人”“实时”“不可回退”或“强反作弊”表述 |
| 活动运行数 | 每用户、每模式 2 个 | 超出返回稳定冲突错误 |
| 运行有效期 | 2 小时 | 模式可在审核后缩短或延长 |
| 单分片正文 | 最大 16 KiB | 完整 JSON 信封仍须小于现有 32 KiB 桥限制 |
| 总证据大小 | 默认 256 KiB，平台硬上限 2 MiB | 提高需要审核 |
| 验证并发 | 当前服务器 1 | 防止抢占实时服务资源 |
| 验证超时 | 默认 2 秒，硬上限 10 秒 | 具体模式需基准测试 |
| 验证内存 | 默认 128 MiB，硬上限 256 MiB | 超限按平台错误处理 |
| 失败重试 | 平台错误最多 3 次 | 规则拒绝不重试 |
| 排行条目策略 | 每用户最佳一条 | 全部尝试保留在历史记录中 |
| 并列处理 | 指标序列 → 达成时间 → participant result ID | 平台自动追加最终稳定条件 |
| 赛季宽限期 | 5 分钟 | 只适用于赛季结束前签发的运行 |
| 证据热存储 | 30 天 | 有申诉/治理标记的证据延长保留 |
| 成绩账本 | 长期保存 | 注销时按隐私策略去标识化，而非破坏榜单事实 |
| 原始客户端摘要 | 最长 7 天 | 只用于诊断，不作为事实来源 |

配置上限属于平台策略，不由创作者清单覆盖。

## 24. 标准错误码与用户呈现

HTTP 状态码只能表达协议大类；客户端逻辑必须依赖稳定业务错误码。错误响应统一包含 `code`、安全的 `message`、`requestId`，必要时包含 `retryAfterSeconds`。

| 错误码 | HTTP | 是否重试 | 面向玩家的建议 |
| --- | ---: | --- | --- |
| `COMPETITION_MODE_NOT_ACTIVE` | 409 | 否 | 当前挑战暂不可用 |
| `COMPETITION_RELEASE_NOT_ALLOWED` | 403 | 否 | 请更新到受支持的游戏版本 |
| `COMPETITION_RUN_LIMIT_REACHED` | 429 | 稍后 | 继续已有挑战或稍后再试 |
| `COMPETITION_RUN_EXPIRED` | 410 | 否 | 本次挑战已过期，请重新开始 |
| `COMPETITION_RUN_ALREADY_FINISHED` | 409 | 查询原结果 | 显示已有提交状态，不重复上传 |
| `COMPETITION_EVIDENCE_TOO_LARGE` | 413 | 否 | 本次记录无法提交，记录诊断编号 |
| `COMPETITION_EVIDENCE_DIGEST_MISMATCH` | 422 | 可重新上传一次 | 上传校验失败 |
| `COMPETITION_EVIDENCE_INCOMPLETE` | 422 | 是 | 补传缺少分片 |
| `COMPETITION_ILLEGAL_ACTION` | 422 | 否 | 本次成绩未通过规则验证 |
| `COMPETITION_RULESET_MISMATCH` | 409 | 否 | 游戏版本与挑战规则不一致 |
| `COMPETITION_VERIFICATION_PENDING` | 202 | 轮询/订阅 | 成绩验证中，不显示为失败 |
| `COMPETITION_VERIFIER_UNAVAILABLE` | 503 | 是 | 平台稍后自动重试 |
| `COMPETITION_RESULT_INVALIDATED` | 410 | 否 | 成绩已被撤销，可显示申诉/说明入口 |
| `COMPETITION_SEASON_FROZEN` | 409 | 否 | 当前赛季已结束 |

验证器内部堆栈、路径、镜像名和安全策略不得返回给游戏。玩家作弊嫌疑也不能仅凭一次格式错误就公开标记；前端应区分“规则拒绝”“上传失败”和“平台验证故障”。

## 25. 数据保留、隐私与删除

### 25.1 数据分类

| 数据 | 分类 | 保留建议 |
| --- | --- | --- |
| 榜单公开条目 | 公开派生数据 | 随赛季历史保留 |
| 成绩账本 | 平台业务记录 | 长期保留，支持去标识化 |
| 动作证据 | 受限业务数据 | 默认 30 天，争议/异常时延长 |
| IP、设备和风控摘要 | 安全数据 | 最小化采集，按安全策略短期保留 |
| 验证日志 | 运维数据 | 30～90 天，严格脱敏 |
| 管理员审计 | 合规与治理数据 | 长期保留 |

### 25.2 账户注销

- 不再公开显示昵称、头像和主页链接。
- 排行产品可选择删除该用户的公开投影，或显示匿名占位；首期推荐从公开投影移除。
- 成绩账本保留不可逆内部主体引用，以维持审计和反重复提交能力。
- 原始证据若没有争议、风控或法律保留要求，应进入提前清理队列。
- 关注榜和屏蔽关系实时生效，不复制成永久公开快照。

### 25.3 创作者权限边界

创作者能查看自己作品的聚合验证健康和玩家主动授权的诊断内容，不能下载所有玩家原始动作证据，也不能查看 IP、设备指纹或平台风控标签。需要排查验证器问题时，由平台生成脱敏测试样本或管理员协助。

## 26. 协议和兼容性治理

平台涉及四个独立版本，不能只维护一个“SDK 版本”：

| 版本 | 变化范围 | 兼容规则 |
| --- | --- | --- |
| `bridgeProtocolVersion` | iframe 与父页面消息 | 主版本不兼容；握手时协商 |
| `competitionApiVersion` | HTTP 合同 | `/v1` 内只做向后兼容增加 |
| `rulesetVersion` | 游戏规则和计分 | 不兼容即新版本，历史不迁移 |
| `evidenceFormatVersion` | 动作证据编码 | 验证器显式声明可读取版本 |
| `verifierVersion` | 验证器实现 | 修复不改变规则时也保留制品摘要和重验记录 |

兼容要求：

- 新增 JSON 字段默认可忽略；删除、改名、改变含义需要新主版本。
- 所有枚举接收端必须能处理未知值，UI 显示通用降级文本。
- SDK 发布前以旧宿主/新 SDK、新宿主/旧 SDK 双向矩阵测试。
- 服务器至少保留仍有活跃发布版本所需的验证器制品。
- 验证器修复若可能改变结果，必须先做影子重放和差异报告；不得直接覆盖历史。

## 27. 数据库不变量

实现时必须通过数据库约束而非仅靠应用代码保证以下不变量：

1. 一个运行最多有一个不可变 submission，但可有多次验证 attempt 和追加的 decision revision。
2. 一个来源在 source head 中只有一个当前 result set；纠错通过递增 result revision 和原子切换 head 完成。
3. 同一 result set 内每个 participant key 最多一条 participant result。
4. 一个用户在一张榜的一个投影 generation 最多有一个条目；不同代可以并存。
5. 已激活规则定义的关键字段不可原地修改。
6. closing 赛季不能签发新运行；超过宽限期不能接受旧运行的新 submission；frozen 赛季不能接受普通账本变化。
7. 作废或 superseded source head 中的参与者成绩不能继续作为最佳条目来源。
8. 榜单引用的指标必须存在于模式的指标定义中，类型与方向合法。
9. 运行绑定的发布版本必须属于同一作品。
10. 结果中的主体、模式和发布版本必须继承可信运行/对局来源，不能由提交覆盖。
11. 活动投影指针只能指向同一榜单/赛季且状态为 active 的 generation。
12. 审计动作必须有操作者、原因和关联请求 ID。

建议采用唯一索引、外键、检查约束和限制更新的数据库触发器。服务测试需故意绕过正常 API 写入，验证数据库仍会拒绝破坏不变量的数据。

## 28. 验收测试矩阵

### 28.1 合同与权限

- 未登录用户不能创建运行或上传证据。
- A 用户不能读取、上传、结束或放弃 B 用户的运行。
- iframe 从任何响应中都无法获得父页面访问令牌。
- 客户端提交额外的 `userId/workId/releaseId/seasonId` 会被拒绝或忽略，不得生效。
- 未激活模式、未审核发布和退休规则不能创建新运行。
- 公开 launch descriptor、父页面自报 workId 或被复制的 MessageChannel 请求不能代替有效 game session。
- game session 过期、账号切换、release 禁用和 revocation generation 提升后，旧作用域不能继续创建运行或提交证据。
- 只有 cloudSave、只有 competition、只有 multiplayer 及多能力组合均能创建/销毁通用桥，旧多人流程不回归。

### 28.2 幂等与并发

- 同一创建幂等键的并发请求只产生一个运行。
- 相同分片重传内容一致时成功，内容不一致时拒绝。
- 两个 `finish` 并发请求只产生一个 submission 和一个首轮验证任务。
- 两个 Worker 抢同一任务时只有一个获得有效租约。
- 两条成绩同时刷新最佳记录时，投影仍符合完整排序规则。
- 对同一 submission 重验会追加 decision；纠错会追加 result set revision 并原子切换 source head，旧历史仍可审计。

### 28.3 验证与攻击输入

- 篡改自报分数不改变验证器计算结果。
- 删除、插入、乱序和越界动作均得到稳定拒绝码。
- 超大 JSON、深层嵌套、压缩炸弹、无效 UTF-8 和错误摘要被边界层拒绝。
- 验证器超时、崩溃、输出垃圾和输出超限进入可重试平台故障，不误判玩家。
- 相同测试向量在开发机、CI 和生产镜像输出完全一致。
- 使用公开种子预演未来随机序列仍会通过规则一致性验证；产品测试必须确认 UI 没有把它描述为真人、实时或不可回退证明。
- 隐藏牌序模式不得在运行开始时返回完整随机种子，并有逐步披露/权威随机收据测试。

### 28.4 排行榜正确性

- 升序、降序和多指标排序均有并列测试。
- 成绩相同时按达成时间、participant result ID 稳定排序。
- 较差的新成绩不会替换个人最佳，但会进入尝试历史。
- 作废最佳成绩后自动回退到下一条有效成绩。
- 重建前后榜单条目、顺序和摘要完全相同；building 代和 active 代可同时存在且查询不会混代。
- 重建快照后并发产生新成绩、作废和恢复事件，catch-up 后原子切换不会漏事件或重复应用。
- 赛季切换边界使用可控时钟覆盖 active→closing、部分上传、完整 evidence 未 finish、宽限期内 finish、宽限期外 finish、验证队列积压及最终 frozen。

### 28.5 社交与隐私

- 全站、关注和自己附近范围结果正确。
- 屏蔽双方、私密主页、注销用户不会泄露不应显示的身份信息。
- 创作者无法查看其他作品数据或玩家原始安全信息。
- 管理员作废、恢复和重建都有不可篡改审计记录。

### 28.6 容量与恢复

- 至少以预期内测峰值 10 倍运行榜单查询和提交压测。
- Worker 停止、重启和租约过期后任务能恢复。
- 数据库事务失败不会留下“有结果、无投影且无重建任务”的静默状态。
- 证据存储不可用时禁止创建无法完成的新运行，或明确降级为不计榜模式。

## 29. 发布、灰度和回滚

### 29.1 上线顺序

1. 先部署数据库和只读代码路径，功能开关保持关闭。
2. 部署 Worker 与验证器，但只运行平台测试向量。
3. 对管理员测试账号开启运行签发和隐藏测试榜。
4. 对 2048 小范围账号灰度，比较客户端摘要与服务端复算差异。
5. 观察至少一个完整内测周期后开放公开榜。
6. 第二款不同类型游戏接入成功后，再宣布“通用能力可供创作者申请”。

建议功能开关：

```text
competition.core.enabled
competition.evidence_upload.enabled
competition.verification.enabled
competition.public_leaderboards.enabled
competition.creator_proposals.enabled
```

开关只能缩小能力，不能绕过验证等级和权限约束。

### 29.2 回滚原则

- API/前端回滚不能回滚数据库事实；迁移优先使用向前修复。
- 关闭公开榜时保留成绩账本和已上传证据，不丢弃待处理任务。
- 验证器异常时暂停对应 `mode + rulesetVersion`，不能停掉全部游戏。
- 错误榜单投影直接隐藏并从账本重建，禁止手工编辑排名行。
- 新旧版本并行期间，旧客户端若不支持 `competition`，游戏仍可正常游玩但不计入榜单。

## 30. 开工前置检查表

开始 C0 代码工作前必须全部满足：

- [ ] 其他工作会话已提交，主工作区无来源不明的未提交核心代码。
- [ ] 从最新 `origin/main` 创建独立 worktree 和 `codex/competition-foundation` 分支。
- [ ] 确认最新数据库迁移编号，避免与并行任务冲突。
- [ ] 运行当前主分支完整测试并记录基线。
- [ ] 确认现有 Worker 的租约、重试和 outbox 模式，优先复用。
- [ ] 确认 Web 桥的消息大小、二进制传输和能力协商现状。
- [ ] 与 Cloud Save 共同确定通用 Web Game Host、game session 授权和 16 KiB 分片合同，不在 Competition 内重复实现。
- [ ] 确认 2048 源码许可、规则版本和随机算法实现可用于服务端验证。
- [ ] 建立 2048 黄金测试向量：种子、动作、每步棋盘、最终指标。
- [ ] 为新增端点完成威胁建模和权限表。
- [ ] 决定内测榜是否对普通用户可见及其产品文案。

未满足前置项时可以继续写合同和测试计划，但不应在共享脏工作区直接修改 API、迁移和 SDK。

## 31. 架构评审结论

本方案的通用性来自稳定的抽象边界，而不是功能数量：

- **运行**表示一次由平台授权的尝试；
- **证据**表示可供独立判断的输入记录；
- **验证器**把游戏特定规则封装在受控边界内；
- **结果账本**保存不可变事实；
- **排行榜投影**按可版本化策略派生视图。

只要新游戏能把自己的成绩证明映射到这五个概念，就不需要修改平台核心。无法安全映射的游戏应使用更强的权威服务器方案，或者明确降级为非可信休闲榜，而不是在核心中加入例外。

经过第一次交叉评审后，数据模型、赛季关闭和投影重建合同已经具备启动共享前置切片与 C0 的条件；在通用桥、game session 授权和影子投影 spike 通过前，不应宣称全部工程可直接全面展开。真正证明其通用性的节点不是 2048 上线，而是 2048 之后第二种不同验证模型的游戏接入仍不需要改动核心合同和数据结构。

跨存档与竞赛的推荐实施顺序固定为：

```text
修订合同与数据库不变量
  -> 通用 Web Game Host + 短期 game session + 统一分片
  -> 存档最小可靠闭环（含本机 outbox 与恢复）
  -> 2048 replay-verified 排行榜
  -> 第二款不同存档结构游戏 + 迷阵权威多人结果接入
```

保持 Cloud Save、Competition 和 Multiplayer 的领域数据分离；当前阶段不需要为了代码组织而新建独立部署微服务。
