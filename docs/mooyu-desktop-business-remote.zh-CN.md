# 桌面完整业务远程隔离测试方案

此文是待部署方案。本轮只做本地验证，没有访问服务器、生产 API、生产数据库或真实 GitHub。当前新增代码尚未提交；不能用旧提交直接执行下面的更新。先审查、提交并推送这次候选版本，取得确定提交号，再另行授权服务器操作。

## 域名与边界

- API：`https://desktop-test.mooyu.fun`，复用现有测试域名，届时从 auth-only 测试后端切换到完整业务测试后端。
- 游戏：`https://r-<32位发布ID>.desktop-runtime-test.mooyu.fun`。新增 DNS A 记录 `*.desktop-runtime-test`，指向现有网关；不是正式 `*.runtime`。Caddy 使用现有网关的 AliDNS DNS-01 凭据签发通配证书。不要把 AliDNS 凭据放进测试 API。
- GitHub：继续用测试 OAuth App，回调仍为 `https://desktop-test.mooyu.fun/v1/auth/github/web/callback`。只有三个配置全部填写且回调完全匹配才启用。不修改正式 OAuth App。
- 新项目 `mooyu-desktop-business-test`，数据库/用户 `desktop_business_test`，Redis `business-redis`；新卷，不导入正式数据，也不导入旧 auth-only 用户。旧测试实例保留作回滚。首次连接新业务数据库会出现新的测试站内账号，不能据此判断 GitHub 身份改变。
- PostgreSQL、Redis、迁移和种子容器仅在 internal 网络；无宿主端口。API 加入独立 ingress 和自己的 egress 网络（GitHub 出站需要）；不接入生产 backend。网关是唯一同时持有正式 backend 和测试 ingress 的组件。
- 远程模式不提供本地验证码文件登录；未配置 GitHub 时只能匿名验收。发布、模型、worker、上传与管理接口保持关闭。种子为两份固定作品、演示游戏/课件、一篇固定日志及作者资料，不代表线上内容同步。
- 账号操作保留 `PATCH /v1/me`（昵称）、`PATCH /v1/me/avatar`（内置预设头像）及 `DELETE /v1/me/devices/:grantId`（撤销本人单个设备）。复用原有 bearer 鉴权、参数校验和设备归属检查；`PUT /v1/me/avatar` 文件上传仍关闭。
- 游戏入口必须来自可信 API 的启动描述符，并严格匹配配置的 HTTPS 域、作品与发布 ID；渲染器仍不能直接访问 API。游戏资源只接收 GET/HEAD，网关移除 Cookie/Authorization，运行域不设置 Cookie，Runtime Edge 继续检查发布状态、清单和资源哈希。

## 本地复验

论文持久化导入/阅读使用独立的显式覆盖文件及 worker，见 [论文隔离服务说明](./mooyu-desktop-paper-study-test.zh-CN.md)。不合并该覆盖文件时，本服务仍关闭论文接口。新增 `verify-desktop-business-remote.mjs --paper` 仅在本地临时 HTTPS 项目中验证该覆盖文件，不访问实际测试域名或生产服务。

在仓库根目录运行：

```powershell
node scripts/verify-desktop-clean.mjs
node scripts/verify-desktop-business-remote.mjs
```

第二条仅接受本机 Docker socket，不接受服务器地址。使用临时项目、独立数据库/Redis、动态回环端口、example.org 测试域名和每次生成的临时证书。HTTPS 连接固定到 127.0.0.1，验证真实域名/SNI 和测试证书；不更改系统信任、不使用 `-k`、不申请公网证书。报告在 `.runtime/desktop-business-remote/latest.json`，结束删除该测试项目的容器、卷和 ingress，保留私有日志。真实 GitHub 授权需要后续另行验收。

账号专项检查在测试容器内部使用真实 auth-service/PostgreSQL 仓库和内存模拟身份提供方创建一次性测试会话，通过 HTTPS 验证昵称/预设头像写入与读回、匿名和无效令牌拒绝、跨账号撤销拒绝、目标设备访问与刷新令牌失效、其它会话保留，以及上传等禁用路由仍被拒绝。该准备过程不会打开远程邮件登录或调用真实 GitHub，也不导出测试令牌到报告。

## 服务器准备（未来执行，当前不执行）

1. 将已审查的确定提交导出到新的 `/www/mooyu-desktop-business-test`；不要覆盖 `/www/gamehub` 或原 auth-only 源码。保留提交号和干净源码清单。不要把本机 `.runtime` 或凭据上传。
2. 在新源码根目录生成配置（宿主有 Node 22 时如下；无 Node 时使用本地 `node:22-bookworm-slim` 容器、网络 none、仅挂载新源码）：

```bash
umask 077
cd /www/mooyu-desktop-business-test
node scripts/prepare-desktop-business-remote.mjs \
  .runtime/desktop-business-remote/instance.env \
  https://desktop-test.mooyu.fun https://desktop-runtime-test.mooyu.fun
chmod 600 .runtime/desktop-business-remote/instance.env
```

通过服务器编辑器填写 `DESKTOP_BUSINESS_TEST_GITHUB_CLIENT_ID/SECRET/CALLBACK_URL`，不输出文件、不复制到聊天。生成器拒绝覆盖；更新必须保留原密码和 OTP key，不能重新生成造成数据库口令不匹配或会话失效。发布镜像使用唯一标签，并把 `DESKTOP_BUSINESS_TEST_IMAGE` 改为该标签。

## 备份当前基线

基线是**当前已经接入 auth-only 的网关**，不是旧的正式基础 Compose。必须保留所有当前 Compose override。以下变量由现场确认后设置，不猜测文件或覆盖已有目录：

```bash
set -euo pipefail
umask 077
SRC=/www/mooyu-desktop-business-test
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=/www/backup/gamehub/desktop-business-$STAMP
mkdir -m 700 "$BACKUP"
WEB=$(docker ps -q --filter label=com.docker.compose.project=gamehub-production \
  --filter label=com.docker.compose.service=web)
test -n "$WEB"; test "$(printf '%s\n' "$WEB" | wc -l)" -eq 1
test "$(docker inspect -f '{{.State.Running}}' "$WEB")" = true
docker inspect "$WEB" > "$BACKUP/web.inspect.json"
docker cp "$WEB:/etc/caddy/Caddyfile" "$BACKUP/Caddyfile.before"
docker exec "$WEB" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  > "$BACKUP/validate-before.log" 2>&1
OLD_IMAGE=$(docker inspect -f '{{.Image}}' "$WEB")
OLD_TAG=mooyu-retained-business-gateway:$STAMP
docker image tag "$OLD_IMAGE" "$OLD_TAG"
docker image save "$OLD_TAG" > "$BACKUP/gateway.tar.partial"
tar -tf "$BACKUP/gateway.tar.partial" >/dev/null
mv "$BACKUP/gateway.tar.partial" "$BACKUP/gateway.tar"
printf '%s\n' "$WEB" > "$BACKUP/web-id.before"
printf '%s\n' "$OLD_IMAGE" > "$BACKUP/gateway-image.before"
printf '%s\n' "$OLD_TAG" > "$BACKUP/gateway-tag.before"
```

另存当前 Compose 文件列表（`com.docker.compose.project.config_files`）、所有原 override 和必要的私有操作变量，解析得到**完整原网关命令** `base_dc`。用它执行 `config --format json > "$BACKUP/baseline.compose.json"`；这是展开后的私有配置，权限 600，不能上传。确认它与运行容器的镜像、挂载、环境、网络和端口一致，不一致即停止。后续回滚直接使用这个冻结的 JSON，不依赖当前 shell 的旧变量。

核对完成后，将回滚 JSON 中 **web.image** 固定为 `$OLD_TAG`，将唯一目标为 `/etc/caddy/Caddyfile` 的绑定源改为 `$BACKUP/Caddyfile.before`，保留只读属性；其它项不改。再次核对旧镜像 ID 和备份文件哈希与运行基线相同。这样回滚不会依赖可能被覆盖的 latest 标签或旧备份目录里的配置路径。原始未修改的 JSON 也应另存留档。候选配置的比较以原始模型为准，仅允许本文列出的 web 镜像引用、配置绑定与 ingress 变化。

保存 `docker ps --no-trunc` 和正式 API/论文 worker/PostgreSQL/Redis 的容器 ID、镜像 ID、启动时间作为前后对比。只做容器元数据检查，不查询正式数据库。凭据和含展开配置的文件只放私有备份目录。

还要从当前容器的回环管理接口保存正在生效的 Caddy JSON，并与 `caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile` 的结果做结构比较。两份内容都可能包含 DNS 凭据，只能保存在私有备份目录。若内存配置与挂载文件不一致，先查明历史 reload，不继续用文件作为回滚基线。

更新已有业务测试实例时，还必须备份**测试项目**：私有 instance.env、当前唯一镜像标签及 `docker image save`；先停测试 API，`business-postgres pg_dump -Fc -U desktop_business_test -d desktop_business_test` 并用 `pg_restore --list` 校验，归档 business-data；Redis 用 `redis-cli SAVE` 后停止测试 Redis，再归档其卷。不能对正式数据库执行这些命令。首次部署没有这些旧业务数据，仅保留 auth-only 实例。

## 生成、校验、启动测试 API

```bash
node "$SRC/scripts/prepare-desktop-business-caddy.mjs" \
  "$BACKUP/Caddyfile.before" "$BACKUP/prepared-caddy" \
  https://desktop-test.mooyu.fun https://desktop-runtime-test.mooyu.fun
docker cp "$BACKUP/prepared-caddy/Caddyfile" "$WEB:/tmp/desktop-business-candidate"
docker exec "$WEB" caddy validate --config /tmp/desktop-business-candidate --adapter caddyfile \
  > "$BACKUP/validate-candidate.log" 2>&1
```

生成器只替换与旧生成模板完全一致的 auth-only 测试块，保留其它站点和日志脱敏。存在手工修改、import 或重复测试站点时停止审查。此处 validate 不加载配置。

```bash
ENV_FILE=$SRC/.runtime/desktop-business-remote/instance.env
NET=mooyu-desktop-business-test-ingress
# 首次创建；已存在则必须先检查归属与 internal=true，不能借用未知网络。
docker network create --internal --label mooyu.desktop-business=ingress-v1 "$NET"
bdc() { docker compose -p mooyu-desktop-business-test --env-file "$ENV_FILE" \
  -f "$SRC/deploy/compose.desktop-business-test.yml" \
  -f "$SRC/deploy/compose.desktop-business-remote.yml" "$@"; }
bdc config --quiet
bdc build business-api
bdc up -d --no-build --wait --wait-timeout 180 business-api
bdc exec -T business-api node -e '
fetch("http://127.0.0.1:3090/ready-desktop-business").then(async r=>{
const d=(await r.json()).data;
if(!r.ok||d.instance!=="isolated-business"||!d.database||!d.redis||!d.migrations.ready||
d.backgroundTasksEnabled!==false||d.publishingEnabled!==false||d.modelCallsEnabled!==false||
d.runtime.domain!=="desktop-runtime-test.mooyu.fun"||d.runtime.scheme!=="https"||
d.emailConfigured!==false)process.exit(1);
console.log("isolated API ready; remote domain not switched");}).catch(()=>process.exit(1));'
```

`up business-api` 会执行新项目依赖的迁移/固定种子，但不会启动本机 gateway、模型或 worker。验收独立数据库名/用户、无宿主端口、卷前缀、网络清单，并检查匿名作品、日志和启动描述符后，才切换域名。不要使用 `down -v` 更新；不要全量重建正式项目。

后续仅更新测试 API 时，不必重复生成已有测试站点或重建网关。先备份测试数据与旧唯一镜像，核对新提交的迁移兼容性，保留 ENV_FILE 中的数据库密码/OTP/OAuth 配置，以新唯一镜像标签构建并运行上述 `bdc up ... business-api`，重新验收。Caddy 生成器拒绝二次插入业务块；只有域名或网关配置确需变化时才单独审查新的网关差异。

## 接入 Caddy 与必要验收

1. 将 `DESKTOP_BUSINESS_CADDY_FILE` 设为备份目录的候选文件绝对路径，`DESKTOP_BUSINESS_CADDY_IMAGE` 设为刚保留的 `$OLD_TAG`，`DESKTOP_BUSINESS_INGRESS_NETWORK=$NET`。将这些导出语句写入权限 600 的 `operations.env`，保留 SRC、ENV_FILE、BACKUP、WEB、NET、OLD_TAG。
2. 在完整 `base_dc` 后附加 `deploy/compose.desktop-business-caddy.yml`，先 `config --format json` 保存 candidate.compose.json。逐项比较 baseline：除了 web 镜像引用（镜像 ID 必须相同）、Caddyfile 绑定和增加的测试 ingress，其它服务、web 环境/端口/证书卷及旧网络必须完全相同。失败即停。
3. `docker compose -p gamehub-production -f "$BACKUP/candidate.compose.json" up -d --no-deps --no-build --pull never web`。此步只重建 web，可能短暂中断网关；不得运行正式 API、worker、迁移或数据库服务。之后所有 web 更新必须继续包含完整旧 override 与新业务 override，或使用冻结的 candidate JSON。
4. 用正常证书校验的 `curl --fail --show-error --silent https://desktop-test.mooyu.fun/ready-desktop-business` 检查所有关闭标记、Redis/迁移和 HTTPS runtime。最多等待 120 秒证书签发；仍失败即回滚，不用 `-k`。
5. 检查匿名作品、日志、学习课件、封面和 profile；按 launch.entryUrl 访问游戏 HTML/JS，验证 HTTPS 发布域、sandbox CSP。错误发布域/Host、POST 游戏资源、发布/模型/上传接口必须拒绝。库接口匿名应为 401。检查 Caddy 错误日志不含 code/state/query 或认证头。
6. 对比正式 API、论文 worker、数据库/Redis 容器 ID 和启动时间未变化；正式主站 `/ready` 仍就绪。不要做正式业务写入。
7. 桌面后续启动参数：`--test-account-api https://desktop-test.mooyu.fun --test-runtime-origin https://desktop-runtime-test.mooyu.fun`。先验证匿名发现、日志、学习、工具、游戏，再经用户授权用测试 OAuth 验证登录、取消、退出、重启恢复、昵称保存、预设头像选择、本人单设备撤销以及库/游玩记录。此次准备不进行真实登录。

## 回滚

域名切换/证书/业务验收任一失败立即回滚当前 auth-only 基线：

```bash
OLD_TAG=$(cat "$BACKUP/gateway-tag.before")
docker image inspect "$OLD_TAG" >/dev/null 2>&1 || docker image load -i "$BACKUP/gateway.tar"
test "$(docker image inspect -f '{{.Id}}' "$OLD_TAG")" = "$(cat "$BACKUP/gateway-image.before")"
docker compose -p gamehub-production -f "$BACKUP/baseline.compose.json" \
  up -d --no-deps --no-build --pull never web
```

确认 web 使用旧镜像 ID、原挂载/网络，正式主站和原 `/ready-desktop-auth` 恢复；保留原 auth-only API 运行供回退。新业务测试 API 可用 `bdc stop business-api` 停止，保留数据库/Redis/数据卷供调查，不删除备份或证书卷。不要恢复正式数据库。

如果只是测试 API 版本回滚：保留 ENV_FILE/卷，设置旧唯一镜像标签，`bdc up -d --no-deps --no-build --wait business-api`。若新版本迁移不向后兼容，先停止测试 API，另建恢复项目并恢复**测试** pg_dump、business-data 与 Redis 快照，验证后再指向恢复实例；不能让旧 API 直接运行在未知新结构上。正式数据始终不参与。

本地回滚验证覆盖 Caddy reload 回到旧 auth-only 路由再切回业务路由；生产 web 的完整 Compose 重建回滚仍须在现场核验冻结基线。公网 DNS、证书签发、真实 OAuth 和服务器资源条件不由本地测试替代。
