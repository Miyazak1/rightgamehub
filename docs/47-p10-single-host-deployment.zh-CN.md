# P1.0 单机邀请制部署

本阶段提供可部署的邀请测试环境，不等于无限制开放作者注册的正式商用环境。第一阶段只给受信任作者开启发布权限；玩家邮箱由允许名单控制。

## 1. 服务器与域名

- Linux x86_64，建议 2 vCPU、4 GB 内存、80 GB SSD。
- 安装 Docker Engine 与 Compose v2。
- 阿里云云解析 DNS 托管域名；准备两个名称，例如 `play.example.com` 和 `runtime.play.example.com`。
- 添加 `play` 与 `*.runtime.play` 的 DNS 记录并指向服务器。
- 创建独立 RAM 用户，只授予目标域名所需的 AliDNS 查询、添加、更新和删除解析记录权限，并生成 AccessKey。
- 防火墙只公开 TCP 80、TCP/UDP 443；SSH 限制为管理来源。PostgreSQL 不映射宿主端口。

运行域必须使用独立通配子域，因为每个发布版本都有独立 origin。Caddy 镜像包含 AliDNS 模块，用 DNS challenge 自动签发应用域和运行通配证书。

## 2. 首次部署

```sh
cd deploy
cp .env.prod.example .env.prod
chmod 600 .env.prod
# 填写域名、AliDNS RAM AccessKey、数据库、OTP、Resend 与邀请邮箱
./deploy.sh
```

检查：

```sh
curl -fsS https://play.example.com/health
curl -fsS https://play.example.com/ready
docker compose --env-file .env.prod -f compose.prod.yml ps
docker compose --env-file .env.prod -f compose.prod.yml logs --tail=100 api worker runtime web
```

`ready` 必须显示数据库可用且 migration 的 `expected` 与 `applied` 相等。

## 3. 第一个管理员与作者

1. 保持 `LOGIN_EMAIL_ALLOWLIST=` 为空，允许任何合法邮箱注册和登录。创作者权限仍需单独申请并由管理员批准。
2. 使用管理员邮箱在网站完成一次登录，让系统创建账号。
3. 在服务器执行：

```sh
docker compose --env-file .env.prod -f compose.prod.yml run --rm \
  -e ADMIN_EMAIL=owner@example.com api node apps/api/src/promote-admin-cli.mjs
```

重新登录后新的设备授权会取得管理员权限。普通账号仍只有玩家权限；只有管理员批准创作者申请后，账号才会取得 `can_publish` 以及创作、上传和发布 scope。当前单机校验 Worker 有资源边界与严格 ZIP 规则，但还没有生产规划中的 rootless Podman 二次隔离。

## 4. 邮件与 GitHub

邮件登录使用 Resend：验证发送域名后填写 `RESEND_API_KEY` 和 `MAIL_FROM`。正式配置保持 `LOGIN_EMAIL_ALLOWLIST=` 为空，允许任意合法邮箱申请验证码。该设置只控制登录，不授予创作者权限；创作者仍需在创作中心提交申请并等待管理员批准。

GitHub OAuth 可稍后启用。启用时三个字段必须一起填写，并在 GitHub OAuth App 登记完全一致的 HTTPS callback：

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://play.example.com/v1/auth/github/web/callback
```

如将来临时启用严格邮箱名单，需要同时评估 GitHub 登录，因为 GitHub 身份当前不套用邮件允许名单。

## 5. Agent 客户端

- Cursor / VS Code：把 `gamehub.apiUrl` 设置为 `https://play.example.com`，然后安装 `artifacts/gamehub-agent-0.2.6.vsix`。
- Harness：构建包已经支持远程 API，但宿主部署需要把 `GAMEHUB_API_BASE_URL` 注入为同一 HTTPS 地址。
- 生产 API 明确允许 VS Code Webview origin，以及标准本机 Harness `http://127.0.0.1:3081` origin；所有写操作仍要求 Bearer token。

## 6. 数据与备份

数据库、头像、封面、隔离包和运行资产使用 Docker named volumes。执行：

```sh
BACKUP_ROOT=/srv/gamehub-backups ./backup.sh
```

脚本固定读取 `gamehub-production` Compose 项目的卷，并生成 PostgreSQL custom dump、头像/封面/运行资产压缩包和 SHA-256 清单。备份目录必须同步到另一台机器或私有对象存储；保留在同一块磁盘不算备份。

恢复前先停止 `api`、`worker`、`runtime`，校验 `SHA256SUMS`，恢复数据库与三个资产卷，再启动并核对 `current_release_id` 和抽样资源哈希。恢复演练没有完成前，RPO 24 小时/RTO 4 小时只是目标，不是承诺。

## 7. 更新与回滚

生产服务器只跟随 `main`，不要把功能分支直接拉入生产工作区。更新前先确认工作区干净、当前分支正确，并让任一步失败立即停止：

```sh
set -e
cd /www/gamehub
git status --short
test "$(git branch --show-current)" = "main"
git pull --ff-only origin main
git log -1 --oneline
```

只有 `git pull --ff-only` 成功并确认提交号后，才能继续构建。拉取失败后继续执行 Docker 构建，只会用服务器原有源码重新生成旧镜像，不能视为更新成功。

完整更新：

```sh
./backup.sh
./deploy.sh
```

仅更新 Web 前端且没有数据库迁移时，可以在 `deploy/` 下执行：

```sh
docker compose --env-file .env.prod -f compose.prod.yml build web
docker compose --env-file .env.prod -f compose.prod.yml up -d --no-deps web
docker compose --env-file .env.prod -f compose.prod.yml ps web
```

### 7.1 `--ff-only` 因历史分叉失败

出现 `diverging branches can't be fast-forwarded` 时立即停止，不要在生产服务器执行 `reset --hard`、强制拉取、盲目 `stash`，也不要改为直接拉功能分支。先收集：

```sh
git status --short
git branch --show-current
git show -s --format='%h %D %s' HEAD
git log --oneline --decorate --graph --max-count=20 --all
```

常见原因是功能分支通过 squash merge 合入 `main`：修复内容相同，但主分支上的提交哈希和原功能分支不同，Git 因此不能快进。安全处理方式是在开发机从最新 `origin/main` 新建分支，只 cherry-pick 尚未合入的增量提交，验证后通过 PR 合回 `main`；生产服务器随后仍只拉 `main`。

2026-10-17 的官方工具更新就是这一情况：`e2dfac2b` 的内容被 squash 为主分支的 `9140c67b`，PDF 增量提交为 `77561e11`。服务器从 `9140c67b` 直接拉原功能分支失败是预期行为；正确修复是从 `origin/main` 新建分支并只移植 PDF 增量，而不是覆盖生产分支。

Compose 会先运行新增 migration，成功后才启动新版 API。回滚必须使用与现有 migration 兼容的旧代码版本；如果 migration 不兼容，不得仅回退容器镜像。

紧急停服但保留数据：

```sh
docker compose --env-file .env.prod -f compose.prod.yml stop web api worker runtime
```

不要使用 `docker compose down -v`，它会删除生产数据卷。

## 8. 上线前人工验收

- 任意未注册的合法邮箱都可以申请验证码并创建普通玩家账号。
- 未获批玩家不能创建作品、上传文件或发布；提交创作者申请后保持待审核状态。
- 管理员批准后，申请人才取得创作、上传和发布权限；拒绝后仍可作为玩家使用并可重新申请。
- 管理员、已批准创作者和普通玩家权限区分正确。
- 创建、上传、校验、发布、游玩、收藏、撤下完整走通。
- `r-<release>.runtime...` 使用独立 HTTPS origin，不能读取业务域登录态。
- 作品撤下后新的资源请求失败。
- 备份生成、异机保存和从空环境恢复各完成一次。
- 观察 24 小时 API/Worker 日志、磁盘和邮件投递后，再增加邀请人数。
