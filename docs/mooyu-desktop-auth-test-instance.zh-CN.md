# 桌面账号独立测试实例

本方案复用现有 API 的认证路由、PostgreSQL 账号仓库、GitHub OAuth 客户端及会话逻辑，测试数据与正式账号分开。正式桌面版最终仍连接现有正式 API；此实例只用于发布前的账号联调。

当前阶段仅准备配置并在本机验证，未在服务器部署。Electron 已增加显式隔离测试 HTTPS 接入并用本机 HTTPS 服务验证，但尚未连接公网测试服务器或真实 GitHub App；本地验证不能视为真实 GitHub 授权验证。

现有正式站点已经配置 HTTPS 与 GitHub OAuth，无需为桌面正式接入重新创建一套正式登录。正式客户端将复用服务器现有 OAuth App、回调和账号，Client Secret 仍保留在服务器；本阶段单独的测试 App 用来隔离联调。用户说明现有证书在阿里云管理，优先核对已有证书是否覆盖测试域名，覆盖即可复用。本地记录没有证书 SAN 清单，本轮不连接正式站点检查证书。

## 隔离边界

- 独立 Compose 项目 `mooyu-desktop-auth-test`，独立 PostgreSQL、Redis、数据卷和网络；不引用正式 Compose、`.env.prod` 或正式目录。
- 数据库名和账号固定 `desktop_auth_test`，数据库主机固定 `auth-postgres`；专用入口拒绝其他数据库 URL、Redis URL 和正式站点 origin。仅使用新生成的密码与 OTP 密钥。
- 只把 API 映射到服务器 `127.0.0.1:39090`，数据库和 Redis 不映射宿主端口。API 拥有单独出站网络供后续 GitHub HTTPS 请求使用。
- 专用入口不创建业务服务或 worker。只放行账号、登录、设备会话、预设头像和测试健康检查；不开放研究、模型、文章、发布、上传、云存档及后台调度。
- `/ready-desktop-auth` 验证数据库、迁移、Redis；另行报告 `githubConfigured`、`emailConfigured` 和 `backgroundTasksEnabled`。基础设施 ready 不表示 GitHub 已配置。
- 专用 readiness 总等待上限为 2 秒，合并并发探针，Redis 禁用离线队列和自动重连；截止或关闭立即断开探针连接，返回 503。未完成的数据库探针不会被重复创建，恢复后重新探测。正式服务的 Redis store 不改变。
- 禁用邮件发送。未配置 GitHub 时登录入口返回 `GITHUB_WEB_AUTH_UNAVAILABLE`。测试实例 GitHub 登录允许用户创建独立测试账号，邮箱 allowlist 不是 GitHub 访问控制。
- API 不记录请求；网关生成器为默认运行日志添加编码过滤，URI 保留路径并移除整个查询串，删除 Referer、Authorization、Cookie 请求头，保护上游失败和超时错误日志中的回调参数。已有自定义日志配置时生成器报错停止，避免覆盖或旁路过滤。不要把真实配置、令牌、回调完整 URL 或 Compose 展开后的 environment 发到聊天。

## 本地准备与回归

在仓库根目录运行，需 Node.js 22 与本机 Docker Compose。生成脚本只创建新文件，已存在则拒绝覆盖，不打印密钥。

```powershell
node scripts/prepare-desktop-auth-test.mjs
node --test tests/platform/desktop-auth-test-instance.test.mjs tests/platform/desktop-account-session.test.mjs tests/platform/desktop-github-session.test.mjs
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml config --quiet
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml build auth-api
node scripts/verify-desktop-auth-instance.mjs
```

验证脚本为每轮生成随机项目名、密码、OTP 密钥和空闲本机端口，迁移全新数据库，验证会话和接口边界；完成后只移除本轮项目及本轮数据卷。报告保存到 `.runtime/desktop-auth-test/mooyu-auth-check-*/report.json`。不会使用已有项目或配置真实 GitHub、SMTP。

2026-11-01 本地验证结果：新增实例回归与桌面账号、GitHub 模拟、网页版会话回归共 33 项通过；原有认证服务与实时配置回归另 11 项通过，共 44 项。Docker Desktop 实例验证完成全新 PostgreSQL 的 158 项迁移、Redis 就绪、匿名会话、未配置 OAuth 拒绝、业务路由拒绝及数据库身份检查，随后清理本轮容器和数据卷。报告为 `.runtime/desktop-auth-test/mooyu-auth-check-1793535360344/report.json`。未进行公网代理或真实 GitHub App 验证。

## 后续服务器步骤（本轮不执行）

部署方式纠正：本项目按 `48-baota-2c4g-deployment.zh-CN.md` 使用 Docker Compose 的 `web` 容器与 Caddy，宝塔只管理文件、终端和监控。不要在宝塔创建 PHP/静态站点、安装或接管 Nginx/Apache；现有 Caddy 占用 80/443。`deploy/Caddyfile` 已配置 AliDNS DNS challenge 自动申请证书。此前给出的宝塔网站/手动安装证书操作不适用于此部署，下面的测试域名网关步骤需先完成 Caddy 方案审查再执行。

新增文件目前只在本地，`git pull` 不会取得这些未提交改动。待审查、提交推送或准备经审查的源码包后，才能在服务器执行以下流程。使用独立源码目录，例如 `/www/mooyu-desktop-auth-test`，不要在正式部署目录复用环境文件。

1. 确定测试域名并配置 DNS；用户已新增 `desktop-test` A 记录。下一步为现有 Caddy 准备独立测试域名站点块和证书签发配置，保留正式域名配置。本轮不加载新配置。
2. 在 GitHub 新建仅供测试的 OAuth App。Homepage URL 为测试 HTTPS origin，回调 URL 严格为 `https://测试域名/v1/auth/github/web/callback`。Client Secret 仅保存在测试实例配置中，不放进桌面应用。参考 [GitHub 官方网页授权流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow)。
3. 在独立源码目录生成配置，填入测试 App 的三个 GitHub 配置项。不要复制正式 `.env.prod`、数据库、账号或邮件凭据。

```bash
cd /www/mooyu-desktop-auth-test
umask 077
# 把示例地址替换成已准备好的独立测试域名。
node scripts/prepare-desktop-auth-test.mjs .runtime/desktop-auth-test/instance.env https://desktop-test.example.org
chmod 600 .runtime/desktop-auth-test/instance.env
# 用服务器编辑器填写配置中的：
# DESKTOP_AUTH_TEST_GITHUB_CLIENT_ID
# DESKTOP_AUTH_TEST_GITHUB_CLIENT_SECRET
# DESKTOP_AUTH_TEST_GITHUB_CALLBACK_URL
```

4. 后续启动时，仅使用本测试 Compose 文件：

```bash
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml config --quiet
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml build auth-api
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml up -d --no-build --wait --wait-timeout 150
curl --fail --silent --show-error http://127.0.0.1:39090/ready-desktop-auth
```

必须看到 `status: ready`、`githubConfigured: true`、`emailConfigured: false`、`backgroundTasksEnabled: false`。`auth-migrate` 成功退出属于正常状态。

5. 使用现有 Docker Caddy 接入测试域名，步骤见 [Caddy 定向接入与回退](mooyu-desktop-caddy-rollout.zh-CN.md)。已准备仅连接 Caddy 与测试 API 的独立入口网络，测试数据库/Redis 保持隔离；容器内的 `127.0.0.1:39090` 不是宿主测试 API，不能直接作为 Caddy 上游。配置副本生成、备份、保留旧镜像、定向更新和回退步骤已整理，本轮不操作线上网关。不要让第二个 Web 服务抢占 80/443。
6. Electron 测试 HTTPS 接入已补齐。公网测试实例准备完成后，再由用户在系统浏览器完成真实 GitHub 授权，验证登录、取消、关闭页面、退出、重启恢复和撤销会话；不进行文章生成或发布。

## 桌面测试地址与独立会话

待测试实例部署并确认就绪后，在本机仓库根目录运行以下命令；本轮没有执行该公网连接命令：

```powershell
node scripts/start-desktop-shell.mjs --test-account-api https://desktop-test.mooyu.fun
```

`--test-account-api` 只接受显式 HTTPS origin，无用户名、密码、路径、查询或 fragment；拒绝正式站点 `mooyu.fun`/`www.mooyu.fun`。原有 `--account-api` 保持只接受本机 HTTP，两种参数不能同时使用。默认双击入口仍离线。

默认根据规范化的测试 origin 派生 `.runtime/desktop-shell/profiles/test-<摘要>`。指定 `--profile-root` 时它作为父目录，其下仍自动派生服务器目录。该目录独立保存窗口状态、Chromium 分区、本地存储和 DPAPI 凭据。`account-server.json` 绑定精确 origin；不能改绑另一服务器，也不能降为本机模式；已存在但没有绑定文件的非空目录会拒绝使用。

主进程首次发送账号请求前，匿名 GET `/ready-desktop-auth`，检查隔离实例标识、基础设施就绪和后台关闭状态，成功后才发送该 origin 的账号请求。网络失败保留加密会话，不回退到生产或其他地址。TLS 使用正常证书验证，拒绝 `NODE_TLS_REJECT_UNAUTHORIZED=0`；账号请求禁止跳转、限制超时。界面显示“隔离测试”和配置 origin，renderer 仍不具备直接网络请求权限。远程 OAuth 只允许 GitHub 官方授权端点，且 `redirect_uri` 必须回到此测试 origin 的既有 callback。

本地验证命令：

```powershell
node --test tests/platform/desktop-remote-account.test.mjs
node scripts/build-desktop-shell.mjs
node scripts/verify-desktop-remote-account.mjs
```

HTTPS 验证服务仅绑定 `127.0.0.1`，使用公开测试证书及模拟账号。测试 CA 仅注入验收子进程，不安装到 Windows 信任库，不修改产品 TLS 校验，不发送真实邮件或访问 GitHub。

2026-11-01 桌面 HTTPS 接入验证：9 项新增回归覆盖显式配置、服务器目录绑定、真实回环 TLS、证书信任与主机名拒绝、实例就绪检查、跨服务器凭据隔离、跳转拒绝、离线退出、撤销与 OAuth 回调限制；合并相关账号、认证、窗口及配置回归共 60 项通过。实际 Electron 在两个本机 HTTPS origin、四个完整进程阶段完成 16 项检查，验证共享登录界面、真实 DPAPI、Chromium 独立分区、换服务器匿名、重启刷新及退出后重启。最终报告 `.runtime/desktop-shell/https-account-acceptance-jCg0OH`，最新索引 `https-account-verification-latest.json`。原有外壳 18 项、实际产品入口，以及 GitHub 系统浏览器 8 项检查也通过，报告分别为 `.runtime/desktop-shell/acceptance-hB40gD`、`.runtime/desktop-shell/github-acceptance-oV9ayf`。

窗口验证还发现并修复了启动时的异步顺序与 Windows 嵌套路径长度问题：profile 绑定与 Chromium 路径配置在首次异步操作前完成，服务器目录采用短摘要并通过完整 origin 文件校验。最终 HTTPS 运行未再出现长路径缓存目录警告。普通受限沙箱首次未能启动 Electron GPU 进程，此次窗口验收使用本机正常进程权限重跑，未关闭 Electron sandbox、webSecurity 或 TLS 校验。

## 停止与回退

测试 API 失败时从独立源码目录停止本测试项目，并保留测试数据供排查。若后续已接入现有 Caddy，需按事先审查的网关回退步骤恢复备份配置；本轮尚未修改 Caddy，不需要操作正式网关。

```bash
cd /www/mooyu-desktop-auth-test
docker compose --env-file .runtime/desktop-auth-test/instance.env -f deploy/compose.desktop-auth-test.yml down
```

不要加 `--volumes`，不要执行 Docker 全局清理。修改测试数据库密码前先处理已有测试卷，不能通过重新生成 env 自动重置 PostgreSQL 已初始化的密码。销毁测试数据需另行明确决定。
