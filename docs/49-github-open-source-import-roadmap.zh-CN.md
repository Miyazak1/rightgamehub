# GitHub 开源作品导入与共建路线

状态：可进入 G0/G1 实施评审
更新日期：2026-09-30
适用范围：作者主动授权导入的静态网页游戏、网页 3D 和网页工具

## 1. 决策摘要

GameHub 将 GitHub 作为源码、版本、Issue 和 Pull Request 的事实来源；平台负责把经过作者授权的仓库变成可发现、可体验、可追溯的作品，并把反馈重新连接给原作者。

本路线不建设第二套发布系统。GitHub 来源层只负责仓库授权、元数据、许可证证据、Commit 锁定和隔离构建，构建产物仍进入现有链路：

```text
GitHub App
  -> Source / Import / Build
  -> 标准 Web ZIP
  -> 现有 Upload / Validator / Release
  -> 现有 Runtime Edge / Catalog
```

关键产品决定：

1. 首期只允许仓库所有者或被明确授权的维护者导入并构建。
2. 未认领项目首期最多展示公开资料和 GitHub 跳转，不自动构建、托管或再分发。
3. GitHub 登录与仓库授权分离：现有 OAuth 继续只做身份登录，仓库访问使用独立 GitHub App。
4. 首期只支持自包含静态网页产物；Skill、MCP、API 和长期运行后端使用独立风险模型，后置实施。
5. Builder 与 Validator 分离。Builder 按恶意代码环境设计，其输出仍必须通过现有发布校验。
6. Webhook 只创建任务，不直接改变线上版本；默认需要作者确认发布。

## 2. 与现有平台的关系

### 2.1 已有能力

- 邮箱和 GitHub 身份登录。
- 创作者申请与管理员审批。
- 作品、目标版本、Release 和当前版本指针。
- 一次性上传授权、流式接收、摘要和配额。
- Web ZIP 路径、压缩、大小、入口、MIME 和 manifest 校验。
- 不可变 Release、Runtime Edge、独立运行域和撤下门禁。
- 目录、搜索、标签、作者、收藏、游玩记录和隐私受限分析。
- 举报、管理员处置和追加式审计。
- Docker Compose、PostgreSQL、Redis、Caddy、备份和健康检查。

### 2.2 网页 3D 的真实边界

当前 Web 包策略原生识别 GLB、GLTF、WASM、纹理、字体、音视频和二进制资源；压缩包上限 100 MiB、解压后 300 MiB、单文件 100 MiB、最多 5000 个文件。

首期支持的网页 3D 项目必须满足：

- 构建后存在根入口 `index.html`。
- 运行资源全部进入构建产物并使用相对路径。
- 不依赖平台未批准的外部 API、CDN、Worker、WebSocket 或特殊服务器配置。
- 在当前 CSP、Permissions-Policy、浏览器 WebGL/WebGPU 能力和资源上限内运行。

“使用 Three.js、Babylon.js 或 React Three Fiber”本身不等于兼容；必须以构建产物和运行验收结果为准。

### 2.3 当前缺口

- GitHub App 安装和仓库选择。
- 仓库来源、分支和 Commit 快照。
- README、主题、许可证和默认分支导入。
- Webhook 验签、去重和同步状态机。
- 隔离源码构建服务及构建日志。
- Commit 到 Release 的来源证明。
- 许可证证据和人工复核结论。
- 作者确认、同步策略和自动发布开关。
- Issue 草稿回流和 Remix 来源链。

## 3. 实施阶段

### G0：巩固安全与运维基线

目标：在执行任何第三方源码前，确认现有校验与存储链路能安全承接构建产物。

当前进展：不可信 Web ZIP 的独立无网络校验器、原子信箱、生产 fail-closed 和残留清理已经实现，具体边界与部署方式见 [50 G0 Web ZIP 隔离校验器](./50-g0-isolated-web-validator.zh-CN.md)。应用层 70/85 磁盘阈值门禁、活动上传预留、同盘合并计量、管理员容量面板与隔离区残留清理也已实现，见 [51 G0 存储容量门禁](./51-g0-storage-capacity-guard.zh-CN.md)。备份恢复演练、外部集中告警、Runtime Edge 策略复核和生产等价故障演练仍未完成，因此 G0 尚未整体关闭。

工作项：

- 将 ZIP 解析和校验运行在 rootless、只读根文件系统、无默认出网的短生命周期容器中。
- 设置 CPU、内存、进程数、文件数、临时磁盘和执行时间硬限制。
- 验证异常退出、超时、磁盘满和重复任务不会留下半成品。
- 完成生产备份恢复演练、失败任务清理和磁盘阈值告警。
- 固化 Runtime Edge CSP、Permissions-Policy 和作品 capability 版本。
- 为校验耗时、失败原因、隔离容器异常和存储占用增加指标。

完成条件：恶意 ZIP、压缩炸弹、路径逃逸、超限资源和校验器崩溃均不能影响 API、数据库、宿主文件或其他作品。

### G1：GitHub 资料导入，不执行源码

目标：降低作者填写成本，同时保持与现有手动 Web ZIP 发布完全兼容。

用户流程：

1. 作者使用现有账号登录。
2. 安装 GameHub GitHub App，并仅选择准备导入的仓库。
3. 平台读取仓库名称、描述、默认分支、主题、README 和许可证文件。
4. 平台生成作品草稿和许可证证据。
5. 作者确认标题、介绍、封面、许可证和仓库链接。
6. 作者继续使用现有 Web ZIP 上传、校验和发布。

限制：

- GitHub App 默认只申请 Metadata 和 Contents 只读权限。
- 不保存 GitHub App 私钥到数据库；安装令牌按需生成且不进入日志。
- README 只转换为受限内容，不执行仓库 HTML、脚本或远程嵌入。
- 许可证缺失、冲突或无法识别时，草稿可保存但不能自动公开发布。

完成条件：授权、导入、撤销授权和重新同步均可审计；撤销安装后平台不能继续读取仓库。

### G2：受控静态站自动构建

目标：把固定 Commit 的受支持仓库构建为标准 Web ZIP，并复用现有发布门禁。

首期构建模板：

- 无构建步骤的静态 HTML/CSS/JavaScript。
- 带锁文件的 Vite、React 或 Vue 静态构建。
- 明确声明输出目录的 Three.js、Babylon.js 或 React Three Fiber 项目。

首期不允许作者输入任意 shell 命令。平台根据识别结果展示固定构建方案，由作者确认；不支持的仓库保持手动上传。

Builder 安全要求：

- 每个任务独立临时环境、非 root 用户、只读基础镜像和一次性工作目录。
- 无平台数据库、Redis、对象存储、部署密钥或宿主 Docker Socket。
- 网络只能通过受审计的依赖代理访问允许的包源；禁止访问内网、云元数据和任意目标。
- 默认上限：2 vCPU、2 GiB 内存、5 分钟、1 GiB 临时空间。
- 只接受锁文件和固定 Commit；依赖解析结果、Builder 镜像摘要和构建配置写入来源证明。
- 日志过滤令牌和控制字符，并设置总字节上限。
- 构建产物先生成不可变摘要，再作为内部上传进入现有 Validator。

发布策略：

- `manual`：构建完成后由作者检查并发布，首期默认。
- `auto_after_validation`：作者显式开启后，校验通过才更新当前版本。
- `draft_only`：Webhook 只生成草稿构建，不允许上线。

完成条件：同一 Commit 和构建配置可复现来源记录；失败构建不能产生 Release；旧任务不能覆盖新 Commit 的发布结果。

### G3：作者增长与共建

- README “在线体验”徽章。
- 作者数据面板：曝光、试玩、完成、复访、收藏和构建成功率。
- 结构化反馈转 GitHub Issue 草稿，由用户或作者确认后提交。
- 项目任务、新手贡献入口和贡献者档案。
- Remix 上游作品、仓库、Commit、许可证和修改说明。
- 新作者、小而美、复访和共建信号结合的策展，不以 Star 单一排序。

完成条件：平台生成的 GitHub 内容始终有明确用户确认、来源链接和频率限制，不能形成自动骚扰。

### G4：Skill、MCP 与 API

此阶段不复用 `web_zip` 执行模型。分别定义：

- 清单、版本、输入输出和能力声明。
- 权限授权、撤销和最小作用域。
- 密钥托管、调用审计、速率与费用上限。
- 安装来源、更新策略和供应链证明。
- 远程服务不可用、被撤下或权限变化时的失败策略。

首期目标应是安全展示和安装；是否由平台承担远程执行成本另行评审。

## 4. 数据模型

建议按阶段增加，不修改现有 Release 的不可变语义。

### 4.1 G1 必需表

- `source_connections`：用户、提供方、GitHub App installation ID、账号、状态、授权时间、撤销时间。
- `work_sources`：作品、仓库 node ID、owner/name、默认分支、子目录、同步策略、当前来源状态。
- `source_revisions`：来源、Commit SHA、tree SHA、作者时间、接收时间、同步状态。
- `import_jobs`：触发来源、目标 revision、租约、状态、错误码和完成时间。
- `license_evidence`：revision、许可证文件路径、内容摘要、SPDX 检测值、人工结论和复核人。

### 4.2 G2 必需表

- `build_jobs`：revision、模板版本、Builder 镜像摘要、状态、资源用量、日志引用、产物摘要和 upload/release 关联。
- `source_webhook_deliveries`：delivery ID、事件、签名验证结果、负载摘要、处理状态和幂等结果。
- `release_provenance`：release、revision、build job、配置摘要、依赖锁摘要和产物摘要。

### 4.3 G3 扩展表

- `project_claims`：仅在允许平台策展未认领项目后启用。
- `work_derivations`：派生作品与上游作品、来源 revision、许可证和说明。
- `github_feedback_drafts`：平台反馈、目标仓库、草稿、确认者、提交结果和频率控制。

数据库约束：

- GitHub installation ID、repository node ID 和 webhook delivery ID 使用提供方稳定 ID，不依赖可改名的仓库路径。
- Commit SHA 必须完整保存，不接受分支名作为发布来源证明。
- 来源证明、许可证证据和已提交 webhook 记录采用追加式审计，不允许原地覆盖历史。
- 同一来源 revision、构建模板和配置摘要最多存在一个活动构建任务。

## 5. API 边界

建议新增控制面端点：

```text
POST   /v1/source-connections/github/install
GET    /v1/source-connections
DELETE /v1/source-connections/{connectionId}
GET    /v1/source-connections/{connectionId}/repositories

POST   /v1/works/{workId}/sources
GET    /v1/works/{workId}/source
PATCH  /v1/works/{workId}/source
POST   /v1/works/{workId}/source/sync

GET    /v1/works/{workId}/imports
POST   /v1/works/{workId}/builds
GET    /v1/works/{workId}/builds/{buildId}
POST   /v1/works/{workId}/builds/{buildId}/publish

POST   /v1/webhooks/github
```

要求：

- 所有创建和重试操作支持幂等键。
- 用户只能访问自己拥有且被安装授权覆盖的仓库。
- Webhook 使用原始请求体校验签名，并按 delivery ID 去重。
- 列表接口分页且不返回安装令牌、原始私钥或敏感构建环境。
- 发布接口继续执行现有作者权限、作品版本和校验状态检查。

## 6. 状态机

### 6.1 来源

```text
pending -> active -> suspended -> active
                 \-> revoked
```

### 6.2 导入任务

```text
queued -> running -> succeeded
   |         |------> retry_wait -> queued
   +---------+------> failed
                 \--> cancelled
```

### 6.3 构建任务

```text
queued -> preparing -> building -> packaging -> validating -> ready
   |          |           |            |            |
   +----------+-----------+------------+------------+-> failed
                                                     \-> superseded
```

只有 `ready` 构建可以请求发布；线上 Release 仍以现有发布状态机为事实来源。

## 7. 许可证与作者关系

- 自动识别只产生证据和建议，不等于法律结论或发布授权。
- 导入时保存许可证文件路径、摘要和对应 Commit；作品页保留作者、仓库和许可证入口。
- 仓库无许可证、多个许可证冲突、素材许可证不明或声明禁止再分发时，禁止自动公开发布。
- 首期不复制未授权仓库的构建产物；公开资料展示也必须明确“非官方收录”。
- 作者可以撤销同步、停止自动构建和撤下平台版本；历史审计与其他用户必要的战绩/记录按隐私政策处理。
- Remix 必须保留来源链和适用许可证，不提供“去除署名”的产品选项。

正式公开运营前，平台条款、开源许可证处理和作者认领争议流程需要专业法律复核。

## 8. 可观测性与成本控制

基础指标：

- GitHub API 请求、限流、授权失效和 webhook 验签失败。
- import/build 队列长度、等待时间、耗时、成功率和错误码。
- Builder CPU、内存、临时磁盘、网络字节和强制终止次数。
- 构建产物大小、校验失败原因和自动发布成功率。
- 每作者/仓库的构建分钟、存储和流量。

成本保护：

- 每账号并发构建数和每日构建分钟上限。
- 相同 Commit/配置结果复用，Webhook 突发合并去重。
- 超限仓库保持手动上传，不自动扩大配额。
- 构建日志、临时目录和失败产物设置明确保留期。
- 大型资产建议 Git LFS 或作者 CDN 时，必须先确认当前运行 CSP 和分发成本，不自动放宽外联。

## 9. 测试与验收

### 9.1 单元与契约

- GitHub App 回调 state、安装归属和仓库权限验证。
- Webhook 原始体签名、重放、乱序和重复 delivery。
- 来源、导入、构建和发布状态机非法转换。
- README 清洗、许可证证据、Commit 格式和权限越权。
- API 契约、生成客户端和稳定错误码。

### 9.2 集成

- 安装 GitHub App、选择仓库、生成草稿、撤销安装。
- push 多个 Commit 后只构建最新有效 revision。
- 构建成功进入现有 Validator；构建失败不产生 Release。
- 同一 delivery、幂等键和任务重试不重复发布。
- Builder 无法访问数据库、Redis、云元数据、宿主文件和其他任务。
- 许可证缺失或冲突阻止自动公开发布。

### 9.3 端到端

选择三个受控样本：纯静态网页、Vite 应用、自包含网页 3D。完成：

```text
作者授权仓库
-> 导入作品草稿
-> 锁定 Commit
-> 隔离构建
-> 现有校验
-> 作者确认发布
-> Runtime Edge 真实运行
-> 仓库更新生成新草稿
-> 回滚到旧 Release
```

每个样本验证桌面端、Agent Webview、窄屏、资源 Range、撤下门禁和来源证明。

## 10. 明确不做

- 不抓取并自动构建全 GitHub 公共仓库。
- 不在 API、worker 或现有 Validator 进程内执行仓库构建脚本。
- 不允许用户直接提交任意 Dockerfile、shell 命令或 CI 配置。
- 不让 Webhook 直接覆盖线上版本。
- 不把 GitHub 登录 token 当作仓库长期访问凭据。
- 不把 Skill、MCP、API 或长期后端伪装为普通静态 Web ZIP。
- 不承诺任意 Three.js/WebGPU 项目无需适配即可运行。

## 11. 开工顺序

1. G0 威胁模型、隔离执行器和生产恢复验收。
2. G1 GitHub App 权限说明、数据迁移、状态机和 API 契约。
3. G1 管理/作者 UI 与三个真实仓库的资料导入验收。
4. G2 Builder 设计评审、安全测试和固定模板实现。
5. G2 真实静态项目构建、发布、更新和回滚闭环。
6. G3 作者增长能力；G4 另立安全与产品设计文档。

开始 G2 前必须满足：G0 通过、全量测试绿灯、GitHub App 最小权限通过审查、构建成本上限已配置、生产备份恢复已演练。

## 12. 当前基线

截至 2026-09-30：现有平台全量自动测试、真实 PostgreSQL 多人迁移与事务、契约同步、生产 Compose 配置以及 API/realtime 镜像构建均已通过；多人通用核心已推送到 `main`。GitHub 仓库导入和源码 Builder 尚未实现，本路线文档不将规划描述为已上线能力。
