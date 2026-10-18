#!/bin/sh
set -eu

cd "$(dirname "$0")"
MODE=${1:---report}
PRUNE_AGE_HOURS=${PRUNE_AGE_HOURS:-168}
BACKUP_ROOT=${BACKUP_ROOT:-/www/backup/gamehub}

case "$MODE" in
  --report|--apply) ;;
  *) echo "Usage: $0 [--report|--apply]" >&2; exit 2 ;;
esac
case "$PRUNE_AGE_HOURS" in
  ''|*[!0-9]*) echo "PRUNE_AGE_HOURS must be a positive integer." >&2; exit 2 ;;
esac
if [ "$PRUNE_AGE_HOURS" -lt 24 ]; then
  echo "PRUNE_AGE_HOURS must be at least 24 hours." >&2
  exit 2
fi

report() {
  echo "== root filesystem =="
  df -hT / || true
  echo "== docker usage =="
  docker system df -v || true
  echo "== container writable layers =="
  docker ps -a --size || true
  echo "== large host directories =="
  du -xhd1 /var/lib/docker /var/log /www 2>/dev/null | sort -h || true
  echo "== system journal =="
  journalctl --disk-usage 2>/dev/null || true
  if [ -d "$BACKUP_ROOT" ]; then
    echo "== local backups =="
    du -xhd1 "$BACKUP_ROOT" 2>/dev/null | sort -h || true
  fi
}

if [ "$MODE" = "--report" ]; then
  report
  echo "Report only. No files, images, containers, or volumes were removed."
  exit 0
fi

echo "== usage before maintenance =="
df -hT / || true
docker system df || true
echo "== removing rebuildable Docker residue older than ${PRUNE_AGE_HOURS} hours =="
docker container prune -f --filter "until=${PRUNE_AGE_HOURS}h"
docker image prune -f --filter "until=${PRUNE_AGE_HOURS}h"
docker builder prune -f --filter "until=${PRUNE_AGE_HOURS}h"

echo "Docker volumes, named data volumes, active images, and backups were not removed."
echo "== usage after maintenance =="
df -hT / || true
docker system df || true
