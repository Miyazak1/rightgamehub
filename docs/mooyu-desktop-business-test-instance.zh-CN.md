# 桌面完整业务的本地隔离实例

本文描述回环模式。新增的 HTTPS 远程隔离模式、游戏测试域、备份与回滚见[远程完整业务测试方案](mooyu-desktop-business-remote.zh-CN.md)；本次仍不部署远程实例。

该实例补齐真实数据库验证，不再用 HTTP 契约夹具代替 PostgreSQL 业务行为。复用现有 createApp、认证、目录、日志、公开主页、游戏库、封面和 Runtime Edge 服务；只组合本阶段需要的服务，不调用正式 server/runtime 入口，不构造模型提供方或后台 worker。

## 隔离边界

- 独立 Compose 项目、PostgreSQL、Redis、资源卷和 internal 网络；业务 API、数据库和 Redis 无出站网络。Docker Desktop 的 internal 网络不能直接向宿主映射端口，因此另有固定上游网关连接内部网络与回环入口桥，只转发到 business-api:3090/3092，不接受任意代理目标，也不持有数据库或模型凭据。
- 数据库身份固定为 business-postgres:5432/desktop_business_test，用户 desktop_business_test；Redis 固定为 business-redis:6379。只接受新的 64 位十六进制随机凭据。
- API 和运行端口只发布到 127.0.0.1，测试 origin 只接受回环 HTTP。不是公网部署方案，不修改 desktop-test.mooyu.fun 或现有账号测试项目。
- 通过全新环境白名单构造通用配置，不继承模型、OAuth、SMTP、OSS 或生产数据库凭据。
- HTTP 边界仅开放浏览业务、测试账号会话、游戏库和最近游玩；发布、上传、管理、模型、研究与后台执行路由在认证及正文解析之前拒绝。
- 本阶段不启用 GitHub 授权。只接受 desktop-reader@example.test 的合成邮件登录；验证码保存到隔离数据卷的 test-mail.json，不向真实邮箱发送。没有公开验证码读取接口，验收进程通过本机 Docker 读取。

## 自有固定内容

离线 seed 初始化一个 can_publish=false 的测试作者、计数游戏、弹簧课件、封面和一篇公开测试日志。数据库中的 published 记录仅表示可读的固定夹具，不通过 HTTP 发布流程创建，也不开放发布权限。不会复制真实用户、文章、密钥或线上数据。

游戏资产由 LocalRuntimeStore 写入 manifest，实际文件复制时复核大小与 SHA-256；Runtime Edge 每次服务资源时再次验证 manifest、文件大小和哈希。seed 校验当前数据库/用户，并记录版本；重复执行保留现有测试内容。

## 执行本地验收

```powershell
node scripts/verify-desktop-clean.mjs
node scripts/verify-desktop-business-instance.mjs --keep
node scripts/verify-desktop-business-database.mjs
node scripts/stop-desktop-business-test.mjs
```

第一步从 HEAD 加候选文件建立独立源码目录，排除未交付的论文与旧 D1 实现。第二步只接受本机 Docker Unix socket/Windows named pipe，构建该源码目录的 API 镜像，创建随机项目和端口，运行全部迁移、seed、业务/鉴权/拒绝路由/运行资源/重启检查。失败清理临时项目；不加 --keep 时成功也清理。使用 --keep 仅供第三步验证真实桌面窗口。最后一步只停止并清理该随机测试项目的容器、网络和测试卷，不影响现有项目。

报告：`.runtime/desktop-business-test/latest.json`；实际 Electron 报告与截图：`.runtime/desktop-business-test/electron-latest.json`。配置文件中的密码与测试登录凭据不上传或贴到聊天。

## 游戏运行边界

内置的 6 个模拟课件由桌面构建按已跟踪模板和模块锁打包，不依赖网页版 public 目录的本机生成产物。桌面入口保留主页面和标题栏，用 `/learn/:courseId` 路由打开固定目录中的课件；课件经专用回环资源入口运行在仅允许脚本的 iframe 内，不授予同源、桌面桥或 Node 权限。其内联启动脚本和模块锁读取策略仅适用于打包课件，主页面和普通游戏的 CSP 不放宽；主页面协议拒绝直接读取课件路径，返回和前进仍由桌面路由处理。

作品详情复用正式 API 的排行榜读取服务：`GET /v1/works/:workId/leaderboards` 对未配置榜单的作品返回 `200` 和空数组，不能用路由不存在的 `404` 代替；选中榜单通过 `GET /v1/works/:workId/leaderboards/:boardId` 读取，未知榜单保留 `COMPETITION_BOARD_NOT_FOUND`。包含猜百科日榜的兼容读取。桌面桥开放固定的 `readCompetitionLeaderboard` 方法，仍校验作品、榜单和查询参数，不开放任意 HTTP。隔离服务不装配比赛写服务或游戏会话授权，成绩提交、管理、发布、模型和后台任务保持关闭。

本地数据库验收同时检查空榜单、临时注册榜单、匿名/登录后的日榜读取，以及匿名和登录后均拒绝成绩写入；临时榜单仅写入新建隔离数据库，随该测试项目清理。HTTPS 验收通过本机 Caddy 和本机测试证书重复检查排行榜读取，不访问远程生产网关。

测试游戏来自 `http://r-<release-id去连字符>.localhost:<回环运行端口>`。Electron 需要显式的本地 businessRuntime 配置；主进程校验启动描述的 workId、releaseId、入口、scheme 和端口后，才准许对应 origin。未获准的域名、生产 API、任意 URL 和 HTTPS 账号环境混接本机运行域都会被拒绝。

父窗口仍使用严格 CSP、sandbox/contextIsolation/webSecurity；游戏 iframe 仅允许脚本，不允许同源权限，不能读取桌面桥、Node 或父窗口存储。所有图片代理限制仍保留。这个验收仅覆盖本机自有游戏运行，不代表已接入公网游戏运行域、Windows 安装包、多人游戏、云存档或模型功能。

## 本轮本地结果

全新独立 PostgreSQL 完成 158 项迁移。实际 API 验收覆盖目录/封面/日志/作者/课件、邮件捕获登录、游戏库读写与最近游玩、禁用路由、Runtime Edge 和幂等 seed/重启，6 组检查通过。额外的同长度游戏文件篡改返回 503，恢复原内容后返回 200。对应报告目录为 `.runtime/desktop-business-test/mooyu-business-check-1793547791509`，其中 `asset-integrity.json` 记录篡改负例。

实际 Electron 完成 6 项数据库联调检查，包含页面读取、游戏点击计数、游戏沙箱隔离、完整进程重启恢复及退出后的私有库拒绝。窗口结果与截图见上述目录的 `electron-00vC6V`。验收曾触发真实邮件重发限流，脚本现按原有限流等待重试，没有放宽认证规则。本次没有真实 GitHub 授权、模型调用、生产连接或远程部署。
