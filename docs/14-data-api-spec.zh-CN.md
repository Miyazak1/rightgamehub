# 数据模型与 HTTP API 技术规范

版本：TD-1.1 · 状态：待实现契约 · [技术总纲](./13-technical-design.zh-CN.md)

插件内认证和传输增量以 [18](./18-multi-host-client-spec.zh-CN.md)为准；多目标与 Windows 包以 [19](./19-windows-package-spec.zh-CN.md)为准。以下 HTTP/幂等/权限为共用基线。

## 1. 通用约定

API 前缀 `/v1`；JSON 字段用 camelCase，数据库用 snake_case；ID 为服务端生成的 UUID v4；时间为 UTC RFC 3339；容量单位为字节。API 返回的整数不得超过 JavaScript 安全整数上限，数据库的 revision/序号通过十进制字符串返回。

除 ZIP 流外，请求体默认最多 64 KiB；字符串按 Unicode 字符数检查，另限制实际字节。拒绝未声明的写入字段，所有数据库查询使用参数化语句。客户端不能指定 owner、内部对象键、审核状态或权限批准结果。

成功响应为 `{ "data": ... }`，分页另含 `page.nextCursor`；错误格式统一：

```json
{
  "error": {
    "code": "UPLOAD_TOO_LARGE",
    "message": "The ZIP exceeds the 100 MiB limit.",
    "requestId": "3c9b6d92-1f65-4e40-a57b-fb5c1472dbe0",
    "retryable": false,
    "details": { "maxBytes": 104857600 }
  }
}
```

`details` 只允许该错误定义的公开字段，不返回堆栈、SQL、对象存储凭据或内部路径。响应带 `X-Request-ID`。敏感作者响应及启动描述 `Cache-Control: no-store`。

分页 `limit` 默认 20、最大 50；cursor 是经 HMAC 校验的游标，绑定筛选条件和排序键。作品按 `first_published_at DESC, id DESC` 排序，用键集分页，发布更新不改变首次发布时间。

## 2. 认证与权限

作者默认使用 18 的插件内邮箱验证码与有限设备授权。GitHub OAuth 为可选网站方式：最小 scope `read:user`，不申请 repo；使用单次 state、PKCE S256、固定回调与每次重新验证身份。它不再是上传发布的必经入口。[GitHub OAuth 流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

可选网站会话 Cookie 为 `__Host-gamehub_session`，`Secure; HttpOnly; Path=/; SameSite=Lax`，不设 Domain，7 天绝对有效期，数据库只存令牌哈希。插件采用独立的 access/refresh 授权，规则见 18；退出/禁用都需撤销。OAuth 临时记录只在启用该方式时创建。

Cookie 作者写请求校验会话、精确 Origin 和 `X-CSRF-Token`；`/me` 在该模式返回 CSRF token。插件 Bearer 作者请求校验设备授权、scope、账号状态和对象归属，不依赖 Cookie/CSRF；混合两种身份的请求拒绝。管理操作要求 admin 且最近 15 分钟重新认证，不能自我提权。

| 调用者 | 权限 |
| --- | --- |
| 游客/未登录插件 | 公开目录、详情、启动描述、限流举报、运行资产与允许分发的下载包 |
| 已登录插件 | 使用有限设备授权管理本作者作品和上传，不向游戏暴露 token |
| 已登录用户 | 自己的账号；只有 `can_publish=true` 才能创建作品与上传 |
| 作者 | 自己作品和任务的读写；对象归属在服务端逐次检查 |
| 管理员 | 查看待复核项、批准或拒绝、禁用作品/版本、处置举报 |
| 运行网关 | 用独立服务凭据只读运行状态；没有作者或管理权限 |

公开目录和启动描述允许无凭证跨源。作者/管理/内部路由不继承此策略：插件作者写操作优先经可信 Host 调用；浏览器内容直传仅在单任务 upload grant 路由开放所需 PUT/OPTIONS，不带 Cookie。网站 Cookie 业务 API 保持同源。

匿名举报 `/reports` 单独允许无凭证的 JSON POST/OPTIONS 跨源访问，仍执行 IP/作品限流、字段校验和长度限制；它不能修改发布状态，作者写路由不因开放举报而开放跨源。

## 3. 逻辑表结构

以下列出业务字段；明确标注的可选网站认证表仅在启用该模块时创建。所有表还包含适用的 `created_at/updated_at`。JSONB 用于有 Schema 的扩展字段，不替代外键或索引。

| 表 | 主要字段与约束 |
| --- | --- |
| `users` | `id PK`、`display_name`、`status(active/suspended)`、`role(user/admin)`、`can_publish`、`terms_version`；不保存不必要的 GitHub资料 |
| `auth_identities` | `user_id FK`、`provider`、`subject`；唯一 `(provider,subject)`；不以可修改用户名为身份键 |
| `auth_sessions`（可选网站模块） | `id`、`user_id`、`token_hash UNIQUE`、`csrf_secret`、`authenticated_at`、`expires_at`、`revoked_at` |
| `oauth_attempts`（可选 GitHub 模块） | `state_hash UNIQUE`、`browser_binding_hash`、`pkce_verifier`、`return_to`、`expires_at`；回调消费后删除，不写普通日志 |
| `creator_usage` | `user_id PK/FK`、`work_count`、`stored_bytes`、`reserved_bytes`、`active_uploads`；更新配额时锁行 |
| `works` | `id`、`owner_user_id`、`title`、`description`、`kind(game/creative/tool)`、全局 `state/visibility`、metadata `revision`、`first_published_at`、`cover_asset_id NULL` |
| `work_targets` | `(work_id,target_key) PK`、`current_release_id NULL`、目标 `revision/publish_generation/state`，见 19 |
| `releases` | `id`、`work_id`、`upload_job_id UNIQUE`、`label`、`validation_state`、`serving_state`、`manifest`、`approved_capabilities`、`artifact_sha256`、`asset_prefix`、`asset_manifest_sha256`、`asset_count`、`expanded_bytes`、`retire_after NULL` |
| `upload_jobs` | `id`、`owner_user_id`、`work_id`、`state`、`declared_bytes`、`declared_sha256`、`actual_bytes`、`actual_sha256`、`object_key UNIQUE`、`auto_publish`、`publish_generation NULL`、`publication_outcome`、`reserved_bytes`、`expires_at`、`error_code NULL` |
| `assets` | `(release_id,path) PK`、`object_key UNIQUE`、`sha256`、`size_bytes`、`mime`；规范路径区分大小写，但拒绝大小写折叠冲突 |
| `jobs` | `id`、`kind(validate/scan/gc)`、`target_id`、`state`、`attempt`、`available_at`、`lease_until`、`lease_token NULL`、`last_error_code`；唯一 `(kind,target_id)`；scan 的执行环境见 19 |
| `idempotency_keys` | `(actor_id,operation,key) PK`、`request_hash`、`result_status`、`result_json`、`expires_at`；响应不能包含长期秘密 |
| `reports` | `id`、`work_id`、`release_id NULL`、`category`、`description`、`status(open/resolved/dismissed)`、短期限流标识；不要求游客账号 |
| `audit_logs` | `id`、`actor_type`、`actor_id NULL`、`action`、`target_type/id`、`request_id`、`summary`、`created_at`；业务角色只能追加 |

不创建价格、订单、免费领取、购买权益、分账、财务、云存档或游客 LaunchSession 表。`launchId` 是播放器本地的消息关联 ID，不是服务器资产授权令牌。

18 的验证码/设备/access/refresh/upload grant 表和 19 的 DownloadArtifact/ScanReport/RuntimeCompatibility 为当前必需增量；Release 与 UploadJob 增加 target_key 和 package_type。原单一网页模型不能直接作为多目标实现。

必要的约束和索引：

- `releases UNIQUE(work_id,target_key,id)`；`work_targets(work_id,target_key,current_release_id)` 复合外键指向该约束，防止跨作品或跨目标指针。
- `current_release_id` 只有在验证通过、资源完整且版本未禁用时才能切换，由发布事务保证跨表条件。
- 非负容量 CHECK、标题 1—120 字符、简介最多 4,000 字符；发布标签最多 64 字符，仅作展示，不参与对象路径。
- 公开列表部分索引 `(first_published_at DESC,id DESC)` 限 `state='published' AND visibility='public'`；作者列表 `(owner_user_id,created_at DESC)`。
- `jobs(state,available_at)`、`jobs(lease_until)`，以及 `upload_jobs(owner_user_id,state)` 用于领取与清理。
- 不对有运行资产的作品做级联物理删除；先逻辑撤下，再由 GC 按明确保留期删除。账号处理不能绕过此顺序。

## 4. 状态与并发规则

| 对象 | 状态和含义 |
| --- | --- |
| Work state | `draft` 未发布；`published` 已发布；`withdrawn` 作者撤下、所有版本停止新读取；`suspended` 管理禁用 |
| Work visibility | `private` 或 `public`；草稿为 private，公开发布事务设为 public |
| Release validation | 网页 `processing → ready`；Windows `processing → scanning → ready`；异常到 `review_required/failed`，恢复须满足复核及检测策略 |
| Release serving | 初始 `disabled`；公开发布后 `enabled`；禁用或退休为 `revoked`，恢复必须有新的管理操作和审计 |
| Upload | `created → receiving → uploaded → queued → validating → succeeded`；Windows 在 validating 后增加 scanning；适用步骤可到 `failed/expired/review_required` |
| Publication outcome | `pending / published / draft / skipped_newer_intent / blocked`；检查成功不一定已公开 |

创建 `autoPublish=true` 的上传时，在对应 WorkTarget 行锁内递增 publish_generation 并复制到任务。新的同目标意图、发布/撤下/禁用递增该序号；整体撤下/禁用递增全部目标序号。worker 只发布仍匹配的任务，较新失败不自动发布旧任务；网页与 Windows 独立排序。

公开发布事务检查作者、Work/Target 状态、同作品同目标版本、校验 ready、资产/下载包完整、必要扫描通过、配额与意图序号。更新目标 current_release、Target/Work 公开状态、Release serving 和审计后提交；原发布版不先下线。

修改元数据与整体撤下使用 Work ETag；目标发布/撤下使用 19 的 Target ETag 和 If-Match。缺少返回 428、过期返回 412。版本不原地改内容；回滚只指向同目标已验证且未撤销的旧版，并记审计。

## 5. 幂等与任务执行

创建作品、修改元数据、创建上传、complete、发布、撤下和管理写操作接受必需的 `Idempotency-Key`（16—128 ASCII 字符）。同 actor/操作/key 及相同请求得到原结果；同 key 不同请求返回 409 `IDEMPOTENCY_CONFLICT`。记录保留 24 小时。领域写入和幂等结果同一数据库事务提交；网络断开不要求客户端猜测是否成功。先完成身份/归属检查，再检查幂等记录；已有成功记录可直接重放，不重新执行过时的 If-Match。

ZIP 内容 PUT 由任务状态和内容哈希去重，不复制 100 MiB 请求进幂等表。任务上传成功后相同内容返回当前状态；已经 receiving 的并发 PUT 返回 409；失败或过期任务创建新的上传 ID。服务重启后的未完成 multipart 按 16 清理。

领取后台任务使用短事务 `FOR UPDATE SKIP LOCKED`，设置随机租约令牌并立即提交，然后做存储和解析操作。该锁法适合队列消费者，不用于需要完整一致结果的业务列表。[PostgreSQL SELECT 锁定说明](https://www.postgresql.org/docs/16/sql-select.html)

租约 30 秒，每 10 秒续租；写结果时 CAS 校验 lease_token。租约丢失的旧 worker 不能提交发布结果。瞬时网络错误最多 3 次，退避 5/30/120 秒；格式错误不重试。重复执行同一任务必须返回同一个 Release，不产生额外版本；随机 attempt 目录隔离中间产物。

## 6. 路由清单

| 方法与路径 | 权限 | 主要请求/结果 |
| --- | --- | --- |
| GET `/auth/github/start` | 可选网站导航 | 启用此方式时创建 OAuth attempt，302 |
| GET `/auth/github/callback` | 可选单次 state | 启用此方式时建立网站 session |
| GET `/me` | session 或 Bearer | id/displayName/canPublish；仅 Cookie 模式返回 csrfToken；无授权 401 |
| POST `/auth/logout` | session+CSRF | 撤销，204 |
| GET `/works?limit=&cursor=&kind=` | 匿名 | 至少有一个可玩或可下载目标的公开作品，分页 |
| GET `/works/{workId}` | 匿名 | 公开详情和当前版本摘要 |
| GET `/works/{workId}/launch?releaseId=` | 匿名 | 当前版或明确请求的仍启用旧版；no-store |
| GET `/creator/works` | 作者 | 自己全部作品，分页 |
| GET `/creator/works/{workId}` | owner | 全部元数据、版本状态、ETag |
| POST `/creator/works` | 作者+幂等 | `{title,kind}` → 201 草稿 |
| PATCH `/creator/works/{workId}` | owner+If-Match+幂等 | `{title?,description?,kind?}` → 新 ETag；不允许 HTML 描述 |
| POST `/creator/works/{workId}/uploads` | owner+幂等 | 见下文，201 |
| PUT `/creator/uploads/{uploadId}/content` | owner 或单任务 grant | ZIP/EXE 按 packageType 接收原始字节；Cookie 模式另验 CSRF |
| POST `/creator/uploads/{uploadId}/complete` | owner+幂等 | `{}` → 202 job；重试返回同一 job |
| GET `/creator/uploads/{uploadId}` | owner | 任务阶段、已知进度、releaseId、发布结果或错误 |
| POST `/creator/works/{workId}/targets/{targetKey}/publish` | owner+Target If-Match+幂等 | `{releaseId}`；同目标 ready 草稿或允许的旧版 → 200 |
| POST `/creator/works/{workId}/targets/{targetKey}/withdraw` | owner+Target If-Match+幂等 | 撤下单目标，其他目标不受影响 |
| POST `/creator/works/{workId}/withdraw` | owner+If-Match+幂等 | `{reason?}` → 200；递增意图序号 |
| POST `/reports` | 匿名、限流 | `{workId,releaseId?,category,description}` → 202；不回显处理内部信息 |
| GET `/admin/reviews` | admin | 待复核上传及理由，分页 |
| POST `/admin/releases/{releaseId}/review` | admin+幂等 | `{decision,reason}`；只批准模板支持的能力，不允许任意域名/响应头 |
| POST `/admin/works/{workId}/suspend` | admin+幂等 | `{reason}`，禁用整件作品 |
| POST `/admin/releases/{releaseId}/revoke` | admin+幂等 | `{reason}`，禁用一版；当前版被禁用时停止启动 |
| GET `/admin/reports` | admin | 举报列表，分页 |
| PATCH `/admin/reports/{reportId}` | admin+幂等 | `{status,reason}`，更新举报处置并记审计 |

路由总前缀均为 `/v1`。非本人对象的作者路由返回 404，避免泄露归属；未登录 401，已登录但无发布权限 403。首版不提供自动解除管理禁用的作者接口。

## 7. 关键请求与响应

创建上传请求：

```json
{
  "fileName": "tiny-world.zip",
  "declaredBytes": 2097152,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "releaseLabel": "0.1.0",
  "targetKey": "web",
  "packageType": "web_zip",
  "autoPublish": true
}
```

`fileName` 只用于显示，最长 200 字符；sha256 由可信客户端流式计算，API 和 worker 独立复核。targetKey/packageType/autoPublish 必填，UI 默认“上传并发布”，草稿选 false；Windows 字段见 19。

```json
{
  "data": {
    "uploadId": "016e9457-f7be-4a54-a1c1-c150439a8521",
    "state": "created",
    "upload": {
      "method": "PUT",
      "url": "/v1/creator/uploads/016e9457-f7be-4a54-a1c1-c150439a8521/content",
      "contentType": "application/zip",
      "maxBytes": 104857600
    },
    "expiresAt": "2026-09-22T12:30:00Z"
  }
}
```

创建到开始上传有效期 30 分钟；接收总时限网页 15 分钟、Windows 30 分钟，grant 另按 18 约束。插件流式上传显示传输进度，验证阶段显示阶段名，不伪造无法计算的百分比。

启动描述：

```json
{
  "data": {
    "apiVersion": 1,
    "workId": "2b318e4b-5470-4890-b452-6e15c2cba117",
    "releaseId": "6b9a0f18-d6fa-4241-957c-dbfab4998a41",
    "releaseLabel": "0.1.0",
    "entryUrl": "https://r-6b9a0f18d6fa4241957cdbfab4998a41.gamehubusercontent.example/index.html",
    "runtimeOrigin": "https://r-6b9a0f18d6fa4241957cdbfab4998a41.gamehubusercontent.example",
    "playerProtocol": { "min": 1, "max": 1 },
    "capabilities": {
      "webgl2Required": true,
      "wasmRequired": false,
      "fullscreen": true,
      "pointerLock": false,
      "sdkPauseVerified": false
    },
    "display": { "minWidth": 360, "aspectRatio": "16:9" }
  }
}
```

`capabilities` 是平台检查和批准后的值，不能原样返回作者权限声明。`sdkPauseVerified` 只能由兼容性抽测或受信模板认证设为 true；普通 SDK 声明不自动取得后台保留资格。此描述没有任何用户 token，免费资源不建立购买授权会话。

目录项字段为 `id/title/kind/descriptionExcerpt/coverUrl/authorName/firstPublishedAt/availableTargets`；详情增加 `description/targets[]/shareUrl`，每目标包含当前 release、下载或运行能力。网页 launch 响应仍使用上面的单一确定版本结构。封面缺省用占位图，URL 需验证，描述纯文本渲染。

上传状态结果包含 `state/releaseId?/publicationOutcome/error?`。检查成功但 `skipped_newer_intent` 时显示“检查通过，有更新的发布操作，本版本尚未公开”，不显示“发布成功”。

## 8. 内部网关契约

`GET /internal/v1/releases/{releaseId}/runtime-state` 用独立只读服务凭据，返回 `allow/distributionType/policyVersion/cacheTtlSeconds` 及必要的 web 资产字段或 Windows 下载对象字段。检查 Work/Target 公开有效、版本 ready/enabled、作者状态及对应资产/扫描结果；旧版还须未退休。同一响应不能把 Windows 包当 HTML 入口。

拒绝结果不返回对象键。可缓存允许结果最多 30 秒，禁止 stale-if-error；API 不可达且无未过期允许结果时 fail closed。公开启动 API 每次查权威状态，不依赖此缓存。详见 16 的缓存顺序。

## 9. 错误与客户端处理

| HTTP / code | 处理 |
| --- | --- |
| 400 `SCHEMA_INVALID` | 标注字段，保留用户输入 |
| 401 `AUTH_REQUIRED` | 作者重新登录；不影响匿名游玩 |
| 403 `PUBLISH_NOT_ENABLED` | 提示当前账号未获发布权限 |
| 404 `NOT_FOUND` | 对象不存在或不允许获知；不自动重试 |
| 409 `UPLOAD_BUSY / IDEMPOTENCY_CONFLICT / STATE_CONFLICT` | 重新查询状态或使用新的操作意图 |
| 410 `WORK_WITHDRAWN / RELEASE_REVOKED / UPLOAD_EXPIRED` | 停止启动或新建上传，不循环重试 |
| 412/428 `REVISION_CONFLICT / PRECONDITION_REQUIRED` | 获取新 ETag，让作者基于当前数据操作 |
| 413 `UPLOAD_TOO_LARGE / EXPANDED_TOO_LARGE` | 显示上限，要求重新打包 |
| 422 `ARTIFACT_INVALID / ENTRY_MISSING / UNSUPPORTED_CAPABILITY` | 展示安全的具体原因；检查失败不覆盖旧版 |
| 429 `RATE_LIMITED / QUOTA_EXCEEDED` | 读取 Retry-After；展示配额，不自动高频重传 |
| 503 `SERVICE_UNAVAILABLE` | 有限重试，并保留当前可见界面 |

SDK/运行错误另见 15；浏览器不暴露明确原因的跨源加载失败显示 `FRAME_LOAD_UNCONFIRMED`，不能凭空断言“服务器 404”。

## 10. 契约实现要求

实施时 `packages/contracts` 作为 Schema 单一来源，生成 OpenAPI 3.1 与客户端类型，生成文件提交版本控制；本轮未伪造一个已运行的 OpenAPI 服务。契约测试至少覆盖所有响应分支、拒绝未知写字段、归属、幂等重试、ETag 冲突、慢任务发布顺序和管理禁用竞态。
