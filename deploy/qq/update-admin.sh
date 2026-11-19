#!/usr/bin/env bash
set -Eeuo pipefail
exec </dev/null
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $EUID -eq 0 && "$ROOT" == /www/backup/gamehub/update-qq-admin-*/payload ]] || { echo '请在已校验的私有更新目录执行。'; exit 1; }
REPORT=$(dirname "$ROOT")
exec > >(tee -a "$REPORT/deploy.log") 2>&1
finish(){ rc=$?; trap - EXIT; printf '%s\n' "$rc" > "$REPORT/exit-code"; printf '\n退出码：%s\n完整日志：%s/deploy.log\n' "$rc" "$REPORT"; exit "$rc"; }
trap finish EXIT
exec 9>>/www/backup/gamehub/.unified-release.lock
flock -n 9 || { echo '其他部署或清理任务正在执行，停止。'; exit 1; }
cd "$ROOT"
sha256sum --check --quiet SHA256SUMS
python3 "$ROOT/update-admin.py" "$ROOT" "$REPORT"
