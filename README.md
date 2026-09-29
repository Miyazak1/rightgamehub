# Agent 游戏平台可行性验证

本项目已经具备单机邀请内测部署基线；仍不是可直接开放匿名投稿的公测生产平台。

2026-09-29：P1.0 单机邀请部署已落地：Docker Compose、PostgreSQL 迁移门禁、API/Worker/Runtime 分进程、Caddy 自动 HTTPS 与通配符运行域、Resend 验证码、邮箱邀请白名单、持久卷备份和管理员提升工具均已提供。生产镜像和真实容器烟雾测试已通过；域名、Cloudflare、邮件密钥及 Linux 服务器配置见 [P1.0 单机部署手册](docs/47-p10-single-host-deployment.zh-CN.md)。开放不受信作者投稿前，仍需补 rootless 二级执行隔离。

2026-09-29：P0.1 邀请内测闭环已完成，P0.2 已加入头像真实解码/重编码、静态降级图、内容寻址存储、设备会话管理与 Harness 系统凭据库适配；P0.3 已贯通作者版本历史、整件作品撤下、安全封面，以及举报、管理员处置和只追加审计记录。账号级收藏、最近游玩、官方“猜百科”真实目录、服务端中国日期每日题与完成成绩已经贯通；Harness 0.0.51、数据库迁移 20/20，状态与后续阻塞项见 [38 P0 邀请内测闭环](docs/38-p0-invite-loop.zh-CN.md)。

2026-09-25：M1.9 已完成真实 API 端到端联调。真实 PostgreSQL、邮箱登录、作者作品创建、Web ZIP 上传校验发布、匿名目录及 Harness 右栏游玩全部贯通；0.0.22 插件的最终样本确认模块、JSON、图片和 WASM 已加载，opaque-origin 隔离自检通过。108 项自动测试全部通过，证据与生产边界见 [37 M1.9 真实 API 端到端联调](docs/37-m1-real-api-e2e.zh-CN.md)。

2026-09-24：Harness 插件 **0.0.12** 增加普通 GUI EXE 的“下载到本机 → 启动（独立窗口）”，**73 项自动测试通过，用户随后确认选对版本后启动成功**。用户反馈与原自动测试分开记录，详见 [EXE 平台启动说明](docs/26-desktop-exe-launch.zh-CN.md)。0.0.11 的适配包上传下载及校验已实现，新包真实渲染仍待验收，见 [25](docs/25-offscreen-package-contract.zh-CN.md)；0.0.10 固定样本右栏已有[实测证据](docs/24-harness-offscreen-integration.zh-CN.md)。云端发布与 VS Code/Cursor 完整客户端仍待开发。

完整平台的产品与总体架构见 [27 完整平台设计与任务交接](docs/27-platform-design-and-handoff.zh-CN.md)，可直接开工的组件、迁移、接口、状态机与工作包见 [28 D0 实施蓝图](docs/28-platform-d0-implementation-blueprint.zh-CN.md)。D0 已定稿，M1 正在实施，完整生产平台尚未完成。

M1 已开始执行：首个增量建立 pnpm workspace、共享 contracts/OpenAPI 和 PostgreSQL `0001`—`0008` migration，状态与未完成边界见 [29 M1 执行状态](docs/29-m1-execution-status.zh-CN.md)。

M1.2 已完成 API/数据库基础：Fastify health/ready、migration runner、邮箱 challenge 与设备授权已通过真实 PostgreSQL 集成测试，证据与边界见 [30 M1.2 API 与数据库基础](docs/30-m1-api-database-foundation.zh-CN.md)。

M1.3 已完成 refresh/Bearer/logout 与首个作者作品写路径；并发幂等创建和 Work ETag 已通过真实 PostgreSQL 验证，见 [31 M1.3 认证与作品写入](docs/31-m1-auth-and-works.zh-CN.md)。

M1.4 已完成多目标上传任务基础：事务配额预留、一次性 upload grant、受限流式 quarantine、大小与 SHA-256 校验、并发 complete 入队和 publish generation 已通过真实 PostgreSQL 验证；73 项既有测试与 18 项平台测试全部通过，见 [32 M1.4 多目标上传任务](docs/32-m1-upload-tasks.zh-CN.md)。

M1.5 已完成本地 Web ZIP 校验与不可变发布闭环：任务租约恢复、独立解析子进程、受限解包、不可变 runtime attempt、Release、配额结算及 generation 防旧任务覆盖已通过真实 PostgreSQL 验证；73 项既有测试与 19 项平台测试全部通过，见 [33 M1.5 Web ZIP 校验与不可变发布](docs/33-m1-web-validator-publication.zh-CN.md)。生产开放投稿前仍须完成 rootless 容器资源隔离验收。

M1.6 已完成本地匿名目录与 Runtime Edge：固定 Release 子域、每请求状态门禁、严格 manifest 路径、GET/HEAD/Range、MIME/CSP/Permissions-Policy、资产篡改检测与撤下 fail-closed 已通过真实 PostgreSQL 验证；73 项既有测试与 20 项平台测试全部通过，见 [34 M1.6 匿名目录与 Runtime Edge](docs/34-m1-runtime-edge-catalog.zh-CN.md)。生产 DNS、TLS、私有对象存储和 CDN 失效仍待部署环境验收。

M1.7 已完成共享 React 客户端：宿主主题与 Agent 强调色实时映射、游戏平台式发现/详情、账号、创作中心、上传时间线和受限 Web Player 已落地；320 px 与 1280 px 本地浏览器验收通过，见 [35 M1.7 共享前端客户端](docs/35-m1-shared-platform-client.zh-CN.md)。默认入口只读取真实 API，`?demo=1` 仅用于明确标记的本地视觉验收。

M1.8 已完成 Harness Adapter：0.0.17 将共享客户端正式打包进 Harness，同时保留独立“本机试验场”；主题跟随宿主、Agent 强调色切换、会话级凭据、真实上传传输进度、任务恢复和插件内存路由均已落地，并通过真实 Harness 侧栏验收，见 [36 M1.8 Harness Adapter](docs/36-m1-harness-adapter.zh-CN.md)。

M1.9 已完成真实服务闭环：共享客户端通过显式 CORS 连接本机平台 API，作者登录、建作、上传、后台校验与发布后，匿名玩家可从目录启动固定 Release 子域；上传过期清理、token 自动刷新、Windows ZIP MIME 与 localhost 开发运行规则已补齐，iframe/CSP 双层 opaque-origin 隔离已在真实 Harness 右栏通过，见 [37 M1.9 真实 API 端到端联调](docs/37-m1-real-api-e2e.zh-CN.md)。

**当前采用两种游玩形式：网页/适配包在右栏，普通 EXE 可从平台打开独立窗口。**历史窗口捕获实验没有通过侧栏游玩要求；[start-gamehub-native-test.bat](./start-gamehub-native-test.bat) 仅保留为研究入口。新的普通 EXE 入口不使用该捕获探针。

- [开发启动判断与实测记录](./docs/20-execution-status.zh-CN.md)
- [Harness 测试插件](./extensions/harness/README.md)
- [普通 EXE 平台启动入口](./start-gamehub-desktop-test.bat)：独立端口 3085，上传后点击“下载到本机”，再点“启动（独立窗口）”；下载不会自动运行，退出游戏由用户在其窗口操作。
- [上传适配包的独立验收入口](./start-gamehub-package-test.bat)：端口 3084，生成自有 ZIP 与 0.0.11 插件；在大厅上传 [gamehub-owned-sidebar-1.0.0.zip](./artifacts/gamehub-owned-sidebar-1.0.0.zip)，准备运行缓存后手动开始。不会自动打开浏览器或启动游戏。
- [离屏样本启动文件](./start-gamehub-offscreen-test.bat)：独立 3083 profile，需本地已核验运行时；不自动打开页面或启动游戏。进入右栏后手动点击“开始离屏运行样本”。
- 本机双击 `start-gamehub-m0.bat` 启动独立测试配置，访问输出地址后在右栏选择“GameHub”或历史“本机试验场”。无需配置模型 Key。
- 启动器使用 Harness 本地的 `node_modules/.bin/pnpm`，无需全局安装 pnpm；已验证移除 Codex 工具路径后仍能通过 BAT 启动。
- 修改后执行 `npm run pack:harness`，测试包生成到 `artifacts`；详细边界见实测记录。

- [平台完整方案目录](./docs/README.md)：中国大陆公司、海外首发；包含产品、技术架构、网页 3D、交易结算、接口与实施验收。
- [中文验证报告](./FEASIBILITY.zh-CN.md)
- [双入口实现与验证说明](./DUAL-MODE.zh-CN.md)
- `poc/index.html`：可交互小游戏及游戏库演示
- `poc/server.mjs`：无依赖、本机回环 HTTP 服务
- `extensions/vscode/`：侧栏功能区开发扩展，共用同一游戏界面

```powershell
node .\poc\server.mjs
```

打开 http://127.0.0.1:43187/ 。前台运行时按 Ctrl+C 结束。

构建开发扩展：`npm run build:extension`。运行入口选择测试：`npm test`。

已实现功能区优先、失败回退浏览器和手动浏览器选择。六项入口测试通过；Codex 内置浏览器的实际游玩和刷新恢复通过。VS Code 侧栏扩展已经生成，尚未安装到真实编辑器验收；没有验证 Codex 常驻原生侧栏注册能力。
