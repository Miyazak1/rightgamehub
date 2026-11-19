#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ "$ROOT" == /www/mooyu-qq && $EUID -eq 0 ]] || exit 1
DEST=/www/backup/gamehub/qq-database
[[ ! -L "$DEST" ]] || exit 1
mkdir -p "$DEST"
exec 9>>"$ROOT/.qq-backup.lock"
flock -n 9 || exit 1
name="qq-$(date -u +%Y%m%dT%H%M%SZ)-$$"
docker compose --project-name mooyu-qq --env-file "$ROOT/.env" --file "$ROOT/compose.yml" exec -T postgres pg_dump -U mooyu_qq -d mooyu_qq_local_server --schema=mooyu_qq --no-owner --no-acl | gzip > "$DEST/$name.sql.gz.partial"
gzip -t "$DEST/$name.sql.gz.partial"
mv -- "$DEST/$name.sql.gz.partial" "$DEST/$name.sql.gz"
sha256sum "$DEST/$name.sql.gz" > "$DEST/$name.sha256"
printf 'QQ 数据库备份完成：%s/%s.sql.gz\n' "$DEST" "$name"
# Never prune backups automatically. Retention is an explicit operator decision.
