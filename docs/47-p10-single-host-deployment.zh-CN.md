# P1.0 单机邀请制部署

本阶段提供可部署的邀请测试环境，不等于无限制开放作者注册的正式商用环境。第一阶段只给受信任作者开启发布权限；玩家邮箱由允许名单控制。

## 1. 服务器与域名

- Linux x86_64，建议 2 vCPU、4 GB 内存、80 GB SSD。
- 安装 Docker Engine 与 Compose v2。
- Cloudflare 托管域名；准备两个名称，例如 `play.example.com` 和 `runtime.play.example.com`。
- 添加 `play` 与 `*.runtime.play` 的 DNS 记录并指向服务器。
- 创建仅能编辑该 Zone DNS 的 Cloudflare API Token。
- 防火墙只公开 TCP 80、TCP/UDP 443；SSH 限制为管理来源。PostgreSQL 不映射宿主端口。

运行域必须使用独立通配子域，因为每个发布版本都有独立 origin。Caddy 镜像包含 Cloudflare DNS 模块，用 DNS challenge 自动签发应用域和运行通配证书。

## 2. 首次部署

```sh
cd deploy
cp .env.prod.example .env.prod
chmod 600 .env.prod
# 填写域名、Cloudflare、数据库、OTP、Resend 与邀请邮箱
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

1. 把管理员邮箱加入 `LOGIN_EMAIL_ALLOWLIST`。
2. 使用该邮箱在网站完成一次登录，让系统创建账号。
3. 在服务器执行：

```sh
docker compose --env-file .env.prod -f compose.prod.yml run --rm \
  -e ADMIN_EMAIL=owner@example.com api node apps/api/src/promote-admin-cli.mjs
```

重新登录后新的设备授权会取得管理员及发布权限。邀请测试期不要给不受信任账号开启 `can_publish`；当前单机校验 Worker 有资源边界与严格 ZIP 规则，但还没有生产规划中的 rootless Podman 二次隔离。

## 4. 邮件与 GitHub

邮件登录使用 Resend：验证发送域名后填写 `RESEND_API_KEY` 和 `MAIL_FROM`。`LOGIN_EMAIL_ALLOWLIST` 为空会允许任意合法邮箱申请验证码；邀请期必须保留非空名单。

GitHub OAuth 可稍后启用。启用时三个字段必须一起填写，并在 GitHub OAuth App 登记完全一致的 HTTPS callback：

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://play.example.com/v1/auth/github/web/callback
```

邀请期若需要严格邮箱名单，不要启用 GitHub 登录，因为 GitHub 身份当前不套用邮件允许名单。

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

更新：

```sh
./backup.sh
./deploy.sh
```

Compose 会先运行新增 migration，成功后才启动新版 API。回滚必须使用与现有 migration 兼容的旧代码版本；如果 migration 不兼容，不得仅回退容器镜像。

紧急停服但保留数据：

```sh
docker compose --env-file .env.prod -f compose.prod.yml stop web api worker runtime
```

不要使用 `docker compose down -v`，它会删除生产数据卷。

## 8. 上线前人工验收

- 新邮箱不在 allowlist 时无法申请验证码；受邀邮箱可以登录。
- 管理员、普通玩家权限区分正确。
- 创建、上传、校验、发布、游玩、收藏、撤下完整走通。
- `r-<release>.runtime...` 使用独立 HTTPS origin，不能读取业务域登录态。
- 作品撤下后新的资源请求失败。
- 备份生成、异机保存和从空环境恢复各完成一次。
- 观察 24 小时 API/Worker 日志、磁盘和邮件投递后，再增加邀请人数。
