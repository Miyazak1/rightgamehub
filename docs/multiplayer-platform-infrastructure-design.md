# GameHub 多人游戏平台基础设施设计

> 状态：Draft / 可进入实施评审  
> 首期适用范围：双人、低频、回合制游戏（以类象棋游戏为首个接入方）  
> 设计目标：多人能力由 GameHub 平台统一提供，具体游戏只实现自己的规则与表现层。

## 1. 背景与决策

GameHub 后续不会只有一个对战游戏。如果每款游戏各自实现登录、房间、匹配、断线重连、结算、战绩和排行榜，将产生重复开发、不一致的用户体验，以及客户端伪造结果等问题。

因此新增平台级多人游戏基础设施。首期针对回合制场景建设，但协议和数据模型不写死“象棋”“双人”或某种棋盘结构。

核心决策：

1. 平台统一负责身份、启动凭证、房间、席位、匹配、实时连接、生命周期、可信结算、战绩和排行。
2. 游戏规则由服务端权威执行；客户端只提交“意图”，不能直接提交最终局面或胜负。
3. PostgreSQL 保存持久数据；Redis 保存在线状态、短期房间状态、连接路由、限流和定时任务。
4. 采用事件序列加周期快照，以支持断线恢复、审计和回放。
5. 首期不建设高频动作游戏同步、语音、锦标赛和跨区域部署。
6. 第一方游戏规则适配器作为可信服务端代码部署。用户上传的任意 EXE/ZIP 不得在平台服务端直接执行。

## 2. 目标与非目标

### 2.1 首期目标

- 支持 2～8 人房间模型，首个模式实际使用 2 人。
- 支持公开、私密、邀请码三类房间。
- 支持创建、加入、离开、准备、开始、认输、结束和异常中止。
- 支持 Web、GameHub Agent 内嵌页、Windows 游戏客户端接入。
- 支持一次性启动凭证，Windows 客户端不保存 GameHub 密码或长期令牌。
- 支持 WebSocket 消息、心跳、确认、幂等、顺序、重连和状态快照。
- 支持服务端规则校验、可信结果、基础 Elo 排名和完整对局记录。
- 支持管理员查看在线人数、房间、对局、异常和服务健康状态。
- 支持单机部署起步，并为后续水平扩展保留连接路由和消息总线。

### 2.2 首期非目标

- 20Hz～60Hz 的动作、射击或物理状态同步。
- 平台运行创作者上传的未受信任服务端代码。
- 语音、视频、直播推流。
- 大型锦标赛、战队、公会和复杂赛季奖励。
- 跨地域低延迟路由及全球服。
- 通用反作弊客户端驱动或内核能力。

## 3. 服务边界

```text
Web / Agent Webview / Windows Game
                |
        HTTPS + WebSocket
                |
      Caddy / Edge Routing
          |             |
      apps/api      apps/realtime
          |             |
          +------ Redis +------+
          |                      |
       PostgreSQL          Rules Adapters
          |
        Worker
```

### 3.1 现有 API 服务

负责控制面和持久资源：

- 游戏、模式和版本查询。
- 启动凭证与实时连接凭证签发。
- 房间列表、房间详情和历史对局查询。
- 匹配请求的创建和取消。
- 排名、战绩和回放查询。
- 管理员查询与治理操作。

### 3.2 新增 realtime 服务

建议新增独立应用 `apps/realtime`，即使首期和 API 部署在同一台机器，也保持独立进程：

- 接受和维护 WebSocket 连接。
- 鉴权、心跳、在线状态与连接路由。
- 串行处理房间和对局命令。
- 调用规则适配器校验并产生权威事件。
- 将消息发送给房间成员和观察者。
- 生成快照、触发结算、处理掉线宽限期和操作超时。

不要将 WebSocket 会话存在 API 进程内，否则 API 重启、扩容或滚动发布会使职责混乱。

### 3.3 Worker

- 清理过期房间、连接凭证和匹配票据。
- 处理超时对局、掉线宽限期到期和延迟结算。
- 异步更新统计、成就和排行榜缓存。
- 检测卡住的房间或对局并告警。

### 3.4 Redis

首期用途：

- `presence:{userId}`：在线状态和最后心跳。
- `connection:{connectionId}`：连接所在 realtime 实例。
- `room:{roomId}:members`：活跃成员及瞬时状态。
- `match:{matchId}:lock`：单命令串行锁。
- `match:{matchId}:deadline`：回合及断线超时。
- `realtime:instance:{id}`：实例租约。
- Pub/Sub 或 Streams：跨实例广播与事件投递。
- 限流、一次性 ticket 消费和幂等键。

Redis 丢失不能造成已完成战绩丢失。权威事件和最终结果必须进入 PostgreSQL。

## 4. 权威模型与游戏接入等级

平台定义三种接入等级，避免把所有未来游戏强行塞进同一种可信模型。

### 4.1 `platform_authoritative`

规则适配器运行在 GameHub 服务端。平台验证每条命令并生成结果。首个类象棋游戏必须使用此模式；其战绩可进入官方排行榜。

### 4.2 `external_authoritative`（后续）

创作者运营独立游戏服务器，GameHub 使用签名服务凭证与回调协议接收结果。只有完成服务审核和签名校验后，结果才可进入认证排行榜。

### 4.3 `relay_unverified`（后续）

平台只提供房间、信令和转发，不判断游戏规则。结果只能标记为“非认证”，不得与权威对局共用排行榜。

## 5. 领域模型

所有主键使用 UUID。时间统一存储 UTC `timestamptz`。面向客户端的 ID 不暴露数据库自增序列。

### 5.1 `multiplayer_game_modes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 模式 ID |
| `game_id` | uuid FK | 平台作品/游戏 ID |
| `key` | text | 游戏内稳定键，如 `ranked_classic` |
| `name` | text | 展示名称 |
| `authority` | text | 三种权威模式之一 |
| `min_players` | smallint | 最少人数 |
| `max_players` | smallint | 最大人数 |
| `ruleset_version` | text | 规则版本 |
| `config` | jsonb | 计时、回合和可见性配置 |
| `enabled` | boolean | 是否可创建新对局 |
| `created_at/updated_at` | timestamptz | 审计时间 |

唯一约束：`(game_id, key)`。

### 5.2 `multiplayer_rooms`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 房间 ID |
| `mode_id` | uuid FK | 游戏模式 |
| `owner_user_id` | uuid FK | 房主 |
| `visibility` | text | `public/private/invite_only` |
| `status` | text | 房间状态机 |
| `join_code_hash` | text nullable | 邀请码只存哈希 |
| `capacity` | smallint | 席位数 |
| `settings` | jsonb | 允许公开的房间设置 |
| `revision` | bigint | 乐观并发版本 |
| `expires_at` | timestamptz | 空闲清理时间 |
| `created_at/updated_at` | timestamptz | 审计时间 |

索引：`(mode_id, status, visibility, created_at desc)`、`expires_at`。

### 5.3 `multiplayer_room_members`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `room_id` | uuid FK | 房间 |
| `user_id` | uuid FK | 玩家 |
| `seat` | smallint | 席位 |
| `role` | text | `player/spectator` |
| `ready` | boolean | 是否准备 |
| `connection_state` | text | `online/offline/grace` |
| `joined_at/left_at` | timestamptz | 加入离开时间 |

主键：`(room_id, user_id)`；唯一约束：活动成员的 `(room_id, seat)`。

### 5.4 `multiplayer_matches`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 对局 ID |
| `room_id` | uuid nullable | 来源房间 |
| `mode_id` | uuid FK | 模式 |
| `ruleset_version` | text | 本局固定规则版本 |
| `status` | text | 对局状态机 |
| `revision` | bigint | 当前局面版本 |
| `next_event_seq` | bigint | 下一个服务端事件序号 |
| `turn_user_id` | uuid nullable | 当前行动玩家 |
| `turn_deadline_at` | timestamptz nullable | 服务端权威截止时间 |
| `started_at/ended_at` | timestamptz | 对局时间 |
| `termination_reason` | text nullable | 正常、认输、超时等 |
| `result` | jsonb nullable | 规则适配器输出的最终结果 |
| `created_at/updated_at` | timestamptz | 审计时间 |

索引：`(mode_id, status)`、`turn_deadline_at`、`ended_at desc`。

### 5.5 `multiplayer_match_players`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `match_id` | uuid FK | 对局 |
| `user_id` | uuid FK | 玩家 |
| `seat` | smallint | 席位 |
| `team` | smallint nullable | 队伍编号 |
| `result` | text nullable | `win/loss/draw/none` |
| `rating_before/after` | integer nullable | 结算前后分数 |
| `connected_at/disconnected_at` | timestamptz | 连接时间 |

主键：`(match_id, user_id)`。

### 5.6 `multiplayer_match_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `match_id` | uuid FK | 对局 |
| `seq` | bigint | 服务端单调序号 |
| `event_type` | text | 规则事件或平台事件 |
| `actor_user_id` | uuid nullable | 操作者 |
| `command_id` | uuid nullable | 对应客户端命令 |
| `payload` | jsonb | 事件数据 |
| `state_hash` | text | 应用事件后的规范化状态哈希 |
| `created_at` | timestamptz | 发生时间 |

主键：`(match_id, seq)`；`(match_id, command_id)` 唯一，用于命令幂等。

### 5.7 `multiplayer_match_snapshots`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `match_id` | uuid FK | 对局 |
| `event_seq` | bigint | 已包含到的事件 |
| `ruleset_version` | text | 解码规则版本 |
| `state` | jsonb | 服务端完整状态 |
| `public_state` | jsonb | 可直接发给普通观察者的状态 |
| `state_hash` | text | 状态哈希 |
| `created_at` | timestamptz | 创建时间 |

主键：`(match_id, event_seq)`。首期每 10 个规则事件以及结束时保存快照。

### 5.8 匹配、赛季和积分

- `multiplayer_matchmaking_tickets`：玩家/队伍、模式、分段、区域、状态、过期时间。
- `multiplayer_seasons`：游戏模式、起止时间、状态、配置。
- `multiplayer_ratings`：`(season_id, mode_id, user_id)` 唯一，保存分数、场次、胜负和更新时间。
- `multiplayer_rating_changes`：记录每次对局引起的分数变化，保证可审计和可重算。

首期可先建表但只实现 Elo；匹配队列可排在房间功能稳定之后。

## 6. 状态机

### 6.1 房间状态

```text
open -> starting -> in_match -> closed
  |         |                    ^
  +------> closed <--------------+
```

- `open`：可加入、离开、准备和修改允许的设置。
- `starting`：席位和规则版本已冻结，正在创建对局。
- `in_match`：已绑定唯一对局，不允许再变更玩家席位。
- `closed`：终态。空房过期、房主关闭、创建对局失败或对局结束后进入。

`starting -> open` 只允许在对局尚未创建且启动事务失败时发生。

### 6.2 对局状态

```text
pending -> active -> finishing -> completed
   |          |           |
   +----------+-----------+--> aborted
```

- `pending`：对局记录已创建，等待参与者建立连接或确认初始状态。
- `active`：接受规则命令。
- `finishing`：拒绝新规则命令，正在持久化结果和积分。
- `completed`：结果、最后快照和积分均已提交。
- `aborted`：不可恢复的版本、规则或基础设施错误；与玩家主动退出区分。

任何状态转换都在数据库事务中检查当前状态和 `revision`，禁止跨状态跳转。

## 7. 身份与启动流程

### 7.1 Web / Agent 内嵌页

1. 页面使用现有 GameHub 登录会话调用 API。
2. 客户端调用 `POST /v1/realtime/tickets`。
3. API 返回 30 秒有效、仅能消费一次的连接 ticket。
4. 客户端通过 `wss://<host>/v1/realtime?ticket=<ticket>` 连接。
5. realtime 原子消费 ticket，返回 `session.ready`。

禁止把长期 access token 放在 WebSocket URL 中，以免进入代理日志和浏览器历史。

### 7.2 Windows 游戏

1. 用户从 GameHub Agent 点击“启动”。
2. Agent 调用 `POST /v1/game-launch-tickets`，传入 `gameId`、`releaseId` 和随机 PKCE challenge。
3. API 返回 60 秒有效、一次性的 launch ticket。
4. Agent 通过命令行参数或环境变量把 ticket 和本地回调端口交给游戏；不得传递长期登录令牌。
5. 游戏调用 `POST /v1/game-launch-tickets/exchange`，带 verifier 换取短期 game session token。
6. game session token 限定具体游戏、版本和多人权限，默认 2 小时有效，可受控续期。
7. 游戏再用 game session token 换取一次性 realtime ticket。

Agent 日志不得记录 ticket、verifier 或 session token。游戏进程退出后，Agent 尽力吊销 session；服务端仍以到期时间为最终保证。

## 8. REST API 草案

所有变更请求支持 `Idempotency-Key`。错误统一返回：

```json
{
  "error": {
    "code": "ROOM_FULL",
    "message": "房间已满",
    "requestId": "uuid",
    "details": {}
  }
}
```

### 8.1 模式与房间

- `GET /v1/games/{gameId}/multiplayer-modes`
- `GET /v1/multiplayer/rooms?modeId=&cursor=&visibility=public`
- `POST /v1/multiplayer/rooms`
- `GET /v1/multiplayer/rooms/{roomId}`
- `POST /v1/multiplayer/rooms/{roomId}/join`
- `POST /v1/multiplayer/rooms/{roomId}/leave`
- `POST /v1/multiplayer/rooms/{roomId}/ready`
- `POST /v1/multiplayer/rooms/{roomId}/start`
- `POST /v1/multiplayer/rooms/{roomId}/close`

创建房间请求示例：

```json
{
  "modeId": "uuid",
  "visibility": "invite_only",
  "capacity": 2,
  "settings": {
    "turnSeconds": 60,
    "spectators": false
  }
}
```

服务端仅接受该模式 schema 中允许的设置，不能原样信任任意 JSON。

### 8.2 匹配

- `POST /v1/multiplayer/matchmaking/tickets`
- `GET /v1/multiplayer/matchmaking/tickets/{ticketId}`
- `DELETE /v1/multiplayer/matchmaking/tickets/{ticketId}`

同一用户在同一模式只能存在一张活动票据。匹配成功后服务端创建房间和对局，客户端只接收结果。

### 8.3 对局、战绩和回放

- `GET /v1/multiplayer/matches/{matchId}`
- `GET /v1/multiplayer/matches/{matchId}/events?afterSeq=`
- `GET /v1/multiplayer/matches/{matchId}/replay`
- `GET /v1/users/{userId}/multiplayer-stats?gameId=&modeId=`
- `GET /v1/multiplayer/leaderboards/{modeId}?seasonId=&cursor=`

私密信息和玩家私有状态不得进入公开回放。规则适配器必须分别产生玩家视图和观察者视图。

### 8.4 管理接口

- `GET /v1/admin/multiplayer/overview`
- `GET /v1/admin/multiplayer/rooms`
- `GET /v1/admin/multiplayer/matches`
- `POST /v1/admin/multiplayer/rooms/{roomId}/close`
- `POST /v1/admin/multiplayer/matches/{matchId}/abort`
- `POST /v1/admin/multiplayer/users/{userId}/suspend`

管理员强制操作必须写入审计日志，包含操作者、原因、目标和时间。

## 9. WebSocket 协议

协议版本独立于产品版本。首期使用 `gamehub.realtime.v1`。

### 9.1 消息信封

```json
{
  "v": 1,
  "id": "uuid",
  "type": "match.command",
  "sentAt": "2026-09-30T12:00:00.000Z",
  "roomId": "uuid",
  "matchId": "uuid",
  "clientSeq": 12,
  "expectedRevision": 18,
  "payload": {}
}
```

服务端事件增加：

```json
{
  "v": 1,
  "id": "uuid",
  "type": "match.event",
  "matchId": "uuid",
  "seq": 19,
  "revision": 19,
  "causedBy": "客户端命令 UUID",
  "payload": {}
}
```

### 9.2 平台消息类型

客户端到服务端：

- `session.resume`
- `heartbeat.ping`
- `room.subscribe` / `room.unsubscribe`
- `room.ready`
- `match.command`
- `match.resign`
- `match.sync.request`

服务端到客户端：

- `session.ready`
- `heartbeat.pong`
- `command.ack` / `command.rejected`
- `room.snapshot` / `room.member.changed`
- `match.started`
- `match.event`
- `match.snapshot`
- `match.completed` / `match.aborted`
- `session.replaced`
- `server.draining`
- `error`

### 9.3 可靠性约定

- WebSocket 传输有序，但重连后的业务投递按“至少一次”处理。
- 每个客户端命令必须带唯一 `id`；服务端按 `(matchId, commandId)` 去重。
- 每个对局事件具有严格递增 `seq`。
- 客户端保存最后应用的 `seq`，重复事件直接丢弃。
- `expectedRevision` 不匹配时返回 `REVISION_CONFLICT` 并附带最新 revision；客户端请求增量事件或快照。
- 单条消息上限 16 KiB；超过即拒绝并计入安全指标。
- 心跳默认 20 秒，连续 2 次未响应进入 `grace`。
- 默认重连宽限 120 秒，可由模式配置覆盖。

### 9.4 重连流程

1. 客户端重新换取 realtime ticket 并连接。
2. 发送 `session.resume`，包括活动 `matchId` 和 `lastAppliedSeq`。
3. 服务端验证玩家仍是对局成员。
4. 若缺失事件数量在阈值内，返回增量事件；否则返回最新快照及之后的事件。
5. 恢复成功前客户端禁止提交新的规则命令。

## 10. 规则适配器接口

第一方适配器作为 versioned package 被 realtime 加载。接口必须是确定性的；相同规则版本、初始状态和事件序列必须得到相同哈希。

```ts
interface MultiplayerRulesAdapter<State, Command, Event, Result> {
  readonly gameId: string;
  readonly modeKey: string;
  readonly rulesetVersion: string;

  createInitialState(input: InitialStateInput): State;
  validateCommand(ctx: CommandContext<State>, command: Command): ValidationResult;
  applyCommand(ctx: CommandContext<State>, command: Command): {
    state: State;
    events: Event[];
    outcome?: Result;
    nextTurnUserId?: string;
    nextDeadlineAt?: string;
  };
  handleTimeout(ctx: TimeoutContext<State>): AdapterTransition<State, Event, Result>;
  getPlayerView(state: State, userId: string): unknown;
  getSpectatorView(state: State): unknown;
  serializeState(state: State): unknown;
  deserializeState(value: unknown): State;
  hashState(state: State): string;
}
```

约束：

- 适配器不得直接访问数据库、Redis、网络或系统时间。
- 随机性只能使用平台提供并记录的 seed。
- 时间判断使用上下文传入的权威时间。
- 适配器升级必须更换 `rulesetVersion`；已开始对局继续使用原版本。
- 删除旧适配器前，必须保证其历史回放已迁移或保留兼容读取器。

## 11. 命令处理与事务

单条 `match.command` 的标准流程：

1. 验证连接身份、游戏权限、对局成员和限流。
2. 获取 `match:{id}:lock`，锁必须带短 TTL 和唯一持有者值。
3. 从缓存或最近快照加后续事件重建状态。
4. 检查对局状态、轮次、`expectedRevision` 和命令幂等键。
5. 调用规则适配器校验并应用命令。
6. 在同一 PostgreSQL 事务内插入事件、更新 match revision/turn/deadline；若结束则进入 `finishing`。
7. 提交后更新缓存并广播事件。数据库提交前不得向客户端报告成功。
8. 若产生结果，异步但幂等地完成最后快照、玩家结果和积分更新，再切换为 `completed`。
9. 释放锁；锁失效时仅允许持有者删除自己的锁。

结算任务按 `matchId` 唯一，重复执行必须得到同一结果且不能重复加减积分。

## 12. 排名与可信结果

首期每个 `mode + season` 独立 Elo：

- 初始分默认 1000。
- K 值和最低有效对局时长由模式配置。
- 只有 `platform_authoritative` 且 `completed` 的对局参与认证排名。
- 被管理员判定无效、适配器内部错误或双方均未完成初始化的对局不计分。
- 修改历史结果不能直接改总分；必须写冲正记录并可重放评分流水。

排行榜查询读取缓存或预聚合结果，不在每次请求时扫描全部对局。

## 13. 安全与治理

- 所有外部通信使用 HTTPS/WSS。
- ticket 使用至少 128 位随机值，数据库或 Redis 只保存哈希。
- ticket 一次消费、短期有效，并绑定用户、客户端、游戏和用途。
- 服务端拒绝客户端提交 `winner`、`rating`、`eventSeq` 和权威时间。
- 房间邀请码设置尝试次数限制；响应不能泄露房间是否存在。
- 用户级、IP 级、连接级和房间级限流分开设置。
- 聊天若以后加入，必须独立设计内容治理；首期不通过规则命令夹带自由文本。
- 房间设置、命令 payload 和适配器输出均进行 schema 校验。
- 管理员可按用户禁止多人功能，不影响其只读访问和单机游戏。
- 日志不记录 token、ticket、完整私密局面或用户输入文本。
- 公开观战默认关闭；每种游戏必须明确私有信息策略。

## 14. 部署与扩展

### 14.1 首期部署

- 在现有 Compose 中增加 `realtime` 和 Redis。
- Caddy 将 `/v1/realtime` 升级为 WebSocket 并转发到 realtime。
- API、realtime、worker 和 Redis 可位于现有服务器，但设置独立资源限制和健康检查。
- realtime 发布时先进入 draining：拒绝新连接、通知客户端重连、等待短时间后退出。
- Redis 开启持久化不是对局持久性的前提，但建议开启 AOF 以减少在线状态抖动。

### 14.2 水平扩展

- 每条连接只属于一个 realtime 实例。
- 实例通过 Redis 记录连接位置，并通过 Pub/Sub 或 Streams 转发跨实例消息。
- 对局命令通过分布式锁或一致性分片保证同一时间只有一个写者。
- 不依赖负载均衡粘性会话；重连可以落到任意健康实例。
- 当 Redis 消息总线成为瓶颈后，再评估 NATS/Kafka，不在首期引入。

## 15. 容量目标与限制

首期验收目标，不代表无限容量承诺：

- 单实例 1,000 条并发 WebSocket 连接。
- 200 局同时进行的低频回合制对局。
- 正常负载下命令确认 p95 小于 250 ms。
- 同城网络下重连状态恢复 p95 小于 2 秒（不含客户端网络中断时间）。
- 每用户默认每秒 5 条规则命令、突发 10 条；具体模式可更严格。
- 单房间广播成员上限由模式 `max_players` 和观战配置共同限制。
- 单条消息 16 KiB，单个快照压缩前建议不超过 256 KiB。

上线前使用真实协议完成 1,000 连接、200 活跃对局、滚动重启和 Redis 短暂中断测试。

## 16. 可观测性

### 16.1 指标

- `realtime_connections_current`
- `realtime_connections_total`
- `realtime_reconnect_total`
- `realtime_messages_total{direction,type}`
- `realtime_command_duration_ms{mode}`
- `realtime_command_rejected_total{reason}`
- `multiplayer_rooms_current{status,mode}`
- `multiplayer_matches_current{status,mode}`
- `multiplayer_match_completion_total{reason,mode}`
- `multiplayer_turn_timeout_total{mode}`
- `multiplayer_snapshot_duration_ms`
- `multiplayer_settlement_failures_total`
- Redis、PostgreSQL连接池、队列积压和 worker 延迟。

### 16.2 日志与追踪

每个请求、连接、房间和对局包含可关联的 `requestId`、`connectionId`、`roomId` 和 `matchId`。用户 ID 可记录内部 ID，但不得记录认证材料。关键路径至少覆盖：连接、命令、规则适配、数据库事务、广播和结算。

### 16.3 管理员面板

新增“多人服务”区块：

- 当前在线连接、在线玩家、等待房间和进行中对局。
- 今日创建/完成/异常对局。
- 命令延迟、拒绝率、重连率和异常终止率。
- 按游戏和模式拆分的数据。
- 卡住对局列表、最近错误和 realtime 实例健康状态。

## 17. 数据保留与隐私

- 房间瞬时状态：关闭后最多保留 7 天用于排障。
- 对局元数据、结果和评分流水：长期保留，按平台账户删除政策处理。
- 完整规则事件和回放：默认 180 天；被收藏、举报或赛事对局可延长。
- 服务日志：默认 30 天。
- 在线 presence：只保留当前状态及短期最后在线时间。
- 不采集项目路径、编辑器内容、提示词或与游戏无关的 Agent 活动。

删除用户时，对战历史可保留匿名占位以维护其他玩家战绩一致性，但公开资料和可识别字段必须移除。

## 18. 故障策略

| 故障 | 行为 |
| --- | --- |
| 客户端掉线 | 进入 grace，保留席位和计时规则；允许 ticket 重连 |
| realtime 实例退出 | 客户端连接其他实例，从快照/事件恢复 |
| Redis 短暂不可用 | 拒绝新连接和新命令，已提交事件不丢；恢复后重建 presence |
| PostgreSQL 不可用 | 不确认命令成功，不产生仅存在内存中的权威事件 |
| 规则适配器抛错 | 对局暂停或 aborted，记录错误，禁止错误结果进入排行 |
| 广播失败 | 数据库事件仍是事实来源；客户端重连或请求同步 |
| 结算任务失败 | match 保持 finishing，worker 幂等重试并告警 |
| 部署重启 | 先 draining；客户端自动重连，进行中对局不丢失 |

## 19. 测试策略

### 19.1 单元测试

- 房间和对局状态机所有合法/非法转换。
- 规则适配器的走子、胜负、超时和状态哈希。
- ticket 一次消费、过期、绑定和吊销。
- Elo 结算、冲正和幂等。
- payload schema、权限和限流。

### 19.2 属性与确定性测试

- 同一 seed、命令序列必须生成相同事件、状态和哈希。
- 任意重复命令不得产生第二组事件或第二次积分变化。
- 从任意快照加后续事件恢复的状态等于完整重放状态。
- 非当前玩家、过期回合和错误 revision 永远不能改变状态。

### 19.3 集成测试

- 两个用户从建房到结算的完整流程。
- 房间满员、并发抢座、并发开始。
- 断线、跨实例重连和增量恢复。
- API/realtime/worker 重启。
- Redis 与 PostgreSQL 短暂故障。
- 历史规则版本回放。
- Windows launch ticket 交换和 Agent 吊销。

### 19.4 端到端验收

1. 玩家 A 创建私密类象棋房间并分享邀请码。
2. 玩家 B 从 Web 或 Windows 客户端加入。
3. 双方准备后自动进入同一对局。
4. 非法操作被明确拒绝，合法操作双方顺序一致。
5. 任意一方断线后在宽限期内恢复同一局面。
6. 认输、将死或超时产生服务端可信结果。
7. 双方战绩、回放和排行榜只更新一次。
8. 管理员可以看到本局及其状态，但看不到认证材料。

## 20. 分阶段实施计划

### 阶段 0：契约与工程骨架（1 个迭代）

- 建立 multiplayer OpenAPI、WebSocket 协议 schema 和错误码表。
- 新建 `apps/realtime`、健康检查、配置加载和日志骨架。
- 在 Compose/Caddy 中加入 realtime 与 Redis。
- 建立共享类型/SDK 包，生成 TypeScript 客户端类型。
- 完成本设计文档评审并冻结 v1 信封格式。

验收：开发环境能建立鉴权 WebSocket，完成 ping/pong；CI 检查协议 schema。

### 阶段 1：房间与身份（1 个迭代）

- 增加数据库迁移：模式、房间、成员和审计字段。
- 实现 realtime ticket 与 Windows launch ticket。
- 实现建房、列表、加入、离开、准备、关闭。
- 实现 presence、心跳、掉线 grace 和房间广播。
- 平台客户端增加通用多人入口与房间 UI。

验收：两个真实账号可跨浏览器完成房间流程，刷新/短暂断网后席位不丢。

### 阶段 2：权威对局与类象棋适配器（1～2 个迭代）

- 增加 matches、players、events、snapshots 表。
- 实现命令锁、事件事务、revision、幂等和恢复。
- 实现类象棋规则适配器及确定性测试。
- 实现操作计时、认输、超时、结果和回放。
- 发布 Web 游戏 SDK 和 Windows 游戏 SDK 最小版。

验收：完整对局、断线恢复、服务重启恢复和回放一致性全部通过。

### 阶段 3：排名、管理与运营（1 个迭代）

- 增加赛季、Elo、评分流水和排行榜缓存。
- 休息室支持按游戏/模式切换排行榜。
- 管理面板加入多人服务指标和治理操作。
- 增加举报关联对局、审计和基础封禁。
- 将多人指标接入现有平台分析数据中心。

验收：结果和积分幂等；管理员能定位异常对局；排行榜不会混合不同游戏。

### 阶段 4：自动匹配与扩容验证（后续）

- 匹配票据、分段策略和等待时间扩圈。
- 多 realtime 实例和跨实例广播。
- 压测、滚动发布、故障注入和容量基线。
- 评估外部权威服务器接入协议。

### 20.1 当前实施状态（2026-09-30）

- 阶段 0 已完成：独立 realtime 服务、一次性 ticket、Redis、Caddy 路由、v1 信封和心跳已落地。
- 阶段 1 的控制面已完成：模式、公开/邀请房间、成员、席位、准备、房主转移和邀请码均由 PostgreSQL/API 管理。
- 阶段 1 的实时层已完成：房间订阅与快照、跨实例 Redis Pub/Sub、连接 presence、online/grace/offline、可配置重连宽限和 revision 冲突检测已落地。
- 通用客户端会话模块已完成：自动换取一次性 ticket、心跳、状态缓存、断线重连和 `session.resume` 可供 Web、Agent 与 Windows 壳复用。
- 阶段 2 的持久化骨架已完成：`0031_multiplayer_matches.sql` 已加入对局、冻结玩家、事件和快照；房主可通过幂等 API 将全员已准备房间原子转换为活动对局，参与者可读取对局与增量事件。
- `packages/rules-sdk` 已提供版本化适配器注册、确定性序列化与状态哈希接口；生产注册表当前保持为空，未安装真实规则适配器时启动会安全拒绝，不会创建不可恢复对局。
- 通用权威命令链路已完成：严格 WebSocket 命令协议、按连接串行、PostgreSQL 行锁、revision 冲突、commandId 幂等、事件/快照原子提交和 Redis 跨实例通知均已落地。
- 通用恢复与终态已完成：客户端按事件序号增量恢复、服务端按用户生成私有视图；认输由适配器结算，超时 worker 通过数据库截止时间安全抢占并幂等结束对局。
- 通用回放与治理已完成：参与者可读取经过隐私裁剪的事件回放；管理员可查看多人概览与对局列表、强制中止异常对局，所有强制操作写入数据库不可更新/删除的追加式审计表。
- 实时服务基础指标已完成：`/metrics` 暴露当前连接、累计连接、消息和命令失败计数，可由现有监控系统抓取；API 与 realtime 生产镜像均已完成构建验证。
- 阶段 1 尚余产品 UI 与双真实账号浏览器验收；阶段 2 尚余具体游戏适配器和使用真实适配器完成的端到端完整对局/回放验收。具体棋规不属于平台基础设施，将随游戏开发接入。

## 21. 建议的仓库改动清单

实施时优先按小型可审查 PR 拆分：

1. `apps/api/migrations/0030_multiplayer_core.sql`：模式、房间和成员。
2. `apps/api/migrations/0031_multiplayer_matches.sql`：对局、事件和快照。
3. `apps/api/migrations/0032_multiplayer_operations.sql`：管理员操作审计与治理约束。
4. 后续按已确认的排位产品规则新增赛季、积分和评分流水迁移；不得与基础对局事务耦合。
5. `apps/api/src/`：REST 控制面、ticket、查询与管理员接口。
6. `apps/realtime/`：WebSocket 网关、房间协调器、命令处理、恢复和健康检查。
7. `packages/multiplayer-protocol/`：消息 schema、错误码和生成类型。
8. `packages/game-sdk/`：浏览器及 Windows 游戏接入 SDK。
9. `packages/rules-sdk/`：服务端规则适配器接口和测试工具。
10. `packages/platform-client/`：大厅、房间、匹配和对局入口 UI。
11. GameHub Agent/Harness：launch ticket、进程启动、session 吊销与无敏感信息日志。
12. `deploy/compose.prod.yml` 与 Caddy 配置：Redis、realtime、WebSocket 路由和健康检查。
13. OpenAPI/契约测试、CI、负载测试和运维手册。

具体文件名若与仓库当前约定不同，以现有 workspace 和契约生成规则为准；不得复制第二套客户端类型或绕过现有 API client。

## 22. 开工前必须确认的产品参数

以下参数不阻塞工程骨架，但在阶段 1 结束前必须配置化确认：

- 类象棋房间是否默认公开、是否允许观战。
- 房主离开时转让房主还是关闭房间。
- 每回合计时、总局计时和掉线宽限规则。
- 是否允许未登录用户观战。
- 私密回放的可见范围。
- Elo 初始分、K 值、赛季周期和弃权计分。
- Windows 游戏退出后是否保留短期 session 供崩溃恢复。

默认建议：邀请码房间、禁止观战、每回合 60 秒、掉线宽限 120 秒、房主离开自动转让、回放仅参与者可见、初始 Elo 1000。

## 23. 完成定义

基础设施只有同时满足以下条件才视为首期完成：

- 新游戏无需重新实现登录、房间、连接、重连、结算和排行基础逻辑。
- 客户端无法伪造获胜、步序、服务端时间或积分。
- API/realtime 重启后进行中对局可以恢复。
- 同一命令、结算任务和网络重试不会产生重复事件或重复积分。
- Web、Agent 内嵌页和 Windows 客户端使用同一身份与实时协议。
- 管理员能够观测、定位和安全终止异常房间/对局。
- 关键流程有自动化测试、指标、日志、告警和部署回滚说明。

