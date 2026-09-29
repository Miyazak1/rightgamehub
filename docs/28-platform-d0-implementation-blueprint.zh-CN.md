# GameHub D0 实施蓝图

日期：2026-09-24 · 版本：PD-1.1 · 状态：设计定稿，可进入 M1；不表示生产平台已经实现。

本文件是 [27 完整平台设计与任务交接](./27-platform-design-and-handoff.zh-CN.md) 的可实施补充。27 负责产品边界、总体架构和证据；本文固定组件、迁移、接口、状态、模块依赖、部署单元和验收门槛。精确的上传、运行隔离和宿主安全要求继续采用 14—19，本文不放宽它们。

## 1. 定稿结论与修订

### 1.1 已定稿的产品决定

- 免费 MVP，不建立价格、订单、支付、权益、抽佣或结算模型。
- Harness 是首个完整客户端；VS Code 与 Cursor 使用同源 VSIX，但必须分别验收。
- Web 游戏在宿主功能区运行；普通 Windows EXE 下载、校验后，由用户点击在独立窗口启动。
- `nativeSidebarPlayable` 仅表示专门通过侧栏适配验收的包。它与普通 EXE 的 `canLaunchDesktop` 是两个能力，不能互相替代。
- Windows 单文件 EXE、便携 ZIP、安装器均纳入分发。安装器入口只表示“打开安装程序”，不表示安装完成。
- 网站是可选分享和管理入口；作者不必离开宿主完成登录、上传、发布和撤下。

### 1.2 对旧文档的明确修订

1. 18/19 中“原生侧栏未通过时不弹独立窗口”的旧产品限制，不再适用于普通 EXE。普通 EXE 的独立窗口入口按 26/27/本文实施；“只在侧栏呈现”的认证标准继续保留。
2. 17 的旧阶段名仅作为历史验收编号。当前执行阶段统一为：`M1 Web 真闭环 → M2 Windows 分发与本机库 → M3 VS Code/Cursor → M4 试运行运营`。
3. `nativeSidebarPlayable` 不再作为 M1—M4 的阻塞项；Windows 扫描与分发仍是完整免费首版的阻塞项。
4. 现有 M0 JSON、环回 API、固定测试端口和本地文件卡片不得迁移成生产数据模型；仅抽取已验证的纯逻辑与宿主边界。

### 1.3 D0 完成判定

以下内容已经在 27 和本文固定：页面与组件、服务模块、数据迁移序列、HTTP 与状态契约、HostAdapter 边界、部署拓扑、里程碑依赖、风险和证据门槛。实施中若改变信任边界、发布一致性、对象身份、扫描门禁或本机执行能力，必须新增 ADR；普通字段命名与样式微调不需要 ADR。

## 2. 前端实施设计

### 2.1 路由与页面组合

| 路由 | 页面容器 | 核心组件 | 数据依赖 | 权限 |
| --- | --- | --- | --- | --- |
| `/discover` | `DiscoverPage` | `SearchBar`、`FilterChips`、`WorkGrid`、`WorkCard`、`CursorPager` | 公开作品列表 | 匿名 |
| `/works/:workId` | `WorkDetailPage` | `WorkHero`、`TargetActions`、`CompatibilityFacts`、`ReportDialog` | 作品详情、各目标当前版本 | 匿名 |
| `/play/:workId/:releaseId?` | `PlayerPage` | `PlayerShell`、`GameFrame`、`PlayerToolbar`、`PlayerError` | launch descriptor | 匿名 |
| `/library` | `LocalLibraryPage` | `RecentWorkList`、`DownloadedWorkList` | 宿主本地库 | 匿名 |
| `/downloads` | `DownloadsPage` | `DownloadQueue`、`DownloadRow`、`DestinationBadge`、`LaunchAction` | HostAdapter 下载状态 | 匿名 |
| `/account` | `AccountPage` | `EmailChallengeForm`、`VerifyCodeForm`、`DeviceGrantList` | 认证 API、宿主凭据 | 匿名/用户 |
| `/settings` | `SettingsPage` | `AppearanceSettings`、`StorageSettings`、`DiagnosticsPanel` | 本地配置、capabilities | 匿名 |
| `/creator` | `CreatorWorksPage` | `CreatorWorkTable`、`TargetStatusCell`、`UploadStatusCell` | 作者作品、上传任务 | 作者 |
| `/creator/works/new` | `WorkEditorPage` | `WorkForm`、`CoverPicker`、`TagPicker` | 创建作品 | 可发布作者 |
| `/creator/works/:workId/edit` | `WorkEditorPage` | 同上、`RevisionConflictDialog` | 作品详情、Work ETag | 所有者 |
| `/creator/works/:workId/upload` | `UploadPage` | `PackageTypePicker`、`FilePicker`、`UploadIntent`、`UploadTimeline` | 上传任务、Target ETag | 所有者 |
| `/admin/reviews` | `ReviewQueuePage` | `ReviewTable`、`ScanSummary`、`ModerationAction` | 复核任务 | 管理员 |
| `/admin/reports` | `ReportsPage` | `ReportTable`、`ReportResolution` | 举报 | 管理员 |
| `/admin/audit` | `AuditPage` | `AuditFilters`、`AuditTable` | 审计 | 管理员 |

路由守卫只改善体验，服务端仍逐请求授权。匿名访问作者路由跳账号页；已登录但没有 `canPublish` 显示邀请状态，不伪装成网络错误。管理员页面不出现在普通用户导航中。

### 2.2 应用壳与响应式布局

`PlatformShell` 由 `HostSurfaceHeader`、`PrimaryNav`、`RouteOutlet`、`TaskCenter`、`GlobalNoticeRegion` 组成。320—479 px 使用单列和底部/短标签导航；480—767 px 可用双列卡片；768 px 以上可使用主从布局。游戏进入播放页后隐藏非必要导航，保留明确返回与退出。

所有页面必须实现 `loading / empty / ready / retryable-error / terminal-error / forbidden` 六种通用视图。作品详情另有 `withdrawn`，上传另有 `expired/review_required`，下载另有 `paused/cancelled/hash_mismatch`。全局错误边界只处理意外渲染错误，不能吞掉领域错误码。

### 2.3 主题跟随与游戏平台视觉

主题是宿主能力，不由用户重复配置一套彼此冲突的颜色。客户端启动时读取 Agent/宿主当前的 `light / dark / high-contrast` 主题，并监听主题变化；切换时即时更新，不刷新页面、不重建上传或下载任务、不重启正在玩的游戏。浏览器回退入口才使用 `prefers-color-scheme`，并允许用户在设置中选择“跟随系统/浅色/深色”。

`HostAdapter` 增加只读主题接口：

```typescript
type HostThemeV1 = {
  mode: 'light' | 'dark' | 'high-contrast';
  colors?: {
    background?: string;
    foreground?: string;
    mutedForeground?: string;
    border?: string;
    focusRing?: string;
    accent?: string;
    danger?: string;
  };
};

interface HostThemeAdapterV1 {
  getTheme(): Promise<HostThemeV1>;
  onThemeChanged(listener: (theme: HostThemeV1) => void): () => void;
}
```

宿主提供的颜色先映射为语义 token，不允许页面直接读取宿主私有 CSS 类。核心 token 至少包括：`surface.canvas / surface.panel / surface.raised / text.primary / text.secondary / border.default / action.primary / action.hover / status.success / status.warning / status.danger / focus.ring / game.glow`。缺失颜色使用我们自己的浅色、深色和高对比度安全默认值；对比度不合格的宿主强调色不得直接用于正文或唯一状态提示。

游戏平台的感觉通过以下视觉语言建立，而不是堆叠霓虹和动画：

- 作品封面、运行目标徽章、最近游玩和下载状态是主要视觉内容；卡片具有清楚的封面区、标题区、兼容信息和唯一主操作。
- 使用适度圆角、分层面板、轻量高光和一处品牌强调色；深色主题可有克制的游戏氛围光，但正文区域保持稳定纯色和足够对比度。
- 大厅更有探索感，作者中心、上传、下载和管理页面更像清晰工具界面；同一组件体系下允许信息密度不同。
- 动画只用于页面过渡、卡片反馈、上传/下载进度和发布成功；遵守 `prefers-reduced-motion`，不使用持续闪烁、背景粒子或影响编辑器性能的循环特效。
- 图标与文案同时出现于关键操作；发布、撤下、删除、启动安装器等不能只靠图标或颜色表达。
- 空状态友好且给出下一步；错误说明“发生了什么、是否可重试、用户现在能做什么”，避免内部术语和责备式文案。

核心页面的视觉重心：大厅是封面与发现，详情是作品信息与准确行动，播放器是游戏画面，上传页是阶段进度，下载页是设备与文件状态，作者中心是目标版本与异常处理。任何装饰不得挤占 320 px 侧栏中的主操作和状态说明。

### 2.4 前端包边界

```text
packages/platform-client/src/
  app/              # 路由、会话门禁、主题、i18n、错误边界
  pages/            # 上述页面容器，只编排 use-case
  features/auth/    # 邮箱登录、设备授权与退出
  features/catalog/ # 搜索、详情、举报
  features/creator/ # 作品表单、上传、发布与撤下
  features/downloads/
  features/admin/
  components/       # 无领域副作用的复用视图
  state/            # query cache key、临时表单和任务投影
packages/platform-api-client/ # HTTP、ETag、幂等、错误映射
packages/host-contract/       # HostAdapter 类型及消息 Schema
packages/transfer-core/       # 传输状态机、摘要、续传判定
packages/player-core/         # iframe 生命周期与 SDK 端口
packages/local-library/       # 下载与最近使用记录接口
```

服务端数据缓存使用明确的 query key：`work-list(filter,cursor)`、`work(workId)`、`creator-works(actor,cursor)`、`upload(uploadId)`。写操作成功后精确失效；不靠刷新整个页面纠正状态。上传字节进度来自可信传输层，处理进度来自服务端任务；两者分开展示。

### 2.5 HostAdapter v1

```typescript
interface HostCapabilitiesV1 {
  protocolVersion: 1;
  host: 'harness' | 'vscode' | 'cursor' | 'browser';
  hostVersion: string;
  surface: 'sidebar' | 'editor-panel' | 'embedded-browser';
  uiDevice: string;
  fileDevice: 'ui-device' | 'host-device' | 'browser-managed';
  runDevice: 'ui-device' | 'host-device' | 'none';
  canSelectFile: boolean;
  canManageDownloads: boolean;
  canRevealDownload: boolean;
  canPersistCredential: boolean;
  canPlayWeb: boolean;
  canLaunchDesktop: boolean;
  canPlayNativeInPanel: boolean;
  unavailableReasons: Record<string, string>;
}
```

业务方法分为 `account`、`files`、`uploads`、`downloads`、`desktop`、`player`、`diagnostics` 七个命名空间。`desktop.launch(downloadId, requestId)` 只接受平台本地库 ID；严禁路径、命令行、URL、shell、环境覆盖或任意参数。`downloads.remove` 必须区分 `record-only` 与 `managed-file`，导出到用户位置的文件不自动删除。

主题能力由 `theme.getTheme/onThemeChanged` 提供，独立于上述业务命名空间；主题事件只能改变视觉 token，不能携带命令、凭据或游戏消息。

## 3. 后端模块与依赖方向

### 3.1 模块化单体

```text
apps/api/src/
  bootstrap/        # 配置、日志、Fastify、关闭流程
  shared/           # DB transaction、clock、ids、errors、auth context
  auth/             # challenge、verify、refresh、logout、me
  catalog/          # discover、detail、launch/download descriptions
  creator/          # works、targets、uploads、publication intents
  media/            # 封面上传与处理状态
  reports/          # 匿名举报
  moderation/       # review、suspend、approve/reject
  internal/         # runtime/download state only
  operations/       # health、ready、metrics hooks
apps/validator-worker/src/
  queue/            # claim、renew、complete、retry
  validators/       # web ZIP/manifest/PE/portable ZIP coordination
  scanners/         # Windows scanner adapter
  publication/      # immutable assets and pointer switch
  media/            # image decode/re-encode
  gc/               # orphan, expired upload, retired release cleanup
```

依赖只允许 `route → application use-case → domain policy → repository/adapter`。Catalog 不直接修改发布状态；Uploads 不直接公开资产；scanner 结果不能绕过 Publication。worker 与 API 共用 contracts/domain policy，但不互相 import 启动模块。

### 3.2 固定端口（代码接口，不是网络端口）

- `ObjectStore`: quarantine put/head/delete，runtime put/get manifest，download artifact put/head。
- `MailSender`: 只接模板 ID、收件地址和短期验证码；实现不得写日志正文。
- `ParserRunner`: 固定镜像、输入对象与任务目录，不接受任意命令。
- `WindowsScanner`: 输入受限对象授权，输出绑定 artifact hash、引擎和规则版本。
- `AuditWriter`: 事务内追加受限摘要。
- `Clock/IdGenerator/TokenHasher`: 测试可替换，生产实现集中。

## 4. 数据库迁移清单

迁移文件使用只增序号的 SQL，例如 `0001_schema_migrations.sql`。每次迁移在事务中执行；需要并发建索引或长回填时拆成显式运维步骤。迁移角色与运行角色分离。

| 迁移 | 内容 | 关键约束/索引 |
| --- | --- | --- |
| `0001` | `schema_migrations`、扩展和公共类型 | 锁定需要的 PostgreSQL 扩展；不默认启用危险扩展 |
| `0002` | `users`、`auth_identities` | `(provider,subject)` unique；status/role CHECK |
| `0003` | `email_challenges`、`device_grants`、`access_tokens`、`refresh_tokens` | token hash unique；refresh family/generation unique；到期索引 |
| `0004` | `creator_usage`、`works` | 非负配额；标题/简介限制；作者列表索引 |
| `0005` | `work_targets`、`releases`（先不加 current FK） | target PK；release `(work_id,target_key,id)` unique |
| `0006` | `work_targets.current_release_id` 复合 FK | `(work_id,target_key,current_release_id)` → release；可空、restricted delete |
| `0007` | `upload_jobs`、`upload_grants` | object key unique；owner/state、expires_at 索引；状态 CHECK |
| `0008` | `jobs`、`idempotency_keys` | `(kind,target_id)` unique；ready/lease 索引；幂等到期索引 |
| `0009` | `assets`、`download_artifacts` | `(release_id,path)` PK；object key unique；字节非负 |
| `0010` | `scan_reports`、`runtime_compatibility` | hash/engine/time 索引；报告追加，不原地伪造历史 |
| `0011` | `media_assets`，再给 `works.cover_asset_id` 加 FK | 只允许已处理封面被公开引用，由事务保证用途/owner |
| `0012` | `tags`、`work_tags` | slug unique；复合 PK；应用层+事务限制每作标签数 |
| `0013` | `reports`、`audit_logs` | open report 索引；audit actor/target/time 索引 |
| `0014` | 公开目录部分索引与英文搜索索引 | published/public 条件；稳定键集分页 |
| `0015` | 可选 `auth_sessions/oauth_attempts` | 仅启用网站登录模块时部署 |

首个迁移测试必须覆盖：空库升级到最新、每个中间版本升级到最新、重复运行无副作用、旧应用在扩展阶段仍可启动、回滚应用不读取尚未完成回填的新字段。生产禁止自动 seed 管理员。

### 4.1 关系和删除策略

- 用户、作品、release、上传任务均以逻辑状态停用；有资产引用的实体不级联物理删除。
- `upload_jobs → releases` 是最多一对一，重试同一任务保持同一 release。
- `work_targets.current_release_id` 只能指向同 Work/Target；数据库防止跨目标，事务检查 ready/enabled/scan 条件。
- `assets` 仅用于 Web release；`download_artifacts` 仅用于 Windows release。应用层和约束触发的测试必须证明不会同时冒充两种分发形态。
- `scan_reports` 与 `runtime_compatibility` 是不同证据。clean 扫描不产生侧栏兼容结论。

## 5. HTTP 契约与状态机

### 5.1 外部 API 矩阵

| 方法与路径 | 身份 | 幂等/并发 | 结果要点 |
| --- | --- | --- | --- |
| `POST /v1/auth/email/challenges` | 匿名 | challenge 单次规则、限流 | 不泄露账号是否存在 |
| `POST /v1/auth/email/verify` | 匿名 challenge | 事务消费 | no-store，凭据仅交可信宿主 |
| `POST /v1/auth/refresh` | refresh token | 行锁轮换/重放撤族 | 新 token 对；旧 token 作废 |
| `POST /v1/auth/device/logout` | 设备授权 | 业务幂等 | 撤销 grant/token family |
| `GET /v1/me` | 可匿名 | 无 | profile、scopes、canPublish |
| `GET /v1/works` | 匿名 | 签名游标 | 仅公开且至少一目标可用 |
| `GET /v1/works/:workId` | 匿名 | ETag 可缓存元数据 | targets 与准确能力 |
| `GET /v1/works/:workId/launch` | 匿名 | no-store | 仅 Web，返回固定 release/origin/policy |
| `POST /v1/reports` | 匿名 | 限流、Idempotency-Key | 不改变发布状态 |
| `GET /v1/creator/works` | 作者 | 游标 | 自己的作品与目标摘要 |
| `POST /v1/creator/works` | 可发布作者 | Idempotency-Key | 新草稿、Work ETag |
| `PATCH /v1/creator/works/:workId` | 所有者 | Idempotency-Key + Work If-Match | 新 Work ETag |
| `POST /v1/creator/works/:workId/uploads` | 所有者 | Idempotency-Key | 预留配额与 publish generation |
| `POST /v1/creator/uploads/:uploadId/grant` | 所有者 | 单次秘密响应 | 限该任务 body PUT |
| `PUT /v1/creator/uploads/:uploadId/content` | grant/可信 Host | 状态+hash 去重 | 流式接收，不走普通幂等缓存 |
| `POST /v1/creator/uploads/:uploadId/complete` | 所有者 | Idempotency-Key | 入队并返回任务状态 |
| `GET /v1/creator/uploads/:uploadId` | 所有者 | 无 | 字节与处理阶段分开 |
| `POST /v1/creator/works/:workId/targets/:target/publish` | 所有者 | Idempotency-Key + Target If-Match | 指定 ready release |
| `POST .../:target/withdraw` | 所有者 | 同上 | 单目标撤下、递增意图 |
| `POST /v1/creator/works/:workId/withdraw` | 所有者 | Idempotency-Key + Work If-Match | 全目标撤下 |
| `GET /v1/works/:workId/releases/:releaseId/download-info` | 匿名 | no-store | 不透明下载 URL、hash、大小、能力 |
| `GET/HEAD /v1/works/:workId/releases/:releaseId/download` | 匿名 | Range/If-Range | 每次请求先过门禁 |

管理 API 统一位于 `/v1/admin`，必须 admin、最近认证和审计；至少含 review list/detail、approve/reject、suspend/resume user/work/release、report resolve。内部状态 API 位于 `/internal/v1`，只接受独立服务身份，浏览器 CORS 永不开放。

### 5.2 服务端状态

```text
UploadJob:
created -> receiving -> uploaded -> queued -> validating
validating -> succeeded | failed | review_required
validating -> scanning -> succeeded | failed | review_required   (Windows)
created/receiving -> expired | failed

Release.validation:
processing -> scanning? -> ready | failed | review_required

Release.serving:
disabled -> enabled -> revoked
revoked -> enabled 仅允许新的显式管理/作者发布事务且策略仍满足

WorkTarget:
draft -> published -> withdrawn
draft/published/withdrawn -> suspended (admin)
suspended 不由后台任务自行恢复

PublicationOutcome:
pending -> published | draft | skipped_newer_intent | blocked
```

服务端枚举是 contracts 的单一来源。数据库 CHECK、OpenAPI、客户端展示映射和测试均从该来源同步；未知新状态在旧客户端显示“需要升级”，不能默认当成功。

### 5.3 本机传输与播放器状态

```text
Download:
queued -> downloading <-> paused -> verifying -> completed
queued/downloading/verifying -> cancelled | failed
completed + external modification -> failed(hash_mismatch)

Desktop launch:
not_prepared -> prepared -> launch_requested -> process_created -> entry_exited
任何校验失败 -> blocked；重启后绝不自动进入 launch_requested

PlayerCore:
idle -> loading -> running -> hidden -> running
loading/running/hidden -> error | disposed
disposed 为终态；每次重开创建新 launchId 和 MessageChannel
```

## 6. 上传、发布、下载和启动的端到端责任

### 6.1 Web 发布

1. Creator 事务锁配额和 WorkTarget，创建 UploadJob、预留容量、记录发布意图。
2. API 流式写 quarantine，实际计数与 SHA-256；断流不产生 uploaded。
3. complete 幂等入队；worker 租约领取。
4. 无网络解析容器检查 ZIP、manifest、路径和资产；协调层复核报告。
5. 写不可变 attempt 前缀、清单与完成标记。
6. Publication 事务核对租约、generation、状态、配额、完整性，切目标指针并审计。
7. runtime-edge 每个 GET/HEAD/Range 先查新鲜状态，再按清单取对象。

### 6.2 Windows 分发

步骤 1—3 同上；之后做 PE/ZIP 结构检查，独立 scanner 对最终分发字节出绑定 hash 的报告。只有策略允许的报告才能创建/启用 DownloadArtifact。扫描不可用、覆盖不足或结果超时均 fail closed，不以 mock clean 发布。

### 6.3 玩家本机

HostAdapter 读取 download-info，固定平台域，写随机 `.part`，严格校验 Range/ETag/Content-Range，整包 hash 通过后原子提交。普通 EXE 的启动必须是新的用户点击；再次核对本地 hash 和线上允许状态，再用 `shell:false`、受限环境、无参数启动。网络状态未知时不从平台新启动；用户自行打开已有文件不在平台控制范围内。

## 7. 开发与部署拓扑

### 7.1 本地开发

```text
Caddy/dev proxy
  -> API process
  -> Web dev/static app
API + worker -> PostgreSQL 16
API + worker -> S3-compatible private object store
API -> test mail inbox
worker -> fixed rootless parser container
Windows scanner -> explicit fake only in unit tests; integration profile must state unavailable until real probe exists
Harness adapter -> local trusted Host service + shared client
```

提供单一启动说明，但不要让测试扫描替身进入生产配置。开发环境可完成真实 PostgreSQL、真实对象流与 Web 发布闭环；Windows 正式放行必须等真实扫描资源。

### 7.2 试运行

- 海外业务机：Caddy、API、PostgreSQL、协调 worker、定时备份/GC。
- Cloudflare：私有 R2 quarantine/runtime/download/backup 职责分离，Worker 提供 runtime/download 门禁。
- 独立 Windows 扫描资源：受限输入授权，无生产 DB 凭据，不默认执行作者程序。
- 邮件供应商：生产域、配额、退信与滥用监控。
- 宿主设备：插件凭据、下载库、EXE 启动器；不把此能力部署到云端后称为本机能力。

部署顺序为备份 → 向后兼容 migration → API/worker → edge policy → web → 插件。回滚前确认 schema 向后兼容；撤下和禁用门禁优先于资产清理。

## 8. 实施工作包与依赖

### M1：Harness + Web 真闭环

| 工作包 | 交付 | 前置 |
| --- | --- | --- |
| M1.1 workspace/contracts | pnpm workspace、Schema、OpenAPI、错误枚举 | D0 |
| M1.2 database/auth | 0001—0008、邮箱设备授权、权限测试 | M1.1 |
| M1.3 creator/upload | works/targets/uploads、配额、幂等、ETag | M1.2 |
| M1.4 validator/publication | Web ZIP、任务租约、不可变发布 | M1.3 |
| M1.5 runtime-edge | 独立 origin、清单、门禁、安全头 | M1.4 |
| M1.6 shared client | discover/detail/account/creator/upload/player | M1.1—M1.5 |
| M1.7 Harness adapter | 官方 bundle、凭据、文件流、生命周期 | M1.6 |
| M1.8 E2E evidence | 作者 A 发布、匿名 B 游玩、更新/撤下 | 全部 |

M1 完成定义：不是“页面出现”，而是两个独立客户端上下文、真实 PostgreSQL 与对象存储完成上传—发布—发现—运行；并通过逆序任务、失败更新保旧版、撤下门禁和恶意 ZIP 样本。

### M2：Windows 分发与独立启动

完成 0009—0010、三种包、真实扫描适配、下载网关、Range、本机库、单 EXE 启动、便携包受限解包与安装器明确入口。没有真实扫描时可以开发但不能将 Windows 投稿/公开分发标为完成。

### M3：VS Code/Cursor

同一 contracts/client 接各自 HostAdapter；分别记录版本、安装、登录、上传、播放器、下载、启动和右侧布局。Remote/WSL/Agents Window 默认 unsupported，直到独立证据完成。

### M4：运营试运行

完成管理员、举报、媒体、标签、备份恢复、资源限制、故障注入、制品/SBOM/摘要、邀请作者运行手册。购买资源、公开部署、域名/邮件/商店发布需用户另行授权和凭据。

## 9. 风险登记与停止条件

| 风险 | 当前结论 | 缓解/停止条件 |
| --- | --- | --- |
| Harness 私有/变化接口 | 0.0.12 原型可用，不等于长期兼容 | 绑定具体 commit；安装回归失败则缩小支持矩阵，不改宿主源码 |
| 共享 React 冲突 | Harness 必须使用宿主 React | 构建期 external + 单例测试；出现双实例立即停止发包 |
| Web 独立域嵌入差异 | 三宿主祖先链未完整验收 | 每宿主真实测试；不得为通过而开放平台账号域 |
| Windows 扫描覆盖/许可 | 尚未选定生产引擎 | 选型探针和许可确认前 Windows 公开投稿保持关闭 |
| 本机 JSON 多进程写 | M0 记录不满足产品语义 | 单写者+锁+原子替换；做不到则 ADR 选 SQLite |
| 远程宿主设备混淆 | 可能在远端保存/运行 | capability 明示 file/run device；无法确定时隐藏启动 |
| 大文件带宽和磁盘 | 旧预算不含 Windows | 配额、并发、成本告警；低磁盘暂停新任务 |
| 任意 EXE 风险 | 扫描不是沙箱 | 用户点击、hash、发布状态、系统防护；不宣传绝对安全 |
| 发布竞态 | 晚完成任务可能覆盖新版 | generation + lease token + transaction；竞态测试不通过不得上线 |
| 撤下缓存 | 已加载/已下载无法召回 | 新请求 60 秒目标；文案不承诺远程删除用户副本 |

## 10. D0 验收清单

- [x] 产品范围、角色、宿主、Web/Windows 体验已固定。
- [x] 页面、路由、组件与响应式状态已定义。
- [x] 跟随 Agent/宿主实时切换浅色、深色、高对比度主题的契约已定义。
- [x] 游戏平台视觉语言、功能清晰度、友好文案和低动效原则已定义。
- [x] HostAdapter 与游戏消息通道已分离。
- [x] 后端模块和依赖方向已定义。
- [x] 数据表、迁移顺序、关系、索引和删除策略已定义。
- [x] API 身份、幂等、ETag、Range 和内部门禁已定义。
- [x] 服务端、下载、启动、播放器状态机已定义。
- [x] Web/Windows 的上传、发布、分发责任已定义。
- [x] 本地与试运行部署拓扑、发布顺序和回滚边界已定义。
- [x] M1—M4 依赖、Definition of Done、风险和停止条件已定义。
- [x] 已有实现、用户反馈、自动测试与待实现平台能力保持分离。

下一步直接进入 M1.1/M1.2：建立工作区与 contracts，再实现数据库迁移和认证骨架；保留现有 0.0.12 回归入口，不大规模重写或删除 M0。
