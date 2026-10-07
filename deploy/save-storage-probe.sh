#!/bin/sh
set -eu
export LC_ALL=C PGCONNECT_TIMEOUT=3 PGOPTIONS='-c statement_timeout=3000 -c lock_timeout=500'
PGDATA=${PGDATA:-/var/lib/postgresql/data}
export PGDATA
if [ "${1:-}" = "--sample" ]; then
  # Read the watermark BEFORE measuring the filesystem.
  sample=$(psql -XAt -F '|' -v ON_ERROR_STOP=1 -c "SELECT clock_timestamp(),system_identifier,(SELECT storage_write_bytes FROM game_save_capacity WHERE singleton),(SELECT COALESCE(sum(size),0) FROM pg_ls_waldir()),(SELECT count(*) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''),pg_is_in_recovery() FROM pg_control_system()")
  IFS='|' read -r stamp cluster baseline wal tablespaces recovery <<EOF
$sample
EOF
  local_cluster=$(pg_controldata "$PGDATA" | awk -F ': *' '/^Database system identifier:/{print $2}')
  [ "$local_cluster" = "$cluster" ]
  [ "$tablespaces" = 0 ]
  [ "$recovery" = f ]
  [ "$(readlink -f "$PGDATA/pg_wal")" = "$(readlink -f "$PGDATA")/pg_wal" ]
  [ "$(stat -c %d "$PGDATA")" = "$(stat -c %d "$PGDATA/pg_wal")" ]
  [ "$(stat -c %d "$PGDATA")" = "$(stat -c %d "$PGDATA/base")" ]
  disk=$(df -Pk "$PGDATA" | awk 'NR==2 {printf "%.0f %.0f",$2*1024,$4*1024}')
  inodes=$(df -Pi "$PGDATA" | awk 'NR==2 {print $2,$4}')
  read -r total available <<EOF
$disk
EOF
  read -r inode_total inode_available <<EOF
$inodes
EOF
  for value in "$cluster" "$baseline" "$wal" "$total" "$available" "$inode_total" "$inode_available"; do
    case "$value" in ''|*[!0-9]*) exit 1;; esac
  done
  psql -XAt -v ON_ERROR_STOP=1 -v stamp="$stamp" -v cluster="$cluster" -v baseline="$baseline" -v wal="$wal" \
    -v total="$total" -v available="$available" -v inodes="$inode_total" -v free_inodes="$inode_available" <<'SQL'
SELECT record_game_save_storage(:'stamp'::timestamptz,:'cluster',:'total'::bigint,:'available'::bigint,:'inodes'::bigint,:'free_inodes'::bigint,:'wal'::bigint,:'baseline'::bigint);
SQL
  exit
fi
sample_once() {
  if timeout 10 sh "$0" --sample >/dev/null 2>&1; then
    echo '{"event":"save_storage_probe","status":"ok"}'
  else
    echo '{"event":"save_storage_probe","status":"error","code":"PROBE_UNAVAILABLE"}'
    return 1
  fi
}
if [ "${1:-}" = "--once" ]; then sample_once; exit; fi
trap 'exit 0' INT TERM
while :; do sample_once || true; sleep 15 & wait $! || true; done
