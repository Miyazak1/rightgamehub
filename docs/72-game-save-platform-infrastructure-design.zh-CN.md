# GameHub 通用游戏存档基础设施设计

> 状态：架构设计 v0.2，已完成第一次交叉评审；共享前置切片、存档 S0 与 S1 在线链路已实现，实际游戏验收及后续阶段仍待完成（见 [实施状态](game-services-implementation-status.zh-CN.md)）<br>
> 日期：2026-10-02<br>
> 首个接入作品：A Dark Room 兼容改造版<br>
> 适用宿主：网站、Cursor/Agent 内嵌游戏、Windows 游戏客户端<br>
> 设计定位：平台底层服务，不是某个游戏的 `localStorage` 补丁

## 1. 决策摘要

GameHub 应建设独立的 **Cloud Save Service（云存档服务）**，为所有作品提供按玩家、作品和环境隔离的持久存档。游戏通过受控 SDK 访问存档，不能直接获得平台令牌、数据库连接或任意文件系统能力。

```text
游戏运行时（不可信）
       |
       | MessageChannel / Native IPC
       v
GameHub 可信宿主（身份、离线缓存、限流、状态提示）
       |
       | HTTPS + 短期授权
       v
Cloud Save API
       |
       +---- PostgreSQL：元数据、当前版本、小型正文、历史版本
       |
       +---- Worker：清理、配额对账、导出、恢复检查
       |
       `---- OSS：达到迁移阈值后保存大型正文，首期不依赖
```

核心决策：

1. 存档是**玩家可控制数据**，不能作为排行榜、付费资产、掉落、成就或多人胜负的权威来源。
2. 存档跨作品严格隔离；作用域默认是 `userId + workId + channel + namespace + slotKey`。
3. 存档跨作品发布版本延续，具体写入版本只作为审计和兼容性信息，不能作为默认隔离维度。
4. 使用不可变历史版本和 Compare-And-Swap（CAS）修订号，默认拒绝静默覆盖并发修改。
5. 游戏运行时仍保持隔离，不为兼容 `localStorage` 增加 `allow-same-origin`。
6. Web 游戏通过新增 `cloudSave` 能力和桥协议访问；Windows 使用短期、单作品、单用户授权。
7. 首期正文限制为小型 JSON/二进制文档并存 PostgreSQL；到达容量阈值后正文迁移 OSS，API 与 SDK 不变。
8. 匿名玩家只获得本机存档；登录后通过明确的“导入本机进度”流程迁移，绝不静默覆盖云端存档。
9. 平台提供冲突检测、恢复点、导入/导出与同步状态；游戏决定业务层如何合并内容。
10. 在没有数据库备份前，只能称为“内测存档”，不得对用户承诺云端耐久性。

## 2. 为什么必须是平台能力

当前隔离运行环境不应依赖游戏 iframe 自己的 `localStorage`：

- 沙箱策略可能使作者页面获得不透明 origin，浏览器存储不可用或行为不一致。
- 即便允许同源存储，发布域、release host 或缓存策略变化也可能把同一作品分裂成多个存储空间。
- 浏览器数据无法可靠跨电脑、Agent 和 Windows 客户端同步。
- 用户清理浏览器数据会丢失长期游戏进度。
- 游戏无法安全获得平台账号身份和云端写入凭据。
- 直接放开 `allow-same-origin` 会削弱运行隔离，且不能解决跨宿主同步。

因此，正确做法是把存档放在可信宿主和平台 API 后面。游戏只看到自己作品的逻辑存档，不知道存储位置，也不能访问其他作品或其他玩家数据。

## 3. 与其他平台域的边界

### 3.1 存档服务负责

- 单人游戏进度、设置、关卡状态和非权威收集记录。
- 自动存档、手动槽位、恢复槽位和存档元数据。
- 跨设备、跨宿主同步。
- CAS 冲突检测与恢复副本。
- 内容版本、游戏存档 Schema 版本和写入发布版本记录。
- 配额、写入频率、历史版本、导出和删除。
- 云端同步状态与用户可理解的错误。

### 3.2 不负责

| 数据 | 权威归属 |
| --- | --- |
| 排行榜成绩、竞赛回放 | Competition / Leaderboards |
| 多人对局状态、胜负、段位 | Realtime / Rules Adapter / Match Ledger |
| 付费货币、道具所有权、订单 | 未来经济与交易服务 |
| 平台成就和徽章 | 平台行为事件与成就服务 |
| 账号资料、关注、屏蔽 | 身份与社交服务 |
| 创作者分析数据 | Analytics |

游戏可以在存档中保存 UI 用的“最高分”或“已解锁”副本，但服务端可信系统不能把它当作事实来源。

### 3.3 数据访问类别

首期只开放一种运行时可写类别：

- `player_private`：当前玩家和当前作品运行时可读写；创作者和其他玩家不可读。

未来若需要以下类别，应建独立接口和权限：

- `server_protected`：游戏可读、可信服务端可写；适合非经济性的权威进度摘要。
- `server_internal`：只有平台服务可读写；不属于普通存档。
- `public_profile`：公开展示的数据应进入个人主页/作品系统，不从私有存档直接查询。

不要通过给 `player_private` 加布尔字段来模拟权威数据。

## 4. 成熟平台经验与 GameHub 取舍

- [Steam Cloud 官方文档](https://partner.steamgames.com/doc/features/cloud?l=english)把云存档按用户和游戏设置字节/文件配额，并支持跨设备同步；GameHub 同样采用按用户、按作品配额，但不会扫描作者任意本地路径。
- [Unity Cloud Save Write Locks](https://docs.unity.com/en-us/cloud-save/concepts/write-locks)通过写锁阻止不同来源静默互相覆盖；GameHub 采用等价的 `revision` CAS，并默认不允许跳过。
- [PlayFab Player Data](https://learn.microsoft.com/en-us/xbox/playfab/player-progression/player-data/)区分客户端可写、客户端只读和服务端内部数据；GameHub 也明确区分玩家存档与服务端权威数据。
- [Apple CloudKit change tag](https://developer.apple.com/documentation/cloudkit/ckrecord/recordchangetag?changes=_9)在每次保存后改变记录版本；GameHub 的修订号和 ETag 使用同一原则，但错误响应不会自动猜测合并结果。

GameHub 不采用“最后写入者获胜”作为通用默认值，因为不同游戏对进度倒退、物品重复和多设备冲突的容忍度不同。

## 5. 作用域、身份与生命周期

### 5.1 完整存档键

```text
userId
+ workId
+ channel
+ namespace
+ slotKey
```

- `userId`：由平台会话或短期启动授权确定，游戏不能传入。
- `workId`：由启动描述绑定，不能从 SDK 参数覆盖。
- `channel`：`production` 或 `preview`；草稿测试不得污染正式存档。
- `namespace`：作品内稳定的数据域，首期默认 `default`。
- `slotKey`：如 `autosave`、`manual-1`，由受控格式和配额限制。

### 5.2 为什么不按 releaseId 隔离

如果每个发布版本都拥有独立存档，游戏更新后玩家会像第一次启动一样失去进度。因此：

- `releaseId`、客户端版本和宿主类型记录在每次修订中用于审计。
- 正式发布默认读写相同 `production` 存档。
- 存档的业务结构通过 `schemaVersion` 管理。
- 预览、审核和开发运行使用 `preview`，不得默认读取生产正文。
- 管理员/作者可在用户明确授权的测试流程中复制一份生产存档到预览恢复槽，而不是共享同一可写对象。

### 5.3 命名规则

- `namespace`、`slotKey`：1～64 字节，小写 ASCII、数字、点、下划线、短横线。
- 平台保留 `_gamehub.*` 前缀。
- 作品发布后不能改变既有 namespace 的含义；需要不同含义时创建新 namespace。
- 用户可见标题与稳定键分离，标题可以本地化，键不可改名。

## 6. 存档文档模型

首期采用“槽位文档”而不是开放文件系统：

```json
{
  "slotKey": "autosave",
  "revision": 18,
  "etag": "\"ghsave-AbCdEf...\"",
  "schemaVersion": 3,
  "contentType": "application/json",
  "payload": { "room": { "fire": 4 } },
  "updatedAt": "2026-10-02T08:30:00.000Z",
  "syncState": "cloud"
}
```

设计理由：

- 单文档原子替换容易保证一致性。
- 多键 KV 很容易让半次失败造成跨键状态不一致。
- 任意文件树会增加路径、目录、重命名和部分同步复杂度。
- 小型浏览器游戏的主进度通常可以序列化为一个 JSON 或紧凑二进制文档。

一款游戏可使用多个槽位，但必须在策略配额内。未来需要大型世界分块时再新增“存档对象集合”，不能破坏首期槽位语义。

### 6.1 正文格式

首期允许：

- `application/json`：UTF-8、有效 JSON，顶层为对象；
- `application/octet-stream`：不透明字节，用于已有二进制存档；
- 可选 `contentEncoding = gzip`，服务端在计量和验证前受限解压。

服务端不理解游戏字段，也不运行正文。禁止 HTML、JavaScript、可执行文件或嵌套压缩包语义；即使字节可保存，下载时也只通过 SDK 作为数据返回，永不在平台 origin 直接渲染。

### 6.2 元数据

每次修订至少记录：

- `schemaVersion`；
- 内容类型、编码、未压缩/存储字节、SHA-256；
- 创建时间、服务端提交时间；
- 写入 `releaseId`、宿主类型、SDK 版本；
- 幂等请求 ID；
- 基础修订号；
- 同步来源：在线、离线回放、导入、恢复；
- 可选的安全展示摘要，如游戏内章节名；摘要有严格长度且不能作为 HTML。

## 7. 数据库模型

迁移编号必须在其他并行任务合并后确定。建议表名统一使用 `game_save_` 前缀。

### 7.1 `game_save_policies`

每个作品/namespace 的已审核策略：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID |
| `work_id` | 作品 |
| `namespace` | 稳定命名空间 |
| `status` | `draft/review/active/retired` |
| `max_slots` | 最大槽位数 |
| `max_document_bytes` | 单文档未压缩上限 |
| `max_live_bytes` | 当前有效正文总量 |
| `max_history_bytes` | 历史修订总量 |
| `history_versions` / `history_days` | 历史保留策略 |
| `schema_min` / `schema_max` | 当前发布可写范围 |
| `content_types` | 受控枚举 |
| `created_at` / `updated_at` | 平台时间 |

唯一约束：`(work_id, namespace)`。

### 7.2 `game_save_slots`

保存当前指针，不直接覆盖历史正文：

| 字段 | 说明 |
| --- | --- |
| `id` | UUID |
| `user_id` / `work_id` | 所有者与作品 |
| `channel` / `namespace` / `slot_key` | 完整逻辑键 |
| `current_revision_id` | 当前不可变修订 |
| `revision` | 单调递增 bigint |
| `deleted_at` | 软删除墓碑 |
| `created_at` / `updated_at` | 服务端时间 |

唯一约束：`(user_id, work_id, channel, namespace, slot_key)`。

### 7.3 `game_save_revisions`

仅追加：

- `id`、`slot_id`、`revision`；
- `base_revision`；
- `schema_version`；
- `content_type`、`content_encoding`；
- `payload_inline bytea` 或未来的 `object_key`，两者恰有其一；
- `payload_sha256`、`stored_bytes`、`expanded_bytes`；
- `release_id`、`host_kind`、`sdk_version`；
- `source_kind`、`idempotency_key_hash`；
- `created_at`、`expires_at`；
- `restored_from_revision_id`；
- `tombstone`。

唯一约束：`(slot_id, revision)`；`idempotency_key_hash` 在同一槽位范围内唯一。

### 7.3.1 S0 实施细化（0046）

不可变修订事实与可回收正文分表：`game_save_revisions` 不允许 UPDATE/DELETE；`game_save_payloads` 以 revision_id 为主键保存 bytea。当前指针指向的正文不可清理，历史正文可按预算删除，修订摘要及操作回执继续保留。首期未启用 object_key；后续对象存储也遵守相同保留边界。

幂等键摘要、完整请求摘要和原成功响应保存在追加式 `game_save_operations`，以 slot_id + idempotency_key_hash 唯一约束。请求摘要覆盖操作类型、前置 ETag、schema、内容类型、编码、正文摘要或恢复来源；重试命中发生在 CAS 与当前策略写入检查之前，但仍必须通过当前账号与游戏作用域授权。

HTTP revision/baseRevision 使用十进制字符串表示 bigint，不让 JavaScript 数字精度影响审计。普通已删除槽的 metadata 保留墓碑 ETag，恢复写入必须基于该 ETag；不能用 create-only 跳过墓碑。

### 7.3.2 S1 在线传输与回执查询

宿主下载正文时携带元数据 ETag（If-Match），服务端从同一 MVCC 快照取得正文与修订；不同版本不能拼为一次读取。SDK 还会校验长度、类型及 SHA-256。

上传 begin 先检查当前策略；若策略已缩小或退休，可信宿主可调用 `POST /v1/me/game-saves/:workId/slots/:slotKey/write-receipt?namespace=...`，携带原幂等键、CAS、schema、内容类型及正文摘要，查询已提交的操作。此 API 没有写入副作用：同完整摘要返回原成功回执，不存在返回 null，同键不同摘要返回 409；始终要求当前账号及游戏 scope 授权。它既不分配正文，也不允许新保存绕过策略。

### 7.4 `game_save_usage`

按 `user_id + work_id + channel` 保存：

- 当前槽位数、有效正文总量、历史总量；
- 当日写入次数和字节；
- 最后对账时间；
- 行级版本。

创建/更新槽位时锁定此行并原子预留差额，不能在写完正文后才发现超额。

### 7.5 `game_save_operations`

记录导入、导出、恢复、冲突副本、用户删除和管理员治理操作，不保存正文。管理员查看正文属于单独的 break-glass 审计事件。

## 8. 数据库不变量

以下约束必须由数据库和事务共同保证：

1. 槽位当前指针只能指向同一槽位的修订。
2. 修订号严格递增且不可更新。
3. CAS 提交的 `baseRevision` 必须等于事务锁定后的当前修订。
4. 相同幂等键和相同请求摘要只产生一个修订。
5. 相同幂等键但正文摘要不同必须返回冲突。
6. 用户、作品、channel 和 namespace 从可信上下文继承，不能由正文覆盖。
7. 删除产生墓碑修订，不能直接抹掉当前指针。
8. 恢复历史版本会创建新修订，不把旧修订重新设为可变当前行。
9. 配额计数与槽位更新在同一事务中提交。
10. 被退休 policy 禁止新写入，但仍允许用户读取、导出和删除已有数据。

每天运行对账任务，根据当前指针和未过期历史修订重新计算 usage；不一致时告警并修正派生计数。

## 9. CAS、冲突和多设备同步

### 9.1 正常提交

```text
读取 autosave -> revision 18
本地修改
PUT autosave(If-Match=<opaque ETag of revision 18>, idempotencyKey=X)
服务端锁定槽位
若 ETag 仍匹配：创建 revision 19，原子更新指针
返回 revision 19 + 新 ETag
```

创建新槽位使用 `If-None-Match: *`。客户端不得省略前置条件来表达“无条件覆盖”；普通游戏 SDK 不提供该快捷方式。revision 用于展示、历史与审计，网络并发控制只使用客户端原样回传的不透明 ETag。

### 9.2 冲突响应

若云端已是 revision 19，而设备 B 仍基于 18 写入，API 返回：

```json
{
  "error": {
    "code": "SAVE_CONFLICT",
    "requestId": "...",
    "details": {
      "expectedEtag": "\"ghsave-AbCdEf...\"",
      "currentRevision": 19,
      "currentUpdatedAt": "...",
      "localRecoveryId": "..."
    }
  }
}
```

冲突时平台不能自动用客户端时间决定胜负，因为设备时间可错、两边进度也可能都重要。

### 9.3 解决策略

平台提供四种明确选择：

1. **使用云端**：丢弃本地待同步正文。
2. **保留本机为恢复副本**：保存到平台保留的 recovery slot，再继续云端。
3. **覆盖云端**：用户明确确认后，以最新 revision 为新基线提交；旧云端仍在历史中可恢复。
4. **游戏自定义合并**：SDK 把两份正文交给游戏的纯本地合并函数，再以最新 revision 提交；平台不猜测字段含义。

默认 UI 应推荐“先创建恢复副本”，避免一次选择永久丢失进度。

### 9.4 多标签和多宿主

- 同一浏览器两个游戏标签也按 CAS 处理，不能共享可变内存假装没有冲突。
- 宿主可订阅自己的槽位变更事件，在另一设备写入后提示“云存档有更新”。
- 首期不要求实时 WebSocket；重新获得焦点、准备写入或固定轮询时检查版本即可。
- Windows/Agent 离线退出后再次上线，使用同一 outbox 算法。

## 10. 本机缓存与离线模型

### 10.1 可信宿主缓存

不可信游戏 iframe 不直接拥有离线数据库。可信宿主实现 `SaveCacheAdapter`：

- 浏览器：GameHub 业务 origin 下的 IndexedDB；
- Agent：扩展/宿主受控存储；
- Windows：GameHub SDK 的应用数据目录，文件权限限制到当前用户。

缓存键包含用户、作品、channel、namespace 和 slot，登出时不把 A 用户数据提供给 B 用户。

### 10.2 Outbox

每个槽位的本机记录必须持久化以下互相独立的状态，不能只保存一个“待上传”布尔值：

```text
confirmed:
  cloudRevision + cloudEtag + confirmedLocalSequence

inFlight（最多一个，不可变）:
  operationId + idempotencyKey + baseCloudEtag
  localSequence + payloadDigest + payload

pending（最多一个，可折叠）:
  localSequence + payloadDigest + payload

nextLocalSequence（单调递增）
```

精确转换：

1. 游戏保存时，宿主先递增 `localSequence`，原子写本机当前正文。
2. 若没有 `inFlight`，正文进入 `pending`；若已有 `pending` 但尚未发送，可以用更新的完整快照替换它。
3. 已经成为 `inFlight` 的正文、幂等键、基础 ETag 和摘要绝不能被折叠或改写。
4. 同步器在一个本机事务中把 `pending` 移为 `inFlight`，以当前 `confirmed.cloudEtag` 作为 `baseCloudEtag`，随后才发网络请求。
5. 服务端必须**先检查幂等键**，再做 If-Match/CAS。这样“服务端已提交、确认响应丢失”的重试会返回原 revision，而不会被后来变化误报为本次冲突。
6. 成功确认后，宿主更新 `confirmed` 并删除 `inFlight`。如果此时还有更晚的 `pending`，它是完整新快照，可用新返回的 ETag 作为基础继续发送。
7. 网络失败或进程重启后，原样重试 `inFlight`；不能重新生成幂等键，也不能跳过它直接发送 `pending`。
8. 服务端返回 `SAVE_CONFLICT` 时，冻结该槽位发送队列，把 `inFlight` 与更晚 `pending` 中 localSequence 最大的完整快照保存为本机 recovery 候选，读取云端当前版本，进入显式冲突解决。
9. 用户解决冲突后生成新的幂等操作；旧 `inFlight` 标记为 `resolved`，不可继续重放。

只有尚未发送的 `pending` 完整快照可以折叠。不同槽位可以独立同步；同一槽位始终只有一个网络写入在途。`confirmed/inFlight/pending/nextLocalSequence` 与本机正文必须使用 IndexedDB 事务或本地原子文件协议共同落盘，保证进程在任何一步崩溃后都能恢复到可判定状态。

典型“确认丢失后继续游玩”流程：

```text
云端 18
  -> seq 41 成为 inFlight，服务端写成云端 19，但响应丢失
  -> 玩家继续，seq 42/43 仅折叠为 pending 43
  -> 重连时用原 operationId 重试 seq 41，服务端返回原成功 revision 19
  -> confirmed=19，随后 pending 43 以 ETag(19) 发送
```

### 10.3 同步状态

统一状态：

- `local_only`：匿名或未启用云存档；
- `local_pending`：本机已落盘，等待云端；
- `syncing`：正在传输；
- `cloud`：云端确认；
- `conflict`：需要选择；
- `error_retryable`：网络/服务故障；
- `blocked`：配额、策略或版本不兼容。

平台宿主展示轻量状态图标；只有冲突、配额耗尽或即将退出且仍未本地落盘时需要明显打断。

## 11. 匿名玩家与登录迁移

### 11.1 匿名存档

- 只保存在可信宿主本机，使用随机 `anonymousInstallId`。
- 不上传到用户云存档，也不声称跨设备。
- 清理浏览器/宿主数据会丢失，界面必须明确提示。
- 匿名标识不能被游戏读取或用于跨作品跟踪。

### 11.2 登录后的导入

登录后发现相同作品存在匿名存档时：

1. 对比本机摘要与云端槽位元数据。
2. 若云端为空，可让用户一键导入。
3. 若云端已有数据，先导入为 `recovery-anonymous-<date>`，再让用户选择。
4. 成功云端提交后才能删除匿名副本；默认再保留 7 天本地恢复期。
5. 登出不自动把已登录用户的云端正文复制给匿名身份。

## 12. Schema 版本与游戏更新

每份正文必须带正整数 `schemaVersion`。每个已发布 release 声明：

```json
{
  "cloudSave": {
    "namespace": "default",
    "readSchema": { "min": 1, "max": 3 },
    "writeSchema": 3
  }
}
```

### 12.1 升级

1. 新版本读取旧 Schema。
2. 游戏在内存中做确定性迁移。
3. 保留旧正文不变，以旧 revision 为基线写入新 Schema 修订。
4. 迁移失败时继续保留原存档，显示可恢复错误，不得写半份新数据。

平台可以校验版本范围和大小，不能执行创作者提供的服务器迁移脚本。

### 12.2 回滚

若回滚 release 不能读取当前存档 Schema：

- 启动描述标记 `saveCompatibility = incompatible`；
- 默认以只读/新临时槽启动或阻止继续写入；
- 允许用户从兼容历史修订创建恢复副本；
- 不能让旧版本把新 Schema 存档覆盖成无法恢复的旧结构。

### 12.3 修改作品归属或 Fork

- Fork/Remix 默认获得新的 `workId`，不能自动读取原作品玩家存档。
- 作品转让所有权不改变 `workId`，玩家存档继续存在，但新作者仍不能在后台浏览正文。
- 合并两个作品不自动合并存档，需要单独的数据迁移项目和用户告知。

## 13. Web Game Bridge 与 SDK

### 13.1 能力声明

`platform.json` 新增经审核能力：

```json
{
  "version": 1,
  "entry": "index.html",
  "capabilities": ["cloudSave"]
}
```

只有已批准 policy 的发布版本才能获得 `cloudSave`。旧游戏没有此能力时仍正常运行。

### 13.2 宿主重构

设计起点的宿主以 multiplayer 命名并固定公布 `identity`、`multiplayer`。共享前置切片现已实现通用 `createWebGameHost`，遵循以下边界：

```text
Bridge Core
  ├─ Identity handlers
  ├─ Cloud Save handlers（按 capability 注册）
  ├─ Competition handlers（以后）
  └─ Multiplayer handlers（按 capability 注册）
```

每个模块只能注册自己的方法前缀；握手能力来自可信 launch descriptor，不能相信 iframe 自报。

当前 `packages/player-core/src/index.mjs` 只有在 `descriptor.capabilities.multiplayer` 为真时才创建桥；因此仅增加 `cloudSave` manifest 和 SDK 方法不会让纯单机游戏得到 MessageChannel。共享先行切片必须同时完成：

- PlayerCore 在任一受支持桥能力存在时创建通用宿主；
- handler 按服务端批准的 capability 注册，未知方法默认拒绝；
- 保持旧 multiplayer 握手、超时、销毁和重连行为不变；
- frame stop、账号切换、release 撤下时关闭端口并清除作用域状态；
- Cloud Save 与 Competition 共用 16 KiB 正文分片、摘要、顺序、过期和中止机制，不能各写一套近似协议；
- 对“只有 cloudSave”“只有 competition”“只有 multiplayer”和多能力组合建立回归测试。

### 13.3 运行授权上下文

公开 catalog launch descriptor 只描述可缓存的作品入口和公开能力，不能作为用户存档写入授权。可信父宿主在挂载游戏前调用认证端点创建短期游戏会话：

```text
POST /v1/game-sessions
  input: workId + releaseId + channel + launchNonce
  server verifies: user session, release enabled, approved capabilities,
                   work/release ownership, channel and save policy
  output: opaque gameSessionId + expiresAt
```

服务端 game session 绑定：

```text
userId + workId + releaseId + channel
+ approvedCapabilities + allowedNamespaces
+ issuedAt + expiresAt + revocationGeneration
```

浏览器可以继续用父页面的 HttpOnly 登录会话调用 API，但每次存档请求必须携带 `gameSessionId`，服务端从会话记录解析完整作用域并与当前账号、release 状态及 revocation generation 复核。iframe 只得到 MessagePort，不得到 session cookie、gameSessionId 或 bearer token。

Agent/Windows 使用一次性 launch ticket 交换同等作用域的短期 bearer；token 只保存在可信宿主/SDK 层。登出、账号切换、作品撤下、release 禁用或管理员撤销时提升 revocation generation，现有短期会话最迟在有限缓存/过期窗口内失效。

这种授权只能证明“平台允许当前账号以某作品版本访问该作用域”，不能证明浏览器/Windows 客户端代码没有被修改。因此存档始终视为玩家可控制数据，不能升级为竞赛、经济或多人权威事实。

### 13.4 SDK 接口

```js
const metadata = await gamehub.cloudSave.getMetadata({ slot: 'autosave' });
const save = await gamehub.cloudSave.read({ slot: 'autosave' });

const result = await gamehub.cloudSave.write({
  slot: 'autosave',
  expectedEtag: save?.etag ?? null,
  createOnly: !save,
  schemaVersion: 3,
  contentType: 'application/json',
  data: nextState,
  idempotencyKey: crypto.randomUUID()
});

// result.revision, result.durability, result.updatedAt
```

其他标准方法：

```text
cloudSave.policy.get
cloudSave.slots.list
cloudSave.slots.metadata
cloudSave.slots.read
cloudSave.slots.write
cloudSave.slots.delete
cloudSave.slots.history
cloudSave.slots.restore
cloudSave.conflicts.resolve
cloudSave.sync.status
cloudSave.export.request
```

普通游戏运行时不能调用跨作品、跨用户、管理员恢复或批量枚举接口。

### 13.5 大于桥消息限制的正文

现有桥请求限制约 32 KiB。存档正文采用受控分片传输：

```text
cloudSave.transfer.begin
cloudSave.transfer.append
cloudSave.transfer.commit
cloudSave.transfer.abort
```

- 单分片正文固定不超过 16 KiB。现有 32 KiB 限制作用于完整 JSON 信封；Base64 和字段开销使 32 KiB 正文必然超限。
- `begin` 声明总字节、内容类型、编码和 SHA-256。
- 分片严格顺序、数量与总量受 policy 限制。
- 宿主最多只在内存聚合一个受限文档；达到 256 KiB 上限后提交 API。
- 下载使用同等受限的 read cursor，避免一次响应突破桥限制。
- 后续桥协议若支持 transferable `ArrayBuffer`，必须发布新的协议/计量版本并分别限制逻辑字节和信封字节；它可以减少 Base64 开销，但不能改变存档 CAS 语义。

### 13.6 不能伪造同步 localStorage

浏览器 `localStorage` 是同步 API，而安全桥是异步的。平台不能可靠地用跨 frame RPC 覆盖原生 `window.localStorage`。兼容旧游戏必须：

1. 游戏启动前异步加载存档；
2. 将内容放入游戏自己的内存状态管理器；
3. 后续写入调用异步 SDK；
4. 宿主负责本地落盘与云端同步。

可以提供 `createLegacySaveAdapter()` 帮助迁移，但它返回 GameHub 自己的接口，不能冒充浏览器原生 Storage 对象。

## 14. HTTP API 草案

用户端：

```text
GET    /v1/works/{workId}/save-policy
GET    /v1/me/game-saves/{workId}/slots
GET    /v1/me/game-saves/{workId}/slots/{slotKey}/metadata
GET    /v1/me/game-saves/{workId}/slots/{slotKey}/content
PUT    /v1/me/game-saves/{workId}/slots/{slotKey}
DELETE /v1/me/game-saves/{workId}/slots/{slotKey}
GET    /v1/me/game-saves/{workId}/slots/{slotKey}/history
POST   /v1/me/game-saves/{workId}/slots/{slotKey}/restore
POST   /v1/me/game-saves/{workId}/export
```

Web iframe 不直接调用这些端点。父宿主使用第 13.3 节的 game session 调用；URL 中的 workId 仍必须与服务端会话绑定范围复核。公开 launch descriptor 和父页面传入参数均不能单独构成授权。

### 14.1 写入请求

```text
If-Match: "ghsave-AbCdEf..."
Idempotency-Key: <uuid>
Content-Type: application/octet-stream
X-GameHub-Save-Schema: 3
X-Content-SHA256: <hex>
```

ETag 是服务端生成的**不透明强验证器**，格式只承诺为合法带引号 HTTP ETag。客户端必须原样保存和回传，不能从中解析 revision 或摘要。`revision` 与 SHA-256 作为独立响应字段存在。

新槽位使用 `If-None-Match: *`。删除同样要求当前 ETag，防止旧设备删除新进度。If-Match/If-None-Match 不成立统一返回 HTTP `412 Precondition Failed` 和业务码 `SAVE_CONFLICT`；`409` 保留给幂等键内容不一致、Schema 状态冲突等非 HTTP 前置条件错误。

### 14.2 响应

```json
{
  "data": {
    "slot": "autosave",
    "revision": 19,
    "etag": "\"ghsave-XyZ123...\"",
    "schemaVersion": 3,
    "bytes": 18342,
    "updatedAt": "..."
  }
}
```

正文下载使用正确 `Content-Type`、`ETag`、`Digest`、`Cache-Control: private, no-store`，不经公共 CDN 缓存。

## 15. Windows 与 Agent 授权

### 15.1 启动授权

Windows 游戏不能保存平台长期访问令牌。流程：

1. GameHub/Agent 为登录用户签发一次性 launch ticket。
2. 游戏进程通过 SDK 交换得到短期 save session。
3. 授权固定 `userId`、`workId`、`channel`、`releaseId` 和允许 namespace。
4. token 短期过期，可由仍登录的宿主续期。
5. 游戏退出、作品撤下、账号登出或管理员禁用后停止续期。

### 15.2 本机文件

- 正文缓存目录由 SDK 决定，不能由游戏传绝对路径。
- 文件名使用平台生成 ID，不使用 slotKey 直接拼路径。
- Windows ACL 限制到当前 OS 用户；敏感授权使用系统凭据存储而非正文目录。
- 写入采用临时文件、fsync（按宿主能力）和原子替换，防止崩溃留下半份存档。
- 本机缓存仍是不可信副本，云端写入必须 CAS。

## 16. 配额与限流默认值

首期默认值是可配置平台策略，不是创作者声明即可提高：

| 项目 | 默认值 | 硬上限/说明 |
| --- | ---: | --- |
| namespace | 1 个 | 审核后最多 4 个 |
| 当前槽位 | 10 个 | recovery 槽另计但有总上限 |
| 单份正文 | 256 KiB 未压缩 | 首期硬上限 1 MiB |
| 当前正文总量 | 1 MiB / 用户 / 作品 | 当前有效正文优先保留，不因历史满额而拒绝正常覆盖保存 |
| 滚动历史预算 | 5 MiB / 用户 / 作品 | 字节硬上限；超限先清理最旧、未保护历史 |
| 普通历史目标 | 每槽最近 5 个、最长目标 7 天 | 是 best-effort 目标，不是突破字节预算的最低承诺 |
| 冲突恢复预留 | 1 MiB、最多 3 份 / 用户 / 作品 | 与普通历史预算分开；满额时要求导出或替换最旧 recovery |
| recovery 副本 | 最多 3 个 | 默认 30 天 |
| 单分片 | 16 KiB | 小于桥总请求限制 |
| 活跃传输 | 每运行时 1 个 | 5 分钟无活动过期 |
| 写入突发 | 20 次/分钟/用户/作品 | 宿主应合并自动保存 |
| 每日写入 | 2,000 次/用户/作品 | 异常时可动态收紧 |
| 导出 | 每用户每小时 5 次 | 异步生成、有过期时间 |

SDK 默认把连续自动保存合并：建议 5 秒 debounce，并在页面隐藏、暂停和正常退出前 best-effort flush。本机落盘可以更频繁，云端不能每次点击都生成一个修订。

配额错误不能删除旧存档；服务应继续允许读取、导出和用户删除。

## 17. 安全模型与威胁

### 17.1 不可信参与者

- 游戏 JavaScript、WASM 和 Windows 游戏进程；
- 被篡改的客户端或 SDK；
- 恶意/失误的创作者发布版本；
- 盗用的用户会话；
- 超大、畸形、压缩或高频正文。

### 17.2 防护

| 风险 | 防护 |
| --- | --- |
| 跨作品读取 | launch scope + 服务端 work 归属校验 |
| 读取其他玩家 | userId 只来自鉴权上下文 |
| 旧设备覆盖新进度 | CAS revision，默认禁止无条件覆盖 |
| 恶意新版本清空存档 | 历史版本、恢复槽、写入限流、发布审计 |
| 填满磁盘 | 单文档/用户/作品/全局容量门禁 |
| 压缩炸弹 | 压缩格式白名单、展开大小和比率边界、流式计量 |
| 在平台域执行正文 | 正文永不作为 HTML/JS 提供，下载 no-store/nosniff |
| 重放请求 | 幂等键、摘要绑定、短期授权 |
| 创作者查看玩家隐私 | 无作者正文 API；后台只提供聚合健康数据 |
| 管理员滥用 | 默认只看元数据；正文 break-glass 权限和完整审计 |

### 17.3 存档不是秘密保险箱

游戏代码需要读取自己作品的存档，因此该作品未来发布的恶意版本理论上也能读取旧存档。禁止游戏把以下内容写入存档：

- 平台访问令牌、第三方 OAuth token；
- 密码、身份证件、支付信息；
- 不必要的真实姓名、邮箱、聊天内容；
- 其他作品数据或设备指纹。

平台应在创作者指南、SDK 类型和审核规则中明确这一点。

## 18. 加密、隐私与管理员访问

- 全部网络传输使用 TLS。
- 数据库/磁盘使用云盘或数据库静态加密；对象存储使用服务端加密。
- 应用层不把不同用户正文混在同一明文日志、缓存键或错误消息中。
- 日志只记录 slot 哈希/ID、字节、revision、结果码和 requestId，不记录正文。
- 管理后台默认不能显示或下载正文。
- 支持人员需要正文时优先让用户主动导出并提供；平台 break-glass 读取必须二次授权、理由、时限和审计。
- 创作者只能看到活跃玩家数、同步成功率、平均大小、错误码等聚合信息。

首期不做端到端加密：游戏必须能读取正文，且用户跨宿主同步需要平台执行版本和内容完整性检查。若未来提供用户密码加密槽，应作为另一个不可恢复的产品模式。

## 19. 历史、恢复、删除与导出

### 19.1 自动历史

每次成功云端提交仍生成不可变修订，但“事实不可变”不等于“正文永远保留”。清理只删除已不再是当前指针、且不受保护的历史正文；修订号、摘要、时间和操作审计可以继续保留。

保留优先级从高到低固定为：

1. 每个槽位当前正文和当前墓碑元数据；
2. 尚未解决的本机冲突候选，以及用户明确创建的 recovery 副本；
3. 每个非空槽位最近一个上一版本，前提是没有突破滚动历史字节预算；
4. 其余普通历史和定期恢复点。

普通历史同时受“每槽最近 5 个”“7 天目标”和“5 MiB 滚动预算”约束：数量与时间是保留目标，字节预算是硬上限。接近上限时，按最旧优先删除第 4 级，再删除无法全部保留的第 3 级；**不得因为普通历史已满而阻止当前正文覆盖保存**。若大存档导致只能保留当前正文，API 仍成功，但返回 `historyDegraded: true`，宿主提示用户导出备份。

冲突 recovery 使用独立 1 MiB 预留、最多 3 份、最长目标 30 天。预留已满时不能静默删除未解决副本；要求用户导出、删除或明确替换最旧 recovery。被用户标记“保护”的手动槽属于当前有效槽位，计入当前正文配额，不属于无限保留的历史例外。

### 19.2 恢复

恢复 revision 12 时，不移动当前指针回 12；创建 revision 20，正文等于 12，并记录 `restoredFromRevisionId`。这样恢复本身也可撤销。

### 19.3 删除

- 普通删除创建墓碑修订并立即从游戏读取列表隐藏。
- 用户有短暂撤销窗口；窗口后正文进入清理队列。
- 账号注销停止所有新访问，公开系统不暴露存档存在性；按隐私策略清理正文和缓存。
- 法律/安全保留只冻结后台清理，不应让已注销账号继续访问。

### 19.4 导出

用户可以导出自己某作品的当前槽位和元数据：

```text
manifest.json
saves/default/autosave.json
saves/default/manual-1.bin
```

导出包由 Worker 生成、私有存放、短期一次性下载；禁止作者批量导出玩家存档。导入必须经过大小、格式和 Schema 检查，并默认进入 recovery slot。

## 20. 标准错误码

| 错误码 | HTTP | 含义/处理 |
| --- | ---: | --- |
| `SAVE_CAPABILITY_NOT_GRANTED` | 403 | 当前发布没有云存档能力 |
| `SAVE_POLICY_NOT_ACTIVE` | 409 | namespace 尚未激活或已退休 |
| `SAVE_SLOT_NOT_FOUND` | 404 | 槽位不存在或已删除 |
| `SAVE_CONFLICT` | 412 | If-Match/If-None-Match 不成立，进入冲突流程 |
| `SAVE_IDEMPOTENCY_MISMATCH` | 409 | 同一幂等键对应不同正文 |
| `SAVE_SCHEMA_UNSUPPORTED` | 422 | Schema 不在该发布允许范围 |
| `SAVE_CONTENT_INVALID` | 422 | 内容类型、JSON、编码或摘要无效 |
| `SAVE_DOCUMENT_TOO_LARGE` | 413 | 单文档超限 |
| `SAVE_QUOTA_EXCEEDED` | 409 | 用户/作品配额耗尽，仍允许读取和删除 |
| `SAVE_RATE_LIMITED` | 429 | 写入过于频繁，SDK 合并后重试 |
| `SAVE_TRANSFER_EXPIRED` | 410 | 分片传输超时，重新 begin |
| `SAVE_SYNC_OFFLINE` | 202/本机状态 | 已本机保存，尚未云端确认 |
| `SAVE_STORAGE_UNAVAILABLE` | 503 | 平台故障，本机排队并稍后同步 |
| `SAVE_RELEASE_INCOMPATIBLE` | 409 | 发布版本不能安全读取当前 Schema |
| `SAVE_EXPORT_PENDING` | 202 | 导出任务处理中 |

客户端不得把 `SAVE_STORAGE_UNAVAILABLE` 显示成“存档损坏”，也不得把 `local_pending` 显示成“已同步”。

## 21. A Dark Room 参考接入

### 21.1 改造范围

1. 把运行资产整理为无 `package.json` 的受控静态目录。
2. 删除外部统计脚本，jQuery 使用本地文件。
3. `platform.json` 申请 `cloudSave`。
4. 修改 `state_manager.js`，不直接访问原生 `localStorage`。
5. 游戏初始化前调用 SDK 读取 `autosave`。
6. 将现有状态反序列化到内存后再启动 Engine。
7. 原有频繁 `saveGame()` 调用写入内存快照，由 adapter 合并并异步持久化。
8. 保留原游戏的导出/导入码作为用户兜底，并让导入进入恢复流程。

### 21.2 Schema

首版定义 `schemaVersion = 1`，正文保留上游现有序列化结构，外层增加：

```json
{
  "schemaVersion": 1,
  "upstreamVersion": "1.4",
  "savedAt": "客户端展示时间，非权威",
  "state": {}
}
```

不得为了首发重写游戏全部存档字段；先用黄金存档样本验证兼容，再逐步规范。

### 21.3 验收场景

- 新账号从空存档开始并完成首次云端保存。
- 刷新、关闭重开、Cursor/网页互换后恢复相同进度。
- 断网游玩后显示本机待同步，联网后成功提交。
- 两台设备基于同一 revision 修改后触发冲突，不静默丢失。
- 游戏升级迁移成功；故意迁移失败仍能恢复旧版本。
- 存档超过配额时游戏继续可读，用户可导出和删除。

## 22. 当前 2 核 4G 部署方案

### 22.1 首期

- 正文使用 PostgreSQL `bytea`，依靠 TOAST 处理小型值。
- API 做鉴权、边界校验和事务写入，不在请求中做复杂内容处理。
- 存档后台任务自身最多单并发，但不能把这个数字当作整机资源保证。
- 不引入 Redis 作为正确性依赖；热点元数据可在进程内短缓存，但正文不缓存。
- 本机缓存由客户端宿主负责，不占服务器内存。

2 核 4G 只是**封闭内测的待验证起点**。平台需要一个跨域资源门禁，而不是让源码构建、规则构建、竞赛验证、存档导出/清理各自宣布“单并发”：

```text
优先级 0：PostgreSQL 健康、API 鉴权和实时对局
优先级 1：存档当前正文读写与比赛终局提交
优先级 2：短时竞赛验证、存档同步重试
优先级 3：存档导出/对账、榜单重建
优先级 4：源码构建、规则构建和批量迁移
```

- 同一时刻只允许一个重型后台任务占用 CPU/磁盘预算；Realtime 延迟或数据库压力越线时暂停优先级 2～4。
- 统一限制后台 CPU、内存、临时磁盘、任务墙钟和 PostgreSQL 连接数。
- WAL 增长、磁盘剩余、数据库 p95、Realtime event-loop lag 和备份窗口共同参与门禁。
- 正式开放前使用“实时对局 + 存档写入 + 竞赛验证 + 备份/构建”混合负载测试，不能只测单服务吞吐。

### 22.2 粗略容量模型

若平均每份当前存档 50 KiB、每用户每作品保留 5 个历史版本：

```text
1,000 个活跃用户 × 3 款游戏 × 50 KiB × 6 份 ≈ 879 MiB 正文
```

再加索引、TOAST、WAL、备份和膨胀，应按正文的 3～5 倍规划磁盘，而不是只看 payload 大小。

### 22.3 迁移 OSS 的触发点

满足任一条件时，把新正文写入 OSS、旧正文后台迁移，元数据仍留 PostgreSQL：

- 存档正文超过 5 GiB；
- PostgreSQL 数据目录持续超过安全磁盘水位；
- 日写入正文超过 100,000 次；
- 数据库备份或恢复时间因正文超过目标；
- 开放单文档大于 1 MiB 的游戏。

迁移使用 `payload_inline XOR object_key`，API/SDK 不变。对象键由服务端生成且桶保持私有。

## 23. 备份与耐久性

云存档上线后，“数据丢了也没关系”不再适用。必须区分阶段承诺：

### 内测阶段

- 产品明确标注 best-effort；
- 用户保留导出入口；
- 至少验证数据库恢复流程，即使暂不承诺 SLA；
- 不宣传“永久云存档”。

### 公开推广前最低要求

- 每日自动数据库备份，RPO 不高于 24 小时；
- 备份位于不同故障域，不和 ECS 同盘；
- 每月至少一次恢复演练；
- 记录恢复耗时，初期 RTO 目标 4 小时；
- OSS 启用版本/生命周期策略后，数据库元数据与对象正文一起校验恢复。

### 成熟阶段

- PostgreSQL PITR 或 RDS，RPO 目标 1 小时以内；
- 对象存储版本控制和跨区域策略按用户规模评估；
- 定期抽样校验正文 SHA-256；
- 恢复演练包含“数据库有指针但对象缺失”和“对象存在但未引用”两种异常。

没有经过恢复演练的备份不能算已完成的可靠性能力。

## 24. 监控与管理后台

### 24.1 指标

- 读取/写入成功率和 p50/p95/p99；
- `SAVE_CONFLICT`、配额、限流、Schema 错误分布；
- 本机待同步数量和最长等待时间（匿名聚合）；
- 当前正文、历史正文、孤立正文和每日增长字节；
- 每作品平均存档大小、写入频率和异常突增；
- 对账差异、清理失败、导出队列年龄；
- 数据库表/索引/TOAST/WAL 增长和磁盘安全水位。

### 24.2 管理员能力

- 查看某作品 policy、容量和错误聚合；
- 暂停某作品新写入但继续允许读/导出；
- 调整配额、退休 namespace；
- 查看槽位元数据与历史链完整性；
- 触发 usage 对账和正文完整性抽查；
- 在用户授权或安全事件下执行 break-glass 内容访问；
- 所有管理操作有原因、操作者、请求 ID 和不可变审计。

管理员不能直接编辑 JSON 正文。修复通过恢复、导入或经过审核的迁移工具生成新修订。

### 24.3 创作者能力

- 查看 policy、接入状态和兼容 Schema 范围；
- 查看聚合同步健康、错误码和存档尺寸分布；
- 下载 SDK 示例和本地契约测试工具；
- 提交配额/namespace 变更申请；
- 不得列出玩家槽位、正文、设备或冲突内容。

## 25. 测试矩阵

### 25.1 权限隔离

- A 用户不能访问 B 用户存档。
- 作品 X 不能访问作品 Y 存档。
- preview 不能修改 production。
- 撤下/退休发布停止新写入但允许用户导出。
- iframe 不会获得平台访问令牌或其他作品标识。

### 25.2 CAS 与幂等

- 两个并发相同 baseRevision 写入只有一个成功。
- 相同幂等键和正文重试返回原结果。
- 相同幂等键、不同正文返回 mismatch。
- 删除和写入并发不会产生悬空当前指针。
- Worker 重试清理/导出不会重复扣配额或生成无限对象。
- 服务端已接受写入但响应丢失时，原幂等请求重试返回原 revision，不先触发 CAS 冲突。
- inFlight 存在期间的连续保存只折叠 pending；确认恢复后 pending 以新 ETag 继续提交。
- 进程分别在 pending 落盘、pending→inFlight、服务端提交和确认落盘前后崩溃，重启后均不丢失最新本机完整快照。

### 25.3 离线和冲突

- 本机原子落盘后断电仍能恢复完整旧/新版本之一，不出现半份正文。
- 多次离线自动保存可以合并且保留最后正文。
- 云端前进后 outbox 不静默覆盖，产生 recovery 副本。
- 登出/切换账号不会把缓存交给另一用户。
- 匿名导入云端已有存档时不覆盖当前云端。

### 25.4 恶意输入

- 超限、无效 JSON、错误 UTF-8、摘要不符被拒绝。
- gzip 炸弹、极深 JSON、超大数字/字符串不会造成内存失控。
- slotKey 路径穿越和保留前缀被拒绝。
- 高频写、并行分片、过期 transfer 和乱序分片受控失败。
- 正文即使包含 HTML/JS，也不会在平台 origin 执行。

### 25.5 兼容性

- 旧 SDK/新宿主和新 SDK/旧宿主有明确能力降级。
- Schema 1→2→3 黄金样本迁移一致。
- 不兼容 release 回滚不会覆盖新 Schema。
- Web、Agent、Windows 对同一正文计算相同 SHA-256。

### 25.6 恢复与运维

- 历史恢复生成新 revision，可再次撤销。
- usage 对账能发现并修复故意制造的计数偏差。
- PostgreSQL 恢复后当前指针和历史链一致。
- OSS 阶段能发现缺失对象、摘要错误和孤立对象。
- 容量门禁关闭写入时，读取、导出和删除仍可用。

## 26. 分阶段实施

### S0：合同和数据骨架

- capability、共享合同、错误码和权限表；
- policy、slot、revision、usage、operation 数据模型；
- CAS 仓储、幂等与配额事务；
- 不接游戏 UI，完成 API 注入测试。

验收：权限、CAS、幂等、配额和数据库不变量测试通过。

### S1：在线云存档闭环（仅内部验证）

- 用户 API、通用 Web Game Host、SDK；
- 小文档在线读写、删除、历史和恢复；
- 平台同步状态 UI；
- A Dark Room adapter 和双账号/双宿主内部验收。

验收：在线条件下网页刷新、网页与 Cursor 切换不丢进度；并发产生明确冲突。S1 不允许把 A Dark Room 作为正式公开长流程游戏上线，因为网络中断和进程崩溃仍可能损失尚未落盘的进度。

### S2：可信宿主本机缓存与离线

- Browser IndexedDB、Agent、Windows SaveCacheAdapter；
- outbox、合并自动保存、重试和冲突恢复副本；
- 匿名存档与登录导入。

验收：断网、确认响应丢失、保存期间崩溃、继续修改、切换账号、双设备修改和重新联网全部通过；inFlight 幂等重试与 pending 折叠符合第 10.2 节状态机。

### S3：用户与运营能力

- 导出/导入、存档管理页；
- 创作者健康页、管理员治理和 break-glass 审计；
- 对账、清理、容量门禁和恢复演练。

验收：用户可以自助恢复和导出；完成至少一次真实备份恢复演练；平台故障不会导致静默覆盖。

**正式公开长流程游戏的最低门槛是完成 S0～S3。** S1 可供开发账号验证，S2 可用于明确标注风险的封闭内测；可靠本机落盘、outbox 重试、用户导出兜底和恢复演练缺一不可。

### S4：规模化存储

- OSS 正文后端、在线迁移和双读校验；
- RDS/PITR、对象完整性巡检；
- 更大存档、对象集合和跨区域策略按需求启用。

验收：迁移期间 API/SDK 合同不变，旧/新后端摘要一致，可安全回滚。

## 27. 推荐工程边界

```text
apps/api/src/game-saves/                    # 路由、服务、仓储、policy
apps/worker/src/game-saves/                 # 清理、对账、导出、迁移
packages/contracts/src/game-saves/          # HTTP/桥/错误码合同
packages/platform-client/src/web-game-host/ # 通用宿主及 save handler
packages/web-game-sdk/src/cloud-save/       # 创作者 SDK
packages/platform-api-client/               # 可信宿主 API 客户端
packages/save-cache-adapters/                # Browser/Agent/Windows 适配器
templates/cloud-save-web/                    # 示例和契约测试游戏
docs/                                        # 创作者指南、API、运维手册
```

仓库当前结构可能仍采用集中式文件；实施可以遵循项目惯例，但领域边界、权限和测试不能被折叠进某个游戏组件。

## 28. 开工前检查

- [ ] 其他工作会话已提交，核心 API/contracts/client 工作区干净。
- [ ] 从最新 `origin/main` 创建独立 `codex/game-save-foundation` worktree。
- [ ] 确认最终数据库迁移编号。
- [ ] 对齐 `docs/16` 的 sandbox 描述与生产 `runtime-edge-app.mjs`；实现以不放开 `allow-same-origin` 为安全基线。
- [ ] 决定通用 Web Game Host 的重构顺序，保证现有 multiplayer 不回归。
- [ ] 为桥分片传输编写独立协议和边界测试。
- [ ] 准备 A Dark Room 三类黄金存档：新游戏、中期、通关前。
- [ ] 明确内测阶段存档耐久性文案和导出入口。
- [ ] 在开放云存档前完成至少一次数据库恢复演练。

## 29. 完成定义

只有同时满足以下条件，才能称为平台级存档基础设施完成：

1. 至少两款存档结构不同的游戏无需修改核心 API/表即可接入。
2. Web、Agent 和 Windows 使用同一逻辑存档并通过 CAS 冲突测试。
3. 不增加 `allow-same-origin`，游戏 iframe 不获得平台令牌。
4. 多设备并发不会静默覆盖，所有冲突都有可恢复副本。
5. 匿名、本地待同步、云端完成和冲突状态对用户清晰可见。
6. 游戏更新、Schema 迁移和 release 回滚不会不可逆损坏存档。
7. 配额、限流、历史、清理和 usage 对账经过故障测试。
8. 创作者无法读取玩家正文，管理员内容访问必须 break-glass 审计。
9. 用户能够查看、导出、恢复和删除自己的存档。
10. 生产宣传云存档前具备经过演练的备份恢复方案。

## 30. 最终架构结论

成熟的游戏存档底层不是“数据库里放一段 JSON”，而是一套身份隔离、版本控制、冲突处理、离线同步、恢复、配额和耐久性承诺。

GameHub 应把以下四层严格分开：

```text
游戏内存状态
    ↓
可信宿主本机缓存与 outbox
    ↓
云端不可变存档修订
    ↓
独立的服务端权威数据（竞技、经济、多人）
```

这套边界既能支持 A Dark Room，也能支持以后绝大多数单机、剧情、解谜和轻量客户端游戏；需要大型开放世界分块或强权威经济时，在相同身份、CAS 和审计基础上增加专用数据域，而不是破坏普通存档服务的安全语义。

经过第一次交叉评审，当前文档已消除历史配额、outbox 确认丢失、ETag 和公开上线门槛的合同矛盾，可以启动共享前置切片和 S0；在通用桥、game session、持久 outbox 和恢复演练 spike 通过前，不应宣称全部存档工程已可直接公开上线。

跨存档与竞赛的推荐实施顺序：

```text
修订合同与数据库不变量
  -> 通用 Web Game Host + 短期 game session + 统一分片
  -> 存档最小可靠闭环（含本机 outbox、导出与恢复）
  -> 2048 replay-verified 排行榜
  -> 第二款不同存档结构游戏 + 迷阵权威多人结果接入
```

保持 Cloud Save、Competition 和 Multiplayer 的领域数据分离；当前阶段不需要新增独立部署微服务。
