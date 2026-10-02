#!/bin/sh
set -eu

cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-.env.prod}
BACKUP_ROOT=${BACKUP_ROOT:-./backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"
chmod 700 "$TARGET"

docker compose --env-file "$ENV_FILE" -f compose.prod.yml exec -T postgres \
  pg_dump -U gamehub -d gamehub --format=custom > "$TARGET/database.dump"

for volume in avatars covers runtime-assets; do
  docker run --rm -v "gamehub-production_${volume}:/source:ro" -v "$(cd "$TARGET" && pwd):/backup" alpine:3.22 \
    tar -C /source -czf "/backup/${volume}.tar.gz" .
done

if [ -d ../rules/current ]; then
  tar -C ../rules/current -czf "$TARGET/rules-current.tar.gz" .
fi

sha256sum "$TARGET"/* > "$TARGET/SHA256SUMS"
chmod 600 "$TARGET"/*
echo "Backup written to $TARGET"
