#!/usr/bin/env bash
# Existing installation only; code is fetched by the operator before this script.
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: prepare-unified-release.sh FULL_SHA /absolute/path/to/bundle.tar.gz}
ARCHIVE=${2:?Upload the verified release bundle outside the Git checkout first}
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ "$ARCHIVE" = /* && "$ARCHIVE" != *$'\n'* && -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || { echo 'Expected a regular absolute bundle path'; exit 1; }
cd /www/gamehub
mkdir -p /www/backup/gamehub
exec 9>/www/backup/gamehub/.unified-release.lock
flock -n 9 || { echo 'Another unified deployment is active; stop without changing services.'; exit 1; }
test -f deploy/.env.prod
test -z "$(git status --porcelain)" || { echo 'Production checkout has local edits. Stop; no reset/clean.'; exit 1; }
git cat-file -e "$EXPECTED^{commit}"
git merge-base --is-ancestor HEAD "$EXPECTED" || { echo 'Production commit is not included in this release'; exit 1; }
test -z "$(git diff --name-only --diff-filter=MD HEAD "$EXPECTED" -- apps/api/migrations)" || { echo 'Old migrations changed'; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RECORD="/www/backup/gamehub/unified-$STAMP"
mkdir -p "$RECORD/incoming"
git show "$EXPECTED":config/unified-release.json > "$RECORD/release.json"
SUM=$(sed -n 's/^  "archiveSha256": "\([a-f0-9]\{64\}\)",\{0,1\}$/\1/p' "$RECORD/release.json")
[[ "$SUM" =~ ^[a-f0-9]{64}$ ]] || { echo 'Release checksum unavailable'; exit 1; }
printf '%s  %s\n' "$SUM" "$ARCHIVE" | sha256sum --check --status || { echo 'Bundle checksum mismatch; no code/services changed'; exit 1; }
# Only our fixed, hashed archive is extracted; reject links and traversal too.
tar -tzf "$ARCHIVE" | while IFS= read -r name; do
  [[ "$name" =~ ^(\./)?[A-Za-z0-9._/-]+$ && "$name" != /* && ! "$name" =~ (^|/)\.\.(/|$) ]] || exit 1
done
tar -tvzf "$ARCHIVE" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}'
tar -xzf "$ARCHIVE" -C "$RECORD/incoming" --no-same-owner --no-same-permissions
WEB=$(docker ps -q --filter label=com.docker.compose.project=gamehub-production --filter label=com.docker.compose.service=web)
API=$(docker ps -q --filter label=com.docker.compose.project=gamehub-production --filter label=com.docker.compose.service=api)
test -n "$WEB" && test -n "$API"
if [ "${PLATFORM_ASSISTANT_ENABLED:-false}" = true ]; then
  # Resolve the existing server key without printing it or passing it in argv.
  docker compose --project-name gamehub-production --env-file deploy/.env.prod -f deploy/compose.prod.yml config --format json |
    docker exec -i "$API" node -e 'let text="";process.stdin.on("data",part=>text+=part);process.stdin.on("end",()=>{try{if(!JSON.parse(text).services.api.environment.DEEPSEEK_API_KEY?.trim())process.exit(1);}catch{process.exit(1);}});' || {
      echo 'Configure DEEPSEEK_API_KEY privately in deploy/.env.prod first, or explicitly leave PLATFORM_ASSISTANT_ENABLED=false. No services changed.' >&2; exit 1;
    }
fi
CONFIG_FILES=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$WEB")
test -n "$CONFIG_FILES" && [ "$CONFIG_FILES" != '<no value>' ]
IFS=',' read -r -a files <<< "$CONFIG_FILES"
: > "$RECORD/compose-files.rollback.txt"
: > "$RECORD/compose-files.target.txt"
count=0
for file in "${files[@]}"; do
  [[ "$file" = /* && "$file" != *$'\n'* && -f "$file" ]] || { echo 'Running Compose configuration unavailable'; exit 1; }
  cp "$file" "$RECORD/compose-$count.before.yml"
  printf '%s\n' "compose-$count.before.yml" >> "$RECORD/compose-files.rollback.txt"
  # A previous rollback leaves snapshot paths and rollback image overrides in
  # the running containers' labels. Retain every file for rollback, but do not
  # build the new release into the previous rollback's immutable image tags.
  case "$file" in
    /www/backup/gamehub/*/rollback-images.yml)
      test -s "$(dirname "$file")/rollback.sh" && test -s "$(dirname "$file")/release-commit.txt" || {
        echo 'Unrecognized rollback overlay; stop without changing services.' >&2; exit 1;
      }
      ;;
    /www/backup/gamehub/*/compose-0.before.yml)
      if [ "$count" = 0 ] && [ -s "$(dirname "$file")/compose-files.rollback.txt" ]; then
        printf '%s\n' /www/gamehub/deploy/compose.prod.yml >> "$RECORD/compose-files.target.txt"
      else
        printf '%s\n' "$file" >> "$RECORD/compose-files.target.txt"
      fi
      ;;
    *) printf '%s\n' "$file" >> "$RECORD/compose-files.target.txt" ;;
  esac
  count=$((count+1))
done
grep -Fxq /www/gamehub/deploy/compose.unified-downloads.yml "$RECORD/compose-files.target.txt" || printf '%s\n' /www/gamehub/deploy/compose.unified-downloads.yml >> "$RECORD/compose-files.target.txt"
mount_source() { docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$1\"}}{{println .Source}}{{end}}{{end}}" "$WEB"; }
DESKTOP_DOWNLOADS_DIR=$(mount_source /srv/desktop-downloads)
AGENT_DOWNLOADS_DIR=$(mount_source /srv/agent-downloads)
DESKTOP_DOWNLOADS_DIR=${DESKTOP_DOWNLOADS_DIR:-/www/gamehub-downloads/desktop}
AGENT_DOWNLOADS_DIR=${AGENT_DOWNLOADS_DIR:-/www/gamehub-downloads/agent}
for directory in "$DESKTOP_DOWNLOADS_DIR" "$AGENT_DOWNLOADS_DIR"; do
  [[ "$directory" = /* && "$directory" != / && "$directory" != *$'\n'* && ! -L "$directory" ]] || exit 1
  install -d -m 755 "$directory"
done
export DESKTOP_DOWNLOADS_DIR AGENT_DOWNLOADS_DIR
printf 'export DESKTOP_DOWNLOADS_DIR=%q\nexport AGENT_DOWNLOADS_DIR=%q\n' "$DESKTOP_DOWNLOADS_DIR" "$AGENT_DOWNLOADS_DIR" > "$RECORD/downloads-environment.sh"
git show "$EXPECTED":deploy/pin-running-image.sh > "$RECORD/pin-running-image.sh"
source "$RECORD/pin-running-image.sh"
TOOL_IMAGE="mooyu-unified-tools:${STAMP,,}"
pin_running_image "$API" "$TOOL_IMAGE"
git show "$EXPECTED":deploy/unified-assets.mjs > "$RECORD/assets-tool.mjs"
tool() {
  docker run --rm --network none --user 0 --entrypoint node --memory 512m --cpus 1 \
    -v "$RECORD:/work" -v "$DESKTOP_DOWNLOADS_DIR:/desktop" -v "$AGENT_DOWNLOADS_DIR:/agent" \
    "$TOOL_IMAGE" /work/assets-tool.mjs "$1" /work/incoming /desktop /agent /work/assets-record /work/release.json
}
tool verify
tool stage
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  printf '%q ' docker run --rm --network none --user 0 --entrypoint node --memory 512m --cpus 1 \
    -v "$RECORD:/work" -v "$DESKTOP_DOWNLOADS_DIR:/desktop" -v "$AGENT_DOWNLOADS_DIR:/agent" \
    "$TOOL_IMAGE" /work/assets-tool.mjs rollback /work/incoming /desktop /agent /work/assets-record /work/release.json
  printf '\n'
} > "$RECORD/restore-downloads.sh"
chmod 700 "$RECORD/restore-downloads.sh"
recover() {
  status=$?; trap - ERR
  if [ -f "$RECORD/assets-record/pointers-activation-started" ]; then bash "$RECORD/restore-downloads.sh" || true; fi
  if [ -f "$RECORD/activation-started" ] && [ -x "$RECORD/rollback.sh" ]; then bash "$RECORD/rollback.sh" || echo "Run: bash $RECORD/rollback.sh"; fi
  echo "Unified release stopped ($status). Record: $RECORD" >&2
  exit "$status"
}
trap recover ERR
git show "$EXPECTED":deploy/prepare-practice-release.sh > "$RECORD/prepare-practice-release.sh"
export MOOYU_UNIFIED_RELEASE_RECORD="$RECORD" MOOYU_RELEASE_COMPOSE_FILES="$RECORD/compose-files.target.txt"
bash "$RECORD/prepare-practice-release.sh" "$EXPECTED"
tool activate
# Confirm that the active gateway serves the exact tested bytes, not SPA HTML.
NEW_WEB=$(docker ps -q --filter label=com.docker.compose.project=gamehub-production --filter label=com.docker.compose.service=web)
DOMAIN=$(docker exec "$NEW_WEB" printenv APP_DOMAIN)
HTTPS_PORT=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "443/tcp") 0).HostPort}}' "$NEW_WEB")
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$HTTPS_PORT" =~ ^[0-9]+$ ]]
curl --fail --silent --show-error --retry 2 --max-time 60 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT/downloads/manifest.json" > "$RECORD/served-agent.json"
curl --fail --silent --show-error --retry 2 --max-time 60 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT/downloads/desktop/manifest.json" > "$RECORD/served-desktop.json"
cmp "$RECORD/served-agent.json" "$AGENT_DOWNLOADS_DIR/manifest.json"
cmp "$RECORD/served-desktop.json" "$DESKTOP_DOWNLOADS_DIR/manifest.json"
printf '%s\n' "$EXPECTED" > "$RECORD/unified-release-complete"
trap - ERR
echo "Unified release ready. Rollback: bash $RECORD/rollback.sh"
echo 'Restart Agent hosts to activate plugin updates. Desktop preview.3 users install the new preview once manually.'
