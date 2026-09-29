# 宝塔面板 2 核 4 GB 部署 GameHub

本手册适用于 Ubuntu 24.04、2 vCPU、4 GiB 内存的阿里云 ECS。宝塔只用于文件、终端和监控；GameHub 由项目内的 Docker Compose 与 Caddy 管理。

## 1. 避免端口冲突

不要在宝塔安装 LNMP、LAMP、Nginx、Apache、OpenResty 或宝塔网站环境。GameHub 的 Caddy 需要独占 TCP 80、TCP 443 和 UDP 443。

如果已经安装了 Web 服务器，先在宝塔“软件商店”确认并停止它，再用终端执行：

```sh
sudo ss -lntup | grep -E ':(80|443)\b' || true
```

输出为空才继续。不要停止宝塔面板自身的随机管理端口。

## 2. 安全设置

- 阿里云安全组：TCP 80/443 对所有 IP 开放；TCP 22 和宝塔面板端口只允许管理员公网 IP；UDP 443 可选。
- 宝塔“安全 → 系统防火墙”设置相同规则。
- 不开放 5432、3090、3092。
- 修改宝塔随机管理入口并启用双因素认证。

## 3. 安装 Docker 并创建交换空间

在宝塔左侧 Docker 页面安装 Docker 管理器。然后在宝塔终端确认：

```sh
docker version
docker compose version
```

2 核 4 GB 首次构建镜像前创建 2 GiB swap：

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

如 `/swapfile` 已存在，不要重复执行，先用 `swapon --show` 检查。

## 4. 上传代码

在宝塔“文件”中创建 `/www/gamehub`，上传 `gamehub-production-source.zip` 并解压。解压后应直接看到 `apps`、`packages`、`deploy`、`package.json`，不要多套一层目录。

在宝塔终端执行：

```sh
cd /www/gamehub/deploy
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

## 5. 域名与 Cloudflare

将域名 DNS 托管到 Cloudflare，并添加两条“仅 DNS（灰云）”记录：

```text
play.example.com              A  ECS公网IP
*.runtime.play.example.com    A  ECS公网IP
```

创建仅具有该 Zone `DNS:Edit` 权限的 Cloudflare API Token。不要使用 Global API Key。

## 6. 填写生产配置

用宝塔文件编辑器打开 `/www/gamehub/deploy/.env.prod`：

```dotenv
APP_DOMAIN=play.example.com
RUNTIME_DOMAIN=runtime.play.example.com
ACME_EMAIL=你的管理邮箱
CLOUDFLARE_API_TOKEN=Cloudflare最小权限Token

POSTGRES_PASSWORD=64位随机十六进制值
OTP_HMAC_KEY=另一组64位随机十六进制值

MAIL_FROM='GameHub <login@你的已验证邮件域名>'
RESEND_API_KEY=re_开头的Resend密钥
LOGIN_EMAIL_ALLOWLIST=你的邮箱,首批测试邮箱

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=
```

两组密钥分别生成，不能相同：

```sh
openssl rand -hex 32
openssl rand -hex 32
```

## 7. 启动与检查

```sh
cd /www/gamehub/deploy
chmod +x deploy.sh backup.sh
./deploy.sh
docker compose --env-file .env.prod -f compose.prod.yml ps
docker compose --env-file .env.prod -f compose.prod.yml logs --tail=100 api worker runtime web
```

首次构建通常需要数分钟。最终 `postgres` 和 `api` 应为 healthy，`migrate` 应为 exited (0)，其他服务应为 running。

检查：

```sh
set -a; . ./.env.prod; set +a
curl -fsS "https://$APP_DOMAIN/health"
curl -fsS "https://$APP_DOMAIN/ready"
```

## 8. 首个管理员

先使用白名单邮箱登录一次，再执行：

```sh
cd /www/gamehub/deploy
ADMIN_EMAIL=你的登录邮箱 docker compose --env-file .env.prod -f compose.prod.yml exec -T api node apps/api/src/promote-admin-cli.mjs
```

退出并重新登录后，账号应显示管理员权限。

## 9. 日常操作

查看日志：

```sh
docker compose --env-file .env.prod -f compose.prod.yml logs -f --tail=100
```

备份：

```sh
BACKUP_ROOT=/www/backup/gamehub ./backup.sh
```

更新时先备份，再上传新代码并执行 `./deploy.sh`。不要在宝塔“网站”中为同一域名再次创建 Nginx 站点。
