#!/usr/bin/env bash
# Run a pinned, reviewed unified release; keep server configuration and history.
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: bash update-blog-editorial-continuity.sh FULL_COMMIT_SHA [BUNDLE]}
ARCHIVE=${2:-/www/backup/gamehub/incoming/mooyu-unified-20261116-desktop-parity.tar.gz}
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]]
RUN_DIR=$(cd "$(dirname "$0")" && pwd)
[[ "$RUN_DIR" == /www/backup/gamehub/update-editorial-* ]] || {
  echo '先将本脚本提取到 /www/backup/gamehub/update-editorial-* 私有日志目录。'; exit 1;
}
PHASE=preflight
finish() {
  rc=$?
  trap - EXIT
  printf '%s\n' "$rc" > "$RUN_DIR/exit-code"
  printf '%s\n' "$PHASE" > "$RUN_DIR/phase"
  printf '\nFinished: %s; phase=%s; exit-code=%s\n' "$(date --iso-8601=seconds)" "$PHASE" "$rc"
  docker ps -a --filter label=com.docker.compose.project=gamehub-production \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
  for service in api agent-blog-public-scheduler; do
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      docker logs --timestamps --tail 200 "$id" > "$RUN_DIR/$service-$id.log" 2>&1 || true
    done < <(docker ps -aq --filter label=com.docker.compose.project=gamehub-production \
      --filter "label=com.docker.compose.service=$service")
  done
  printf '\n完整日志：%s/deploy.log\n' "$RUN_DIR"
  exit "$rc"
}
trap finish EXIT
cd /www/gamehub
test -f deploy/.env.prod
test -z "$(git status --porcelain)" || { echo '线上工作区有修改，停止；不会 reset 或 clean。'; exit 1; }
git cat-file -e "$EXPECTED^{commit}"
git merge-base --is-ancestor "$EXPECTED" origin/codex/release-practice-no-paper
git merge-base --is-ancestor HEAD "$EXPECTED"
test -f "$ARCHIVE" && test ! -L "$ARCHIVE"
sha256sum deploy/.env.prod > "$RUN_DIR/config-before.sha256"
cp -p deploy/.env.prod "$RUN_DIR/env.before"
chmod 600 "$RUN_DIR/env.before"
git rev-parse HEAD > "$RUN_DIR/previous-commit"
printf '%s\n' "$EXPECTED" > "$RUN_DIR/target-commit"
export BUILDKIT_PROGRESS=plain COMPOSE_ANSI=never NO_COLOR=1
mapfile -t api_ids < <(docker ps -q --filter label=com.docker.compose.project=gamehub-production \
  --filter label=com.docker.compose.service=api)
[ "${#api_ids[@]}" -eq 1 ]
PLATFORM_ASSISTANT_ENABLED=$(docker exec "${api_ids[0]}" node -e 'console.log(process.env.PLATFORM_ASSISTANT_ENABLED??"false")')
[[ "$PLATFORM_ASSISTANT_ENABLED" = true || "$PLATFORM_ASSISTANT_ENABLED" = false ]]
export PLATFORM_ASSISTANT_ENABLED
git show "$EXPECTED:deploy/prepare-unified-release.sh" > "$RUN_DIR/prepare.sh"
PHASE=update
bash "$RUN_DIR/prepare.sh" "$EXPECTED" "$ARCHIVE"
printf '0\n' > "$RUN_DIR/update-exit-code"

PHASE=verify
exec 8>/www/backup/gamehub/.unified-release.lock
flock -n 8 || { echo '存在其他部署；本次不恢复调度。'; exit 1; }
sha256sum --check --status "$RUN_DIR/config-before.sha256"
: > "$RUN_DIR/verified-source-sha256.txt"
for service in api agent-blog-public-scheduler; do
  mapfile -t ids < <(docker ps -q --filter label=com.docker.compose.project=gamehub-production \
    --filter "label=com.docker.compose.service=$service")
  [ "${#ids[@]}" -eq 1 ] || { echo "Expected one running $service; no scheduler resume."; exit 1; }
  for file in agent-blog-foundation-generation.mjs agent-blog-candidate-discovery.mjs \
    agent-editorial-memory-repository.mjs agent-blog-private-canary-manual-run.mjs \
    agent-blog-public-runtime-manual-run.mjs agent-blog-public-schedule.mjs agent-runtime-repository.mjs \
    agent-blog-public-request-repository.mjs agent-blog-public-runtime.mjs agent-blog-foundation-workflows.mjs; do
    expected=$(git show "$EXPECTED:apps/api/src/$file" | sha256sum | awk '{print $1}')
    actual=$(docker exec "${ids[0]}" sha256sum "/app/apps/api/src/$file" | awk '{print $1}')
    [ "$expected" = "$actual" ] || { echo "Running source mismatch: $service $file"; exit 1; }
    printf '%s %s %s\n' "$service" "$actual" "$file" >> "$RUN_DIR/verified-source-sha256.txt"
  done
  docker exec "${ids[0]}" node -e '
    for(const key of ["PAPER_STUDY_ENABLED","PAPER_STUDY_WORKER_ENABLED","PAPER_STUDY_MODELS_ENABLED","PAPER_STUDY_PUBLISH_ENABLED"]){
      if((process.env[key]??"false")!=="false")throw Error(key+" must remain false");
    }
    console.log(JSON.stringify({service:process.argv[1],paperEnabled:false}));' "$service"
done
PHASE=bootstrap
# Registers the new result-contract version; creates no Run, paper job or publication.
docker exec "${ids[0]}" node /app/apps/api/src/agent-blog-public-runtime-bootstrap-cli.mjs
printf '0\n' > "$RUN_DIR/bootstrap-exit-code"
printf '0\n' > "$RUN_DIR/verify-exit-code"
if [ "${RESUME_BLOG_SCHEDULE:-false}" = true ]; then
  PHASE=resume
  bash deploy/resume-blog-public.sh
  printf '0\n' > "$RUN_DIR/resume-exit-code"
fi
PHASE=complete
echo '更新与源码校验完成；历史记忆、线上数据和配置保留，论文保持关闭。'
