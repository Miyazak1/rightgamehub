#!/usr/bin/env bash
# Existing production installation: reviewed sharing, local saves, bounded images.
set -euo pipefail
trap 'status=$?; printf "更新中止（退出码 %s，脚本第 %s 行）。请保留末尾输出；不要 reset/clean。\n" "$status" "$LINENO" >&2; exit "$status"' ERR
umask 077
EXPECTED=${1:?Usage: bash update-community-sharing.sh FULL_COMMIT_SHA}
[[ "$EXPECTED" =~ ^[0-9a-f]{40}$ ]] || { echo '需要完整提交 SHA。'; exit 1; }
cd /www/gamehub
test -f deploy/.env.prod || { echo '缺少 /www/gamehub/deploy/.env.prod，停止更新。'; exit 1; }
test -z "$(git status --porcelain)" || { echo '工作区有改动，停止；不要 reset/clean。'; exit 1; }
CURRENT=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
printf '当前版本：%s；当前分支：%s；目标版本：%s\n' "$CURRENT" "${BRANCH:-detached HEAD}" "$EXPECTED"
git fetch origin codex/game-services-foundation
git merge-base --is-ancestor "$EXPECTED" origin/codex/game-services-foundation || { echo '目标版本不在已获取的发布分支中，停止更新。'; exit 1; }
git merge-base --is-ancestor "$CURRENT" "$EXPECTED" || { echo '目标版本未包含当前线上提交，停止更新以保留已有改动。请合并后再部署；不要强制切换或重置分支。'; exit 1; }
RECORD="$PWD/deploy/backups/community-open-posting-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RECORD"
printf '%s\n' "$CURRENT" > "$RECORD/previous-commit.txt"
printf '%s\n' "${BRANCH:-detached HEAD}" > "$RECORD/previous-branch.txt"
cp deploy/.env.prod "$RECORD/env.before"
# Keep the current local branch and only fast-forward to a release containing it.
git merge --ff-only "$EXPECTED"
test "$(git rev-parse HEAD)" = "$EXPECTED"
test -f apps/api/migrations/0055_game_share_links.sql

set_env() {
  sed -i -E "/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=/d" deploy/.env.prod
  printf '\n%s=%s\n' "$1" "$2" >> deploy/.env.prod
}
set_env COMMUNITY_ENABLED true
set_env COMMUNITY_POSTING_ENABLED true
set_env COMMUNITY_IMAGES_ENABLED true
set_env CLOUD_SAVE_ENABLED false
# Keep the existing quota; use a 512 MiB disk budget only when unconfigured.
if ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?COMMUNITY_MEDIA_BUDGET_BYTES[[:space:]]*=' deploy/.env.prod; then
  set_env COMMUNITY_MEDIA_BUDGET_BYTES 536870912
fi
export COMMUNITY_ENABLED=true COMMUNITY_POSTING_ENABLED=true COMMUNITY_IMAGES_ENABLED=true
export CLOUD_SAVE_ENABLED=false COMPOSE_PARALLEL_LIMIT=1 COMPOSE_PROJECT_NAME=gamehub-production COMPOSE_PROFILES=
dc() { docker compose --project-name gamehub-production --env-file deploy/.env.prod -f deploy/compose.prod.yml --profile community-images "$@"; }
dc config --quiet
test -n "$(dc ps --status running --quiet postgres)"
RUNNING=$(dc ps --status running --services)
SERVICES=(api worker runtime community-image web validator)
for service in source-worker rule-worker; do
  if printf '%s\n' "$RUNNING" | grep -qx "$service"; then SERVICES+=("$service"); fi
done

# Build serially, then back up DB and media before applying the additive migration.
dc build migrate api worker runtime source-worker rule-worker community-image web validator
BACKUP_ROOT="$RECORD/data" ENV_FILE=.env.prod sh deploy/backup.sh
dc run --rm --no-deps migrate
dc up -d --no-build --no-deps --wait --wait-timeout 180 "${SERVICES[@]}"
dc exec -T api node apps/api/src/install-competition-2048-cli.mjs | tee "$RECORD/2048-release.json"
dc exec -T api node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const get=async path=>{const response=await fetch('http://127.0.0.1:3090'+path,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);return (await response.json()).data;};
const ready=await get('/ready'),cap=await get('/v1/community/capabilities'),feed=await get('/v1/community/posts');
const shareRead=await fetch('http://127.0.0.1:3090/v1/game-shares/'+ 'A'.repeat(32));
assert.equal(shareRead.status,404);assert.equal((await shareRead.json()).error.code,'SHARE_UNAVAILABLE');
const shareCreate=await fetch('http://127.0.0.1:3090/v1/game-shares',{method:'POST',headers:{'Content-Type':'application/json','X-GameHub-Session':'A'.repeat(43)},body:JSON.stringify({title:'deployment check',payload:{}})});
assert.equal(shareCreate.status,401);assert.equal((await shareCreate.json()).error.code,'AUTH_REQUIRED');
assert.equal(new URL(process.env.GAME_SHARE_SITE_ORIGIN).protocol,'https:');
const tasks=await get('/v1/contribution-tasks?limit=1');assert.ok(Array.isArray(tasks));
const privateTasks=await fetch('http://127.0.0.1:3090/v1/contribution-tasks?mine=true');assert.equal(privateTasks.status,401);
const leaderboard=await get('/v1/works/gamehub-guess-baike/leaderboard?limit=10');
assert.equal(leaderboard.workId,'gamehub-guess-baike');assert.equal(leaderboard.myEntry,null);
assert.ok(Array.isArray(leaderboard.entries)&&leaderboard.entries.length<=10);
assert.equal(ready.status,'ready');assert.equal(ready.migrations.expected,55);assert.equal(ready.migrations.applied,55);
const tileBoards=await get('/v1/works/7359a350-cc0a-4a09-875d-cec9b5b8f93f/leaderboards');
assert.ok(tileBoards.some(board=>board.key==='classic-score'&&board.verification==='replay_verified'));
const tileLaunch=await get('/v1/works/7359a350-cc0a-4a09-875d-cec9b5b8f93f/launch');assert.equal(tileLaunch.capabilities.competition,true);
assert.equal(ready.saves.cloudEnabled,false);assert.equal(ready.saves.mode,'local');
assert.equal(cap.readEnabled,true);assert.equal(cap.postingEnabled,true);assert.equal(cap.commentsEnabled,false);
assert.equal(cap.canShare,false);assert.equal(cap.reason,'AUTH_REQUIRED');
assert.equal(process.env.COMMUNITY_IMAGES_ENABLED,'true');assert.ok(Array.isArray(feed.items));
const disabled=await fetch('http://127.0.0.1:3090/v1/me/save-library');assert.equal(disabled.status,503);assert.equal((await disabled.json()).error.code,'CLOUD_SAVE_DISABLED');
console.log(JSON.stringify({ready,community:cap,serverImageSwitch:process.env.COMMUNITY_IMAGES_ENABLED,feedItems:feed.items.length,leaderboard:{date:leaderboard.date,total:leaderboard.total,shown:leaderboard.entries.length}},null,2));
NODE
dc exec -T community-image node -e "require('node:fs').accessSync('/data/community-processor/requests'); console.log('image processor started')"
docker inspect "$(dc ps -q community-image)" --format 'image: {{.State.Status}} OOM={{.State.OOMKilled}} restarts={{.RestartCount}} CPU={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}}'
curl -fsS --retry 6 --retry-delay 2 --max-time 20 https://mooyu.fun/ready
printf '\n'
dc ps
printf '更新完成。备份及原配置：%s\n刷新页面使用完整共建流程；Agent 客户端请更新并重载。分享投稿仍为审核后公开。\n' "$RECORD"
