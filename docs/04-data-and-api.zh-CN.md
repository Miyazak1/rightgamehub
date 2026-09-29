# 数据模型与接口草案

版本：v1.0 · [目录](./README.md)

**当前实现契约已独立成文**：[14 数据模型与 HTTP API](./14-data-api-spec.zh-CN.md)、[15 插件与播放器](./15-harness-player-spec.zh-CN.md)、[18 多宿主完整客户端](./18-multi-host-client-spec.zh-CN.md)、[19 Windows 包](./19-windows-package-spec.zh-CN.md)定义首版具体契约。本篇收费、领取、LaunchSession、云存档及旧审核状态仅作长期参考，不能直接按全文实现。

本文定义拟实现的业务契约，全部接口名称均为本平台设计草案，不代表已经存在，也不是 Codex 或其他宿主的官方 API。经营假设为中国大陆公司面向海外用户，首个计价币种建议 USD。

**2026-09-22 调整：以下为完整平台的参考模型。当前只实现 [免费首版](./07-free-mvp.zh-CN.md) 的作者、作品、上传、版本、资源和最小管理数据；不建 Price、Order、SellerAccount、EntitlementGrant、财务账本等收费表，也不接支付 SDK/沙箱。** 公开免费作品按发布状态运行，不要求购买权益或先领取；普通上传检查通过即可自动发布，异常包才转复核。云存档与完整 agent 发布工具后续增加。

## 1. 核心实体

Windows 下载是首版要求：采用 WorkTarget 下独立 Release、绑定包哈希的扫描状态和下载接口，具体字段与约束见 19。下文单一 Work 当前版本指针已被替换，浏览器 manifest 仅适用于网页版本。

| 实体 | 关键字段与约束 |
| --- | --- |
| User | id、登录身份、状态、条款版本；公开昵称与身份资料分离 |
| Creator | id、owner_user_id、公开资料、个人/企业类型、所在地、入驻状态 |
| CreatorMember | creator_id、user_id、role；团队编辑、发布和财务权限分离 |
| SellerAccount | creator_id、provider、provider_account_id、收款/结算能力、受限原因、核验时间 |
| Work | id、creator_id、slug、类型、元数据、可见性、current_release_id |
| Release | id、work_id、版本、artifact_id、manifest、审核状态、批准权限、禁用状态；内容不可变 |
| Artifact / Asset | 包哈希、存储键、路径、MIME、encoding、尺寸、单资产哈希；规范路径唯一 |
| UploadJob | 作者、目标作品、对象键、配额、阶段、错误、幂等键 |
| Review | work/release、审核类型、结论、证据引用、操作者、时间、申诉记录 |
| Price | work_id、currency、amount_minor、版本、生效时间；不修改历史价格 |
| MarketPolicy | 国家、作品类别、销售/运行开关、税务模式、渠道与年龄条件、版本 |
| Order / OrderItem | 买家、作品、卖方和价格快照、税、币种、总额、费用政策、状态 |
| PaymentAttempt | order_id、provider、渠道对象、幂等键、状态、实际金额与费用 |
| EntitlementGrant | user、work、来源订单/免费领取、状态、范围；每个来源唯一 |
| LaunchSession | user/guest、work、release、权益来源、能力摘要、有效期、撤销时间 |
| Save / SaveSnapshot | user、work、slot、schema_version、etag、数据大小、快照与迁移来源 |
| Refund / Dispute | order、渠道对象、金额、原因、状态、权益处理、证据引用 |
| Journal / JournalLine | 不可变记账事件、币种、科目、借贷金额；按币种平衡 |
| Settlement / Payout | 作者、来源交易、费用、可结金额、渠道分账对象、到账状态 |
| WebhookEvent / Outbox | provider+event_id 唯一、处理结果；待投递业务事件与重试 |
| Report / AuditLog | 举报、审计、处置和关联事件；关键操作不可覆盖 |

购买权益由有效的 EntitlementGrant 汇总得出。退款撤销的是对应订单的授予记录；若用户另有合法赠送或免费领取权益，不能错误地把整个账户对作品的访问一并删除。

所有写接口校验 actor 与对象归属，不能只凭前端传入的 `creator_id` 或 `user_id`。价格、税额和佣金必须服务端计算；客户端提交的显示金额没有记账效力。跨租户查询、预览授权、存档及结算查询分别做访问控制。

## 2. 状态机

### 2.1 作品与版本

```text
上传任务：created → uploading → uploaded → validating → preview_ready
                       └→ expired       └→ failed

发布版本：draft → review_pending → approved → published → superseded
                           └→ rejected → 新版本重新提交
任一可运行版本：→ suspended / revoked

作品列表：draft → listed → unlisted
                        → suspended
```

上传失败可以重新申请任务；文件变化产生新 artifact。作者编辑并不能把已审核的包原地替换。作品下架、版本禁用和停止销售是不同维度，避免一个布尔值同时承担三种含义。

`approved` 只说明该版本审核通过；发布时仍检查作者身份、市场条件、内容状态及价格配置。付费发布额外检查销售和结算能力。市场政策失效后即使版本已发布，也能禁止创建新订单或启动。

### 2.2 交易与结算

```text
订单：created → payment_pending → paid
             → cancelled / expired / payment_failed
paid → partially_refunded / refunded

退款：requested → reviewing → submitted → succeeded
                          → rejected    → failed

结算：accrued → held → eligible → submitted → settled
                                      └→ failed / returned

争议：opened → evidence_submitted → won / lost / closed
```

这些状态不是一条跨系统分布式事务。渠道状态可能延迟、重试、乱序：事件收件箱先去重，必要时查询渠道当前状态；数据库事务记账，Outbox 负责后续动作。迟到的“支付中”不能把已成功订单退回待支付；退款成功不能被迟到的付款通知恢复权益。

迟到支付、重复付款和支付时作品被禁用的订单进入明确补偿流程：查询实际收款、避免重复发放，无法交付时处理退款，而不是仅返回前端错误。

## 3. 作品包示例

```text
dist.zip
├── index.html
├── platform.json
├── assets/
│   ├── app.js
│   ├── scene.glb
│   └── audio.ogg
└── LICENSES.txt
```

```json
{
  "schemaVersion": 1,
  "entry": "index.html",
  "kind": "game",
  "runtime": "web",
  "renderers": ["webgl2"],
  "wasm": { "required": false, "threads": false },
  "display": {
    "minWidth": 360,
    "preferredAspectRatio": "16:9",
    "orientation": "any"
  },
  "input": ["keyboard", "pointer"],
  "permissions": {
    "audio": true,
    "fullscreen": true,
    "pointerLock": false,
    "camera": false,
    "microphone": false,
    "externalNetworkOrigins": []
  },
  "sdk": { "version": "1", "cloudSave": true },
  "saveSchemaVersion": 1,
  "locales": ["en"],
  "aiUsage": ["code_assistance", "visual_assets"],
  "licensesFile": "LICENSES.txt"
}
```

`kind` 可为 `game`、`creative`、`tool`，用于展示而不是法律分类。作者声明会经过验证；例如写入 `camera:false` 不足以证明代码从不请求摄像头，运行容器也要限制。manifest 不能携带任意响应头、CSP 覆盖、渠道账户或秘密密钥。

`externalNetworkOrigins` 首版默认空，仅受审核的版本能扩展；不能把 `*` 当作合法域名清单。平台 SDK 桥接通信不依赖给作品开放整个业务 API 域。

## 4. REST API 草案

统一前缀 `/v1`，JSON 请求；分页采用 cursor。所有敏感写操作支持幂等键，错误含稳定 `code`、用户可读信息及 `request_id`。认证 Cookie 写操作防 CSRF，授权令牌有范围和有效期，服务器精确校验 Origin。

| 方法与路径 | 用途 | 权限或关键条件 |
| --- | --- | --- |
| GET `/works` | 搜索、分类、设备与市场筛选 | 仅返回可见作品，价格按允许市场展示 |
| GET `/works/{id}` | 作品详情与当前版本要求 | 不泄露私有包的存储地址 |
| POST `/creator/works` | 创建草稿 | 当前作者写权限 |
| PATCH `/creator/works/{id}` | 修改元数据 | 归属校验，敏感变更触发审核 |
| POST `/creator/works/{id}/uploads` | 申请上传地址 | 字节上限、对象键、授权过期时间 |
| POST `/creator/uploads/{id}/complete` | 通知上传完成 | 后端重新核对存储对象；幂等 |
| GET `/creator/jobs/{id}` | 查看检测日志 | 仅作者与授权审核员；日志脱敏 |
| POST `/creator/releases/{id}/preview` | 获取限时预览会话 | 私有预览权限，不可越权查看他人草稿 |
| POST `/creator/releases/{id}/submit` | 提交审核 | 文件不可再改变 |
| POST `/creator/releases/{id}/publish` | 发布审核通过版本 | 发布权限、当前市场政策和资格全部通过 |
| POST `/creator/works/{id}/prices` | 新价格版本 | 金额、币种、最低价和适用资格 |
| POST `/creator/seller-onboarding` | 创建渠道入驻会话 | 受限回调 URL；不把 KYC 表单发给游戏 |
| GET `/creator/settlements` | 收益与到账记录 | 财务权限，仅自己数据 |
| POST `/orders` | 创建订单与结账会话 | 服务端金额快照；重复购买规则 |
| GET `/orders/{id}` | 支付与交付结果 | 买家/授权财务人员 |
| POST `/orders/{id}/refund-requests` | 提交退款申请 | 买家归属、重复申请去重 |
| POST `/webhooks/payments/{provider}` | 接收渠道事件 | 原始请求体验签、重放保护、事件唯一约束 |
| POST `/works/{id}/claim` | 免费领取 | 仅当前免费且可领取的作品 |
| GET `/me/library` | 汇总有效权益与最近体验 | 当前用户 |
| POST `/works/{id}/launch` | 申请启动会话 | 权益、市场、版本、权限和运行能力校验 |
| POST `/launches/{id}/renew` | 续期资产访问 | 仅可信播放器，会话和权益重新检查 |
| GET `/me/works/{id}/saves/{slot}` | 读取云存档 | 用户与作品权限 |
| PUT `/me/works/{id}/saves/{slot}` | 提交新存档 | If-Match/ETag、配额、schema 校验 |
| POST `/reports` | 举报作品或侵权 | 限流、证据受控上传 |
| POST `/admin/releases/{id}/suspend` | 紧急禁用 | 审核管理权限、原因、审计与分发失效事件 |

常见业务错误：`ARTIFACT_INVALID`、`REVIEW_REQUIRED`、`SELLER_NOT_ELIGIBLE`、`MARKET_UNAVAILABLE`、`ENTITLEMENT_REQUIRED`、`RELEASE_REVOKED`、`HOST_UNSUPPORTED`、`CAPABILITY_MISSING`、`SAVE_CONFLICT`、`PAYMENT_PENDING`。用户界面提供可理解的处理路径，不直接暴露内部堆栈或支付密钥。

## 5. 播放器 SDK 与宿主协议

以下为示意调用，SDK 名称待正式命名：

```javascript
const platform = await PlatformSDK.connect({ protocol: 1 });
const checkpoint = await platform.loadSave({ slot: "main" });
restoreGame(checkpoint?.data);
await platform.ready({ saveSchemaVersion: 1 });

// 游戏检查点或用户点击保存时调用；不每帧写网络。
await platform.save({
  slot: "main",
  schemaVersion: 1,
  expectedVersion: checkpoint?.version ?? null,
  data: { level: 2, score: 100 }
});
```

父播放器用服务器颁发的会话创建桥接，内部验证作品版本和能力范围。SDK 没有读取邮箱、交易卡号、任意 URL 请求、shell 或工作区操作方法。上传到云存档的数据视为不可信内容，设大小限制，不在后台模板里执行。

宿主适配器的最小能力契约：

```text
getCapabilities() -> 公开接口能力 + 政策允许范围
openPanel(platformUrl) -> queued/opened/failed
waitForReady(sessionNonce, timeout) -> ready/timeout/failed
openBrowser(platformUrl) -> queued/opened/failed
onVisibilityChanged(handler) -> unsubscribe
```

`queued` 不等于 `opened`，`opened` 不等于游戏 `ready`。侧栏失败回退时清理监听和未完成会话，防止两个入口同时重复启动。输入焦点和缩放由各宿主适配器分别验证。

## 6. Agent 工具契约

| 拟定工具 | 行为 | 权限 |
| --- | --- | --- |
| `catalog.search` / `work.get` | 查询与展示作品 | 读 |
| `work.create_draft` | 从作者描述创建草稿 | draft:write |
| `release.create_upload` | 返回作用域有限的上传授权 | upload:write |
| `release.validation_result` | 读取检测报告 | 当前作者/项目 |
| `release.preview` | 返回限时私有预览 | preview:read |
| `release.submit` | 提交审核 | review:submit |
| `release.publish` | 发布已获批版本 | publish:write，符合明确用户授权 |
| `library.list` / `work.launch` | 获取作品库和可用入口 | library:read / launch |

工具调用复用业务 API，不直接写数据库、设置财务账户或跳过审核。工具返回的作品文本作为数据处理；服务端不接受“作品描述要求管理员权限”之类提示。Agent 认证采用单独 OAuth scope 与撤销机制，不能让每件游戏拿到 creator 发布令牌。

## 7. 支付适配器与数据演进

PaymentProvider 最少覆盖：作者入驻、能力查询、创建结账、支付查询、回调验证、退款、分账/冲正、付款状态、账单下载。能力声明区分 `collect`、`split`、`payout`、`refund` 和国家组合；只有收款能力的渠道不能被界面显示为支持作者自动结算。

渠道对象 ID 仅保存在映射表，业务订单不使用供应商对象作为唯一主键；渠道迁移保留原退款/争议处理通道，不把历史订单伪装成新渠道交易。

数据库迁移先兼容新增字段，再切换读写，再清理旧结构；不可逆删除需备份和审批。发布包和存档各有独立 schema 版本，支持旧播放器一段明确兼容期。核心约束包括订单幂等、回调去重、按币种记账平衡、资产路径唯一与存档乐观锁，均在数据库或服务端强制，而非只在 UI 校验。
