#!/usr/bin/env bash
# Initial, independent QQ deployment only. Never runs the website release flow.
set -Eeuo pipefail
# Docker Compose attaches stdin by default. Never let a child consume commands
# from an operator's enclosing bash heredoc. Explicit SQL heredocs still work.
exec </dev/null
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ "$ROOT" == /www/mooyu-qq ]] || { echo '请解压到 /www/mooyu-qq 后执行。'; exit 1; }
[[ $EUID -eq 0 ]] || { echo '请使用服务器管理员终端。'; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo '本包仅适用于 Linux x86_64。'; exit 1; }
[[ ! -L /www/mooyu-qq ]] || exit 1
mkdir -p /www/backup/gamehub
REPORT=$(mktemp -d /www/backup/gamehub/qq-server-install-XXXXXXXX)
exec > >(tee "$REPORT/run.log") 2>&1
stage=preflight
finish(){
  rc=$?; trap - EXIT
  printf '%s\n' "$rc" > "$REPORT/exit-code"
  printf '\n阶段：%s；退出码：%s\n完整日志：%s/run.log\n' "$stage" "$rc" "$REPORT"
  exit "$rc"
}
trap finish EXIT
exec 9>>/www/backup/gamehub/.unified-release.lock
flock -n 9 || { echo '有部署或清理任务正在运行，请稍后再执行。'; exit 1; }
exec 8>>"$ROOT/.qq-install.lock"
flock -n 8 || exit 1
cd "$ROOT"
[[ ! -e .installed ]] || { echo '已有 QQ 安装记录，已停止；不会覆盖数据或配置。'; exit 1; }
command -v docker >/dev/null
docker compose version
systemctl is-enabled --quiet docker || { echo '请先配置 Docker 随系统启动，再继续。此脚本不会重启 Docker。'; exit 1; }
for unit in mooyu-qq-backup.service mooyu-qq-backup.timer; do
  [[ ! -e /etc/systemd/system/$unit ]] || { echo '发现已有 QQ 备份服务配置，拒绝覆盖。'; exit 1; }
done
python3 - <<'PY'
from pathlib import Path
import os,shutil,json
root=Path('/www/mooyu-qq')
for name in ['.env','worker.env','config.json','seed.sql','images.tar','SHA256SUMS','compose.yml']:
 p=root/name
 if p.is_symlink() or not p.is_file(): raise SystemExit('安装文件缺失或为链接：'+name)
if shutil.disk_usage(root).free < 8*1024**3: raise SystemExit('磁盘可用空间小于 8 GiB，停止。')
config=json.loads((root/'config.json').read_text())
if not config.get('enabled') or config.get('deployment')!='server' or len(config.get('allowedUsers',[]))!=1: raise SystemExit('白名单配置不符合首轮上线边界。')
values=dict(line.split('=',1) for line in (root/'worker.env').read_text().splitlines() if line and not line.startswith('#'))
for key in ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']:
 if values.get(key)!='false': raise SystemExit('论文开关必须保持关闭。')
if not values.get('QQ_DATABASE_URL','').startswith('postgresql://mooyu_qq:') or '@qq-postgres:5432/mooyu_qq_local_server' not in values['QQ_DATABASE_URL']: raise SystemExit('QQ 必须使用独立容器数据库。')
PY
sha256sum --check --quiet SHA256SUMS
chmod 600 .env worker.env seed.sql
chmod 644 config.json compose.yml
if ss -lntH | awk '{print $4}' | grep -E ':16099$' >/dev/null; then
  echo '16099 端口已占用，停止，避免影响已有服务。'; exit 1
fi
dc(){ docker compose --project-name mooyu-qq --env-file "$ROOT/.env" --file "$ROOT/compose.yml" "$@"; }
dc config --quiet
[[ -z $(docker ps -aq --filter label=com.docker.compose.project=mooyu-qq) ]] || { echo '发现已有 QQ 项目容器，拒绝首次安装覆盖。'; exit 1; }
[[ -z $(docker volume ls -q --filter name='^mooyu-qq_') ]] || { echo '发现已有 QQ 数据卷，拒绝首次安装覆盖。'; exit 1; }
stage=load-images
docker load --input images.tar
python3 - <<'PY'
import json,subprocess
from pathlib import Path
for image in json.loads(Path('images.json').read_text()):
 actual=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',image['tag']],text=True).strip()
 if actual!=image['id']: raise SystemExit('镜像身份不符，停止。')
PY
stage=database
dc up -d postgres
ready=false
for attempt in $(seq 1 60); do
  if dc exec -T postgres pg_isready -U mooyu_qq -d mooyu_qq_local_server >/dev/null 2>&1; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]] || { echo '独立数据库未就绪，已停止。'; exit 1; }
existing=$(dc exec -T postgres psql -U mooyu_qq -d mooyu_qq_local_server -Atc "SELECT count(*) FROM pg_namespace WHERE nspname='mooyu_qq'")
[[ "$existing" == 0 ]] || { echo '发现已有 QQ 数据，拒绝覆盖。请保留日志后排查。'; exit 1; }
stage=restore-history
dc exec -T postgres psql -U mooyu_qq -d mooyu_qq_local_server --quiet --single-transaction -v ON_ERROR_STOP=1 < seed.sql
dc run --rm --no-deps worker node apps/qq-channel/src/cli.mjs /config/config.json --init
dc run --rm --no-deps worker node apps/qq-channel/src/cli.mjs /config/config.json --status
stage=start
dc up -d worker napcat
dc ps
stage=backup
bash "$ROOT/backup.sh"
install -m 644 "$ROOT/mooyu-qq-backup.service" /etc/systemd/system/mooyu-qq-backup.service
install -m 644 "$ROOT/mooyu-qq-backup.timer" /etc/systemd/system/mooyu-qq-backup.timer
systemctl daemon-reload
systemctl enable --now mooyu-qq-backup.timer
printf '%s\n' "$(date -Is)" > .installed
stage=awaiting-qq-login
echo '独立 QQ 服务已启动，历史与预算已恢复。下一步登录服务器 NapCat 后再连接 QQ。'
echo '管理入口仅绑定 127.0.0.1:16099，请通过 SSH 隧道访问；不要开放公网管理端口。'
echo '现有网站容器、数据库、配置及论文开关未修改。'
