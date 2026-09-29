# M1.9 真实 API 端到端联调

日期：2026-09-25

## 阶段结论

M1 的 Web 主链路已经在本机真实 PostgreSQL、平台 API、校验 Worker、Runtime Edge 与 DeepSeek Harness 右栏之间贯通，不再依赖前端 demo 数据：匿名玩家可浏览公开作品；作者可使用邮箱验证码登录、创建作品、上传 Web ZIP；合格包经后台校验后生成不可变 Release 并自动发布；匿名玩家可在 Harness 右栏启动该 Release。

本轮真实验收作品为“侧栏星轨”。最终页面同时显示：

- `正在运行`；
- `独立模块已加载 · JSON 资源已加载 · WASM 已编译`；
- `隔离检查通过：无法读取宿主页和本地存储`。

因此本阶段完成的是本机开发环境中的真实业务闭环，不是生产部署完成声明。

## 实施内容

### API 与开发联调入口

- 增加显式 CORS 白名单与预检响应，不使用任意来源通配；作者集合保持 Bearer 鉴权。
- 增加 `GET /v1/creator/works`，让创作中心读取服务端作品和目标状态。
- Windows 浏览器上传 ZIP 时可能发送 `application/x-zip-compressed`，服务端在既有 ZIP 校验不变的前提下接受该 MIME。
- 增加仅供回环开发使用的 `npm run e2e:start`：应用 10 个 migration，启动 3090 API、3092 Runtime Edge、校验 Worker和本地文件收件箱。
- 本地联调种子作者只在该开发入口中获得发布权限；验证码不写入服务日志，不调用外部邮件服务。

### 客户端与恢复能力

- 账号成功页可直接进入创作中心；创作中心、新建作品和上传页改为调用真实 API。
- 上传页可恢复 `created`、`receiving`、`uploaded`、`queued`、`validating` 与终态任务，并在需要时明确要求重新选择本机文件。
- API 客户端在受保护请求返回 401 时使用内存 refresh token 刷新一次并重放原请求；不把凭据写入 URL、localStorage 或日志。
- Harness 在自身运行于回环地址时使用本地 API；生产来源不自动降级到回环服务。
- PlayerCore 接受明确开启的 `*.localhost` 开发 Release 主机，生产仍要求 HTTPS 和受信任 Release 子域。

### 隔离修正

真实游玩发现 iframe 与 Runtime CSP 曾同时包含 `allow-same-origin`。游戏虽然能运行，但自检可访问自身持久化存储，不符合平台的 opaque-origin 目标。本轮从两层 sandbox 中移除该权限，只保留脚本与作品声明所需的指针锁；资源以无凭据 CORS 读取。最终自检确认无法读取宿主页和本地存储。

## 真实联调中发现并修复的问题

| 问题 | 结果 |
| --- | --- |
| Windows ZIP MIME 返回 415 | 接受常见 ZIP MIME，内容仍进入同一摘要和结构校验链路 |
| 过期的 `created` 上传长期占用活动名额与预留额度 | 在读取、授权和新建前事务性过期并释放占用 |
| 文件选择耗时超过 access token 生命周期后上传失败 | refresh token 自动轮换并仅重试一次原请求 |
| 本地 Release 子域被生产主机规则拒绝 | 仅在显式开发选项下允许 `localhost` / `*.localhost` |
| 运行 iframe 仍有 same-origin 权限 | iframe 属性和 HTTP CSP 双层移除，真实样本隔离自检通过 |

## 验收证据

- PostgreSQL：项目专用 `postgres:16.10-alpine`，10 个 migration。
- Harness：`0.1.7-alpha.1`，隔离 `gamehub-m0` profile，本机 3081。
- 插件：`artifacts/gamehub-harness-plugin-0.0.22.tgz`，20 个文件，74.9 kB；SHA-256 `CE0559AD833DB0E9BCEE4278DD675344BDACA02F818F74FA7C3FFC9306598FEC`，npm shasum `6d6593e1c8df38c0d82cb5b79227bb32bdd588c5`。
- 完整自动测试：73 项历史测试、21 项平台测试（包含隔离 PostgreSQL 集成测试）、14 项客户端测试，共 108 项，全部通过。
- `npm run contracts:check` 通过，OpenAPI 与生成类型一致。
- `npm run web:build` 通过，Vite 生产构建成功。
- GUI：匿名目录 → 作品详情 → 启动描述 → Release 子域 → 右栏 iframe 的真实路径通过；模块、JSON、SVG 与 WASM 均由 Runtime Edge 返回。

## 复现

先启动项目 PostgreSQL：

```powershell
docker compose -f deploy/compose.dev.yml up -d postgres
npm run e2e:start
```

另一个终端打包并启动隔离 Harness profile：

```powershell
npm run pack:harness
npm run start:harness-m0
```

开发收件箱位于 `.runtime/platform/dev-mailbox.json`，只用于回环联调。测试结束后在两个前台终端按 Ctrl+C；数据库容器可按项目需要保留。

## 尚未覆盖的生产边界

- 没有接入真实邮件供应商、生产密钥管理、限流网关或滥用处置。
- 没有验收生产 DNS/TLS、私有对象存储、CDN 缓存失效、备份恢复和多实例一致性。
- ZIP 校验子进程仍不是生产 rootless 容器或恶意代码扫描沙箱。
- 本轮只验收 Harness Web 宿主；VS Code、Cursor 与 Harness 桌面发行版需要分别安装验收。
- Windows 包上传、扫描、下载和独立窗口路线未纳入这次 Web ZIP 闭环复验。

下一阶段应优先把本机对象存储与校验进程替换成可部署的私有对象存储、隔离 Worker 和真实邮件适配器，再执行生产形态 staging 验收。
