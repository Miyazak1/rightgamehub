#!/bin/sh
# Existing production installation only. Keep cloud data and volumes intact.
set -eu
umask 077
cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-.env.prod}
BACKUP_ROOT=${BACKUP_ROOT:-/www/backup/gamehub}
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null
# Shell overrides also exclude optional profiles supplied by the env file.
export CLOUD_SAVE_ENABLED=false
export COMPOSE_PROFILES=
compose() { docker compose --parallel 1 --env-file "$ENV_FILE" -f compose.prod.yml "$@"; }
compose config --quiet
compose exec -T postgres pg_isready -U gamehub -d gamehub >/dev/null

# Persist the off switch for later ordinary deployments without logging secrets.
env_tmp=$(mktemp "${ENV_FILE}.local-only.XXXXXX")
trap '[ -z "${env_tmp:-}" ] || rm -f -- "$env_tmp"' EXIT HUP INT TERM
awk '!/^[[:space:]]*(export[[:space:]]+)?CLOUD_SAVE_ENABLED[[:space:]]*=/' "$ENV_FILE" > "$env_tmp"
printf '\nCLOUD_SAVE_ENABLED=false\n' >> "$env_tmp"
mv -- "$env_tmp" "$ENV_FILE"
env_tmp=

# Stop old optional cloud jobs if they exist; preserve containers and data.
compose --profile save-operations stop -t 60 save-maintenance save-storage-probe
# Serialize image builds on the current machine; do not add replicas/resources.
compose build

mkdir -p "$BACKUP_ROOT"
backup="$BACKUP_ROOT/before-local-saves-$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T postgres pg_dump -U gamehub -d gamehub -Fc -Z1 > "$backup.partial"
compose exec -T postgres pg_restore --list < "$backup.partial" >/dev/null
mv -- "$backup.partial" "$backup"
echo "Database backup: $backup"

# Existing 0047-0049 are additive. There is no new local-only migration.
compose run --rm --no-deps migrate
compose up -d --no-build --wait --wait-timeout 180
compose exec -T api node --input-type=module -e '
const ready = await fetch("http://127.0.0.1:3090/ready");
const body = await ready.json();
if (!ready.ok || body.data?.saves?.mode !== "local" || body.data?.saves?.cloudEnabled !== false || !body.data?.migrations?.ready) throw Error("Local-only readiness check failed");
const blocked = await fetch("http://127.0.0.1:3090/v1/me/save-library");
if (blocked.status !== 503 || (await blocked.json()).error?.code !== "CLOUD_SAVE_DISABLED") throw Error("Cloud isolation check failed");
console.log(JSON.stringify({status:body.data.status, saves:body.data.saves, migrations:body.data.migrations}));
'
compose ps
echo "Local-only update verified. Existing cloud data and local saves are retained."
