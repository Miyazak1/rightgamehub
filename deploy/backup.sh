#!/bin/sh
set -eu

cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-.env.prod}
BACKUP_ROOT=${BACKUP_ROOT:-./backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"
chmod 700 "$TARGET"

# Pause the existing worker so image GC cannot remove a file referenced by the dump.
# API reads and existing games remain available. Restore the worker's prior state.
WORKER_ID=$(docker compose --env-file "$ENV_FILE" -f compose.prod.yml ps -q worker)
WORKER_PAUSED=false
restore_worker() {
  if [ "$WORKER_PAUSED" = true ]; then
    docker compose --env-file "$ENV_FILE" -f compose.prod.yml start worker
  fi
}
trap restore_worker EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -n "$WORKER_ID" ]; then
  WORKER_PAUSED=true
  docker compose --env-file "$ENV_FILE" -f compose.prod.yml stop -t 60 worker
fi

docker compose --env-file "$ENV_FILE" -f compose.prod.yml exec -T postgres \
  pg_dump -U gamehub -d gamehub --format=custom > "$TARGET/database.dump"

for volume in avatars covers runtime-assets community-media; do
  docker run --rm -v "gamehub-production_${volume}:/source:ro" -v "$(cd "$TARGET" && pwd):/backup" alpine:3.22 \
    tar -C /source -czf "/backup/${volume}.tar.gz" .
done

if [ -d ../rules/current ]; then
  tar -C ../rules/current -czf "$TARGET/rules-current.tar.gz" .
fi

sha256sum "$TARGET"/* > "$TARGET/SHA256SUMS"
chmod 600 "$TARGET"/*
echo "Backup written to $TARGET"
