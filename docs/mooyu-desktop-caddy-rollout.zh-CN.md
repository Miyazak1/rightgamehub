# 桌面测试域名：现有 Caddy 定向接入与回退

本文件是待审查的服务器操作步骤，本轮没有执行。当前新文件仍未提交或推送，不能直接通过服务器 `git pull` 获取。后续应先把经审查的源码包放到独立目录 `/www/mooyu-desktop-auth-test`。正式源码 `/www/gamehub`、正式数据库和 API 不替换。

现有网关由 `gamehub-production` 项目的 `web` 容器提供，Caddy 使用 AliDNS DNS challenge。不要安装宝塔 Nginx/Apache，不需要宝塔网站条目。DNS 的 `desktop-test.mooyu.fun` A 记录应指向当前服务器。

入口网络 `mooyu-desktop-auth-test-ingress` 只连接现有 `web` 和新测试 `auth-api`；测试 PostgreSQL、Redis 和迁移容器不接入该网络，测试 API 不加入正式 `backend` 网络。AliDNS 凭据沿用网关已有环境，不复制给测试 API 或桌面。

首次接入需要给 `web` 添加持久网络、配置挂载，因此会定向重建一次网关，网站入口可能短暂中断；不会重建 API、论文 worker 或数据库。使用当前运行网关镜像的保留标签，不重新构建前端。以后更新 **web** 时必须继续带此覆盖文件，否则会撤去测试入口；仅更新 API/worker 不需要加入此覆盖文件。`docker restart` 会保留本次挂载与网络。

配置生成器会在现有全局选项中插入默认运行日志过滤器：所有请求错误日志的 URI 只保留路径，查询串统一变为 `?[redacted]`，并删除 Referer、Authorization、Cookie。其余原配置与路由保持原文；没有全局块时新增一个。已有显式日志配置时停止生成，避免覆盖日志输出或遗漏旁路。测试上游连接超时为 3 秒、响应头超时为 20 秒，过滤只改变日志编码，不改发往 API 的原始 OAuth 查询参数。

下列代码块按顺序在同一个 Bash 会话执行。它们包含服务器变更，需在后续明确执行部署时使用，当前只作审查。

## 1. 捕获当前网关，备份并准备配置

```bash
set -euo pipefail
umask 077
prod_dir=/www/gamehub/deploy
test_src=/www/mooyu-desktop-auth-test
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release_dir="/www/backup/gamehub/desktop-auth-caddy-$stamp"
mkdir -p "$release_dir/original-caddy"
test -f "$test_src/deploy/compose.desktop-auth-ingress.yml"
test -f "$test_src/deploy/compose.desktop-auth-caddy.yml"
test -f "$test_src/scripts/prepare-desktop-auth-caddy.mjs"
prod=(docker compose --project-name gamehub-production --env-file "$prod_dir/.env.prod" -f "$prod_dir/compose.prod.yml")
# 服务器不需要安装 Node。只用无网络的短生命周期容器处理本地文件。
test_node() {
  docker run --rm -i --network none --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$test_src,target=$test_src" \
    --mount "type=bind,source=$release_dir,target=$release_dir" \
    --workdir "$test_src" --entrypoint node node:22-bookworm-slim "$@"
}
web_id=$("${prod[@]}" ps -q web)
test -n "$web_id"
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$web_id")" = gamehub-production
test "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$web_id")" = web
test "$(docker inspect -f '{{.State.Running}}' "$web_id")" = true

# 如这里不匹配，说明现有 web 还有其他 Compose 覆盖文件：停止，先核对基线。
config_files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$web_id")
test "$config_files" = "$prod_dir/compose.prod.yml"
printf '%s\n' "$web_id" > "$release_dir/web-container-id.txt"
printf '%s\n' "$config_files" > "$release_dir/original-compose-files.txt"
image_id=$(docker inspect -f '{{.Image}}' "$web_id")
retained_image="gamehub-retained-desktop-gateway:$stamp"
docker image tag "$image_id" "$retained_image"
printf '%s\n' "$image_id" > "$release_dir/original-image-id.txt"
docker cp "$web_id:/etc/caddy/." "$release_dir/original-caddy/"

# 备份含展开环境值的运行配置，仅存私有备份目录，不能粘贴到聊天。
docker exec "$web_id" wget -qO- http://127.0.0.1:2019/config/ > "$release_dir/active-before.json"
docker exec "$web_id" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > "$release_dir/adapted-before.json" 2> "$release_dir/adapt-before.log"
test_node - "$release_dir/active-before.json" "$release_dir/adapted-before.json" "$release_dir/original-caddy/Caddyfile" <<'NODE'
const fs=require('node:fs');
const [active,adapted,source]=process.argv.slice(2);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
if(JSON.stringify(canonical(JSON.parse(fs.readFileSync(active))))!==JSON.stringify(canonical(JSON.parse(fs.readFileSync(adapted))))) {
 console.error('STOP: running config differs from the captured Caddyfile');process.exit(1);
}
if(/^\s*import\s/m.test(fs.readFileSync(source,'utf8'))) {
 console.error('STOP: imported Caddy files need a separate baseline review');process.exit(1);
}
console.log('Current gateway baseline matches its Caddyfile.');
NODE

# 先确认备份盘空间充足；另存镜像归档，避免后续误清理标签导致无法回退。
df -h /www
docker image save "$retained_image" > "$release_dir/gateway-image.tar.partial"
tar -tf "$release_dir/gateway-image.tar.partial" >/dev/null
mv "$release_dir/gateway-image.tar.partial" "$release_dir/gateway-image.tar"
test_node "$test_src/scripts/prepare-desktop-auth-caddy.mjs" \
  "$release_dir/original-caddy/Caddyfile" "$release_dir/prepared-caddy" desktop-test.mooyu.fun

# 以下三个是非密钥配置。后续所有测试网关操作都必须保留它们。
export DESKTOP_AUTH_CADDY_FILE="$release_dir/prepared-caddy/Caddyfile"
export DESKTOP_AUTH_CADDY_IMAGE="$retained_image"
export DESKTOP_AUTH_INGRESS_NETWORK=mooyu-desktop-auth-test-ingress
printf '%s\n' \
  "export DESKTOP_AUTH_CADDY_FILE=$DESKTOP_AUTH_CADDY_FILE" \
  "export DESKTOP_AUTH_CADDY_IMAGE=$DESKTOP_AUTH_CADDY_IMAGE" \
  "export DESKTOP_AUTH_INGRESS_NETWORK=$DESKTOP_AUTH_INGRESS_NETWORK" \
  "release_dir=$release_dir" "test_src=$test_src" "prod_dir=$prod_dir" > "$release_dir/operations.env"

# 仅校验，不运行配置或申请证书；校验日志不向终端展开配置。
docker cp "$DESKTOP_AUTH_CADDY_FILE" "$web_id:/tmp/desktop-auth-$stamp.caddyfile"
docker exec "$web_id" caddy validate --config "/tmp/desktop-auth-$stamp.caddyfile" --adapter caddyfile > "$release_dir/validate.log" 2>&1
```

步骤失败时停止，不执行后续。原运行配置与磁盘配置不一致、存在未审查的 imports 或其他 web 覆盖文件时，先重新核对完整基线。备份目录包含私有运行配置，不上传，不打印完整 JSON；也不运行输出完整环境的 `docker inspect`。

## 2. 启动独立测试 API

新实例环境的准备方法见 [账号测试实例](mooyu-desktop-auth-test-instance.zh-CN.md)。使用新数据库密码与 OTP 密钥，不复制 `.env.prod`。GitHub 测试 App 的配置由操作者在测试环境文件中填写，未填时可以先验证基础设施，真实授权需配置完成后再做。

```bash
cd "$test_src"
if test ! -f .runtime/desktop-auth-test/instance.env; then
  test_node scripts/prepare-desktop-auth-test.mjs .runtime/desktop-auth-test/instance.env https://desktop-test.mooyu.fun
fi
chmod 600 .runtime/desktop-auth-test/instance.env

if docker network inspect "$DESKTOP_AUTH_INGRESS_NETWORK" >/dev/null 2>&1; then
  test "$(docker network inspect -f '{{index .Labels "mooyu.desktop-auth-test"}}' "$DESKTOP_AUTH_INGRESS_NETWORK")" = ingress-v1
else
  docker network create --internal --label mooyu.desktop-auth-test=ingress-v1 "$DESKTOP_AUTH_INGRESS_NETWORK"
fi
test_api=(docker compose --project-name mooyu-desktop-auth-test \
  --env-file "$test_src/.runtime/desktop-auth-test/instance.env" \
  -f "$test_src/deploy/compose.desktop-auth-test.yml" \
  -f "$test_src/deploy/compose.desktop-auth-ingress.yml")
"${test_api[@]}" config --quiet
"${test_api[@]}" build auth-api
"${test_api[@]}" up -d --no-build --wait --wait-timeout 150
curl --fail --silent --show-error http://127.0.0.1:39090/ready-desktop-auth > "$release_dir/api-local-ready.json"
test_node - "$release_dir/api-local-ready.json" <<'NODE'
const d=JSON.parse(require('node:fs').readFileSync(process.argv[2])).data;
if(d?.status!=='ready'||d.instance!=='isolated-auth-only'||d.backgroundTasksEnabled!==false||d.database!==true||d.redis!==true||d.migrations?.ready!==true)process.exit(1);
console.log(JSON.stringify({ready:true,githubConfigured:d.githubConfigured,backgroundTasksEnabled:d.backgroundTasksEnabled}));
NODE
```

不向公网开放 `39090`、数据库或 Redis。此时网关尚未改变。若 `githubConfigured:false`，基础设施可继续验证，但不要启动真实 GitHub 授权尝试。

## 3. 仅更新网关并验证

```bash
gateway=("${prod[@]}" -f "$test_src/deploy/compose.desktop-auth-caddy.yml")
"${gateway[@]}" config --quiet
# 检查正式站点原本可用，记录更新前结果。
curl --fail --silent --show-error https://mooyu.fun/ready > "$release_dir/main-before-ready.json"

# 唯一的正式服务变更：固定旧镜像，定向重建 web，保留原有证书卷。
"${gateway[@]}" up -d --no-deps --no-build --force-recreate web

# 此处会由 Caddy 按测试域名进行证书签发；失败不要使用 curl -k 绕过。
curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 3 --max-time 10 \
  https://desktop-test.mooyu.fun/ready-desktop-auth > "$release_dir/api-public-ready.json"
curl --fail --silent --show-error https://mooyu.fun/ready > "$release_dir/main-after-ready.json"
code=$(curl --silent --show-error --max-time 15 -o "$release_dir/blocked-route.json" -w '%{http_code}' https://desktop-test.mooyu.fun/v1/blog/articles)
test "$code" = 404
test_node - "$release_dir/api-public-ready.json" "$release_dir/main-after-ready.json" "$release_dir/blocked-route.json" <<'NODE'
const fs=require('node:fs');const [testFile,mainFile,blockedFile]=process.argv.slice(2);
const d=JSON.parse(fs.readFileSync(testFile)).data;
const main=JSON.parse(fs.readFileSync(mainFile));
if(d?.status!=='ready'||d.instance!=='isolated-auth-only'||d.backgroundTasksEnabled!==false||d.database!==true||d.redis!==true||d.migrations?.ready!==true)process.exit(1);
if((main.data??main).status!=='ready')process.exit(1);
if(JSON.parse(fs.readFileSync(blockedFile)).error?.code!=='DESKTOP_AUTH_TEST_ROUTE_DISABLED')process.exit(1);
console.log(JSON.stringify({testReady:true,mainReady:true,githubConfigured:d.githubConfigured,researchAndPublishingBlocked:true}));
NODE
printf 'BACKUP_DIR=%s\n' "$release_dir"
```

只做健康和拒绝路由检查，不创建研究任务、文章或发布。TLS 验证通过后，测试域名根路径返回账号专用实例的 404 也正常；根路径没有网页不是 TLS 失败。失败时按下一节回退，不批量重建整套 Compose。

## 4. 网关回退

若另开终端，先将下方路径替换成第 1 步输出的真实备份目录，然后恢复非密钥操作变量；再按第 1 步定义 `prod` 和 `test_node`，第 2 步定义 `test_api`。不要猜测时间戳。

```bash
# 仅另开会话时使用并填写真实路径：
# source /www/backup/gamehub/desktop-auth-caddy-实际时间/operations.env

test -f "$release_dir/original-caddy/Caddyfile"
docker image inspect "$DESKTOP_AUTH_CADDY_IMAGE" >/dev/null
cat > "$release_dir/rollback-web.yml" <<YAML
services:
  web:
    image: $DESKTOP_AUTH_CADDY_IMAGE
    volumes:
      - type: bind
        source: $release_dir/original-caddy/Caddyfile
        target: /etc/caddy/Caddyfile
        read_only: true
YAML
rollback=("${prod[@]}" -f "$release_dir/rollback-web.yml")
"${rollback[@]}" config --quiet
"${rollback[@]}" up -d --no-deps --no-build --force-recreate web
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 2 https://mooyu.fun/ready > "$release_dir/main-rollback-ready.json"
test_node - "$release_dir/main-rollback-ready.json" <<'NODE'
const p=JSON.parse(require('node:fs').readFileSync(process.argv[2]));if((p.data??p).status!=='ready')process.exit(1);console.log('Main gateway restored.');
NODE

# 正式入口验证恢复后才停止独立测试项目；保留数据库卷。
"${test_api[@]}" down
test "$(docker network inspect -f '{{index .Labels "mooyu.desktop-auth-test"}}' "$DESKTOP_AUTH_INGRESS_NETWORK")" = ingress-v1
test "$(docker network inspect -f '{{len .Containers}}' "$DESKTOP_AUTH_INGRESS_NETWORK")" = 0
docker network rm "$DESKTOP_AUTH_INGRESS_NETWORK"
```

保留备份目录、网关旧镜像标签、镜像归档及测试数据库卷。不删除 Caddy 证书卷，不使用 `docker system prune`。如果旧镜像确实不在，可从自己的 `gateway-image.tar` 执行 `docker image load -i` 后再回退。回退后 web 暂时使用备份配置文件挂载；后续恢复普通发布流程前，先确认镜像内 Caddyfile 与此基线一致。

## 本地验证与范围

```powershell
node --test tests/platform/desktop-auth-caddy.test.mjs tests/platform/desktop-auth-test-instance.test.mjs
node scripts/verify-desktop-clean.mjs
node scripts/verify-desktop-auth-instance.mjs --caddy
```

最终本机验证使用随机 Compose 项目、全新 PostgreSQL/Redis、私有入口网络及回环测试证书。带 AliDNS 的真实配置先在 `--network none` 下使用占位凭据校验；修正后的代理测试显式关闭自动 HTTPS 管理，只使用静态测试证书，不访问阿里云或 ACME。另比较正式 Compose 的展开前后模型，确保仅 web 的镜像固定、挂载和网络改变，原有环境、端口、证书卷及其他服务保持相同。Caddy 重启、无效配置拒绝和配置回退都在本机项目验证，不代表公网 DNS 签发、服务器当前网关基线或真实 OAuth 已验收。

2026-11-01 最终本地结果：62 项相关回归与命令文档 Bash 语法检查通过。隔离 Docker 集成完成 158 项迁移、12 项检查，含真实 Caddy TLS 代理、现有模拟主机名保留、重启持久性、无效 reload 拒绝及回滚；临时容器、卷和外部入口网络均已清理。报告 `.runtime/desktop-auth-test/mooyu-auth-check-1793540058512/report.json`。测试运行配置显式使用 `auto_https off` 并加载覆盖保留示例主机名的静态测试证书，仍校验 CA 和主机名。

早期一次本机测试仅关闭了自动跳转，Caddy 对不匹配静态证书的示例域名尝试了 ACME 注册和签发，签发被拒绝；该项目已清理，未使用正式域名、生产凭据或生产数据库。最终验证已明确关闭自动 HTTPS 管理，避免再次进行该请求。不能将早期测试描述为全程没有外部 ACME 请求。

2026-11-01 P2 修复后复验：70 项候选回归与独立目录构建通过；交付范围由 `scripts/desktop-auth-scope.json` 明确为 66 个文件，暂缓 10 个旧 D1/诊断依赖文件。候选清单在 HEAD 导出的源码树中生成，正文摘要统一 LF，排除工作区暂缓 API 增补。最新独立检查索引为 `.runtime/desktop-auth-clean/latest.json`。

使用候选源码树构建的 API 镜像完成 158 项迁移、15 项 Docker 检查，报告 `.runtime/desktop-auth-test/mooyu-auth-check-1793542350930/report.json`。新增验证 Redis 停止后的并发 503、有界探针、API 退出码 0 和恢复；回调上游连接失败及响应头超时的默认错误日志保留路径/状态但不含查询串、Referer、Authorization、Cookie 原值，包含编码、重复和畸形查询负例；成功代理仍原样转发 OAuth 参数。测试容器、卷、慢上游与入口网络均已清理，没有操作线上网关。

日志过滤采用 Caddy 默认运行日志的 filter/regexp 编码器，作用于日志输出而不改 HTTP 请求；支持说明见 [Caddy 日志编码过滤](https://caddyserver.com/docs/caddyfile/directives/log#filter)。

配置校验与 reload 的语义参考 [Caddy 官方命令行文档](https://caddyserver.com/docs/command-line)；覆盖文件路径相对于第一个 Compose 文件解析，所有新增挂载因此使用绝对路径，参考 [Docker Compose 合并规则](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)。
