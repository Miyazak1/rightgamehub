#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=${ENV_FILE:-$SCRIPT_DIR/.env.prod}
RULES_ROOT=${RULES_ROOT:-$REPO_ROOT/rules}
COMPOSE_FILE=$SCRIPT_DIR/compose.prod.yml
COMMAND=${1:-}

usage() {
  echo "Usage: deploy/rules-release.sh install <signed-release-dir> | rollback | status" >&2
  exit 1
}

[ -n "$COMMAND" ] || usage
[ -f "$ENV_FILE" ] || { echo "Missing production env file: $ENV_FILE" >&2; exit 1; }

set -a
. "$ENV_FILE"
set +a

[ -n "${RULES_TRUSTED_KEYS_JSON:-}" ] || { echo "RULES_TRUSTED_KEYS_JSON is required." >&2; exit 1; }
printf '%s' "$RULES_TRUSTED_KEYS_JSON" | grep -q 'PRIVATE KEY' && { echo "RULES_TRUSTED_KEYS_JSON must never contain a private key." >&2; exit 1; }

mkdir -p "$RULES_ROOT"
RULES_ROOT=$(CDPATH= cd -- "$RULES_ROOT" && pwd)
mkdir -p "$RULES_ROOT/releases"
LOCK_DIR=$RULES_ROOT/.release.lock
mkdir "$LOCK_DIR" 2>/dev/null || { echo "Another rules release operation is active." >&2; exit 1; }
umask 077
KEYS_FILE=$RULES_ROOT/.trusted-keys.$$
INCOMING_DIR=
printf '%s\n' "$RULES_TRUSTED_KEYS_JSON" > "$KEYS_FILE"
cleanup() {
  rm -f "$KEYS_FILE"
  if [ -n "$INCOMING_DIR" ] && [ "${INCOMING_DIR#"$RULES_ROOT/"}" != "$INCOMING_DIR" ]; then rm -rf "$INCOMING_DIR"; fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
manifest_sha() { sha256sum "$1" | awk '{print $1}'; }
container_path() {
  host_path=$1
  case "$host_path" in
    "$RULES_ROOT"/*) printf '/data/rules/%s' "${host_path#"$RULES_ROOT/"}" ;;
    *) echo "Rules operator path escapes RULES_ROOT: $host_path" >&2; exit 1 ;;
  esac
}
operator() { compose run --rm --no-deps -T rules-operator "$@"; }
set_env() {
  key=$1
  value=$2
  temporary="$ENV_FILE.rules-release.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0,key "=")==1 { print key "=" value; found=1; next }
    { print }
    END { if(!found) print key "=" value }
  ' "$ENV_FILE" > "$temporary"
  chmod --reference="$ENV_FILE" "$temporary" 2>/dev/null || chmod 600 "$temporary"
  mv -f "$temporary" "$ENV_FILE"
}
atomic_link() {
  target=$1
  link=$2
  temporary="$link.next.$$"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}
require_release_target() {
  target=$1
  digest=${target#releases/}
  if [ "$target" = "$digest" ] || [ "${#digest}" -ne 64 ] || ! printf '%s' "$digest" | grep -Eq '^[a-f0-9]{64}$'; then
    echo "Invalid immutable release pointer: $target" >&2
    exit 1
  fi
}
read_rules_sha() {
  service=$1
  port=$2
  compose exec -T "$service" node -e "fetch('http://127.0.0.1:$port/ready').then(async r=>{const p=await r.json();if(!r.ok||p.data?.status!=='ready')process.exit(2);process.stdout.write(p.data?.rules?.manifestSha256??'')}).catch(()=>process.exit(3))"
}
restart_and_verify() {
  expected=$1
  compose up -d --no-deps --force-recreate api realtime
  attempt=1
  while [ "$attempt" -le 30 ]; do
    api_sha=$(read_rules_sha api 3090 2>/dev/null || true)
    realtime_sha=$(read_rules_sha realtime 3093 2>/dev/null || true)
    if [ "$api_sha" = "$expected" ] && [ "$realtime_sha" = "$expected" ]; then
      printf 'API and Realtime loaded rules manifest sha256:%s\n' "$expected"
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "API and Realtime did not converge on rules manifest sha256:$expected." >&2
  return 1
}
materialize_manifest() {
  manifest=$1
  digest=$(manifest_sha "$manifest")
  target=$RULES_ROOT/releases/$digest
  if [ -d "$target" ]; then
    operator verify-release "$(container_path "$target")" "$(container_path "$KEYS_FILE")" >/dev/null
    [ "$(manifest_sha "$target/manifest.json")" = "$digest" ] || { echo "Existing immutable release digest mismatch: $target" >&2; exit 1; }
  else
    staging=$RULES_ROOT/releases/.staging-$digest-$$
    operator materialize "$(container_path "$manifest")" "$(container_path "$KEYS_FILE")" "$(container_path "$staging")" >/dev/null
    [ "$(manifest_sha "$staging/manifest.json")" = "$digest" ] || { echo "Materialized release digest mismatch." >&2; exit 1; }
    find "$staging" -type f -exec chmod 0444 {} \;
    find "$staging" -type d -exec chmod 0555 {} \;
    mv "$staging" "$target"
  fi
  printf '%s' "$digest"
}
configured_manifest_on_host() {
  case "${RULES_MANIFEST_PATH:-}" in
    /app/rules/*) printf '%s/%s' "$RULES_ROOT" "${RULES_MANIFEST_PATH#/app/rules/}" ;;
    *) printf '%s/manifest.json' "$RULES_ROOT" ;;
  esac
}

if [ "$COMMAND" = "status" ]; then
  [ "$#" -eq 1 ] || usage
  compose build rules-operator >/dev/null
  current=$(readlink "$RULES_ROOT/current" 2>/dev/null || true)
  previous=$(readlink "$RULES_ROOT/previous" 2>/dev/null || true)
  printf 'current=%s\nprevious=%s\nconfigured=%s\n' "${current:-none}" "${previous:-none}" "${RULES_MANIFEST_PATH:-none}"
  [ -n "$current" ] && operator verify-release /data/rules/current "$(container_path "$KEYS_FILE")"
  exit 0
fi

if [ "$COMMAND" = "install" ]; then
  [ "$#" -eq 2 ] || usage
  SOURCE_DIR=$(CDPATH= cd -- "$2" && pwd)
  [ -f "$SOURCE_DIR/manifest.json" ] || { echo "Signed release is missing manifest.json." >&2; exit 1; }
  [ "$SOURCE_DIR" != "$RULES_ROOT" ] || { echo "The signed release directory cannot be RULES_ROOT itself." >&2; exit 1; }
  compose build rules-operator >/dev/null
  INCOMING_DIR=$RULES_ROOT/.incoming-$$
  mkdir "$INCOMING_DIR"
  cp -R "$SOURCE_DIR/." "$INCOMING_DIR/"
  operator verify-release "$(container_path "$INCOMING_DIR")" "$(container_path "$KEYS_FILE")" >/dev/null

  old_env_path=${RULES_MANIFEST_PATH:-}
  old_target=$(readlink "$RULES_ROOT/current" 2>/dev/null || true)
  [ -z "$old_target" ] || require_release_target "$old_target"
  if [ -z "$old_target" ]; then
    legacy_manifest=$(configured_manifest_on_host)
    if [ -f "$legacy_manifest" ]; then
      legacy_digest=$(materialize_manifest "$legacy_manifest")
      old_target=releases/$legacy_digest
    fi
  fi
  old_digest=
  [ -n "$old_target" ] && old_digest=$(manifest_sha "$RULES_ROOT/$old_target/manifest.json")

  new_digest=$(materialize_manifest "$INCOMING_DIR/manifest.json")
  new_target=releases/$new_digest
  if [ "$old_target" = "$new_target" ]; then
    set_env RULES_MANIFEST_PATH /app/rules/current/manifest.json
    restart_and_verify "$new_digest"
    echo "Rules release sha256:$new_digest is already current and verified."
    exit 0
  fi

  atomic_link "$new_target" "$RULES_ROOT/current"
  set_env RULES_MANIFEST_PATH /app/rules/current/manifest.json
  if ! restart_and_verify "$new_digest"; then
    echo "New rules release failed readiness; restoring the previous release." >&2
    if [ -n "$old_target" ]; then atomic_link "$old_target" "$RULES_ROOT/current"; else rm -f "$RULES_ROOT/current"; fi
    set_env RULES_MANIFEST_PATH "$old_env_path"
    if [ -n "$old_digest" ]; then
      restart_and_verify "$old_digest" || echo "WARNING: the previous release was restored but did not become ready." >&2
    else
      compose up -d --no-deps --force-recreate api realtime
    fi
    exit 1
  fi
  if [ -n "$old_target" ]; then atomic_link "$old_target" "$RULES_ROOT/previous"; else rm -f "$RULES_ROOT/previous"; fi
  printf 'Rules release installed: sha256:%s\n' "$new_digest"
  exit 0
fi

if [ "$COMMAND" = "rollback" ]; then
  [ "$#" -eq 1 ] || usage
  current_target=$(readlink "$RULES_ROOT/current" 2>/dev/null || true)
  previous_target=$(readlink "$RULES_ROOT/previous" 2>/dev/null || true)
  [ -n "$current_target" ] && [ -n "$previous_target" ] || { echo "Both current and previous release pointers are required for rollback." >&2; exit 1; }
  require_release_target "$current_target"
  require_release_target "$previous_target"
  compose build rules-operator >/dev/null
  operator verify-release /data/rules/previous "$(container_path "$KEYS_FILE")" >/dev/null
  previous_digest=$(manifest_sha "$RULES_ROOT/previous/manifest.json")
  atomic_link "$previous_target" "$RULES_ROOT/current"
  atomic_link "$current_target" "$RULES_ROOT/previous"
  set_env RULES_MANIFEST_PATH /app/rules/current/manifest.json
  if ! restart_and_verify "$previous_digest"; then
    echo "Rollback target failed readiness; restoring the release that was current." >&2
    atomic_link "$current_target" "$RULES_ROOT/current"
    atomic_link "$previous_target" "$RULES_ROOT/previous"
    restart_and_verify "$(manifest_sha "$RULES_ROOT/current/manifest.json")" || true
    exit 1
  fi
  printf 'Rules release rolled back to sha256:%s\n' "$previous_digest"
  exit 0
fi

usage
