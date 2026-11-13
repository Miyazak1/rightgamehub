#!/usr/bin/env bash
# Existing installation only. Run from a reviewed, fixed release commit.
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: bash update-practice-release.sh FULL_COMMIT_SHA}
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release SHA'; exit 1; }
cd /www/gamehub
source deploy/pin-running-image.sh
test -f deploy/.env.prod
test "$(git rev-parse HEAD)" = "$EXPECTED"
test -z "$(git status --porcelain)" || { echo 'Local edits found; stop without reset/clean.'; exit 1; }
export COMPOSE_PROFILES= COMPOSE_PARALLEL_LIMIT=1
dc() { docker compose --project-name gamehub-production --env-file deploy/.env.prod -f deploy/compose.prod.yml --profile '*' "$@"; }
dc config --quiet
test -n "$(dc ps --status running --quiet postgres)"
test -n "$(dc ps --status running --quiet api)"
test -n "$(dc ps --status running --quiet web)"
if [ "${MOOYU_RELEASE_RESUMING:-false}" = true ]; then
  count=$(dc exec -T postgres psql -U gamehub -d gamehub -Atc 'SELECT count(*) FROM schema_migrations')
  [ "$count" = 158 ] || { echo 'Resume expects the unchanged 158-migration production database. Stop for review.'; exit 1; }
fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RECORD=${MOOYU_RELEASE_RECORD:?Run prepare-practice-release.sh first}
test -s "$RECORD/previous-commit.txt"
test -s "$RECORD/compose.before.yml"
printf '%s\n' "$EXPECTED" > "$RECORD/release-commit.txt"
if [ ! -f "$RECORD/env.before" ]; then cp deploy/.env.prod "$RECORD/env.before"; fi
mkdir -p "$RECORD/rollback-build/migrations"
cp apps/api/migrations/*.sql "$RECORD/rollback-build/migrations/"
# Update precisely the currently running application services. Never start an
# optional scheduler, bootstrap, paper job or desktop preview for this release.
mapfile -t SERVICES < <(dc ps --status running --services | grep -vE '^(postgres|redis)$')
((${#SERVICES[@]} > 0))
printf 'services:\n' > "$RECORD/rollback-images.yml"
WEB_RUNTIME_IMAGE=
# Preserve every original service image before any image build begins.
for service in "${SERVICES[@]}"; do
  id=$(dc ps --status running --quiet "$service")
  test -n "$id"
  original="mooyu-release-original:${STAMP,,}-$service"
  pin_running_image "$id" "$original"
done
for service in "${SERVICES[@]}"; do
  id=$(dc ps --status running --quiet "$service")
  tag="mooyu-release-rollback:${STAMP,,}-$service"
  original="mooyu-release-original:${STAMP,,}-$service"
  if [ "$service" = web ]; then WEB_RUNTIME_IMAGE="$original"; fi
  # The old readiness check rejects newer migration records. Old business
  # images therefore receive only the additive migration inventory, so rollback
  # keeps all user data and remains ready without downgrading the database.
  if docker exec "$id" test -d /app/apps/api/migrations; then
    printf 'FROM %s\nCOPY --chown=node:node migrations/ /app/apps/api/migrations/\n' "$original" > "$RECORD/rollback-build/Dockerfile"
    docker build --tag "$tag" "$RECORD/rollback-build"
  else
    docker image tag "$original" "$tag"
  fi
  printf '  %s:\n    image: %s\n' "$service" "$tag" >> "$RECORD/rollback-images.yml"
done
printf '%s\n' "${SERVICES[@]}" > "$RECORD/services.txt"
cat > "$RECORD/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
mapfile -t services < services.txt
docker compose --project-directory /www/gamehub/deploy --project-name gamehub-production \
  --env-file env.before -f compose.before.yml -f rollback-images.yml --profile '*' \
  up -d --no-build --no-deps --wait --wait-timeout 240 "${services[@]}"
echo 'Previous business code restored with the compatible migration inventory; user data retained.'
ROLLBACK
chmod 700 "$RECORD/rollback.sh"
echo "Release record and rollback: $RECORD"
# Build before touching running services or the database. Avoid full compose up.
# Keep the already working production Caddy binary and DNS provider. This is an
# application update, so rebuilding unrelated Go dependencies is unnecessary.
test -n "$WEB_RUNTIME_IMAGE"
dc build --build-arg "MOOYU_WEB_RUNTIME_IMAGE=$WEB_RUNTIME_IMAGE" migrate "${SERVICES[@]}"
dc exec -T postgres pg_dump -U gamehub -d gamehub --format=custom > "$RECORD/database.dump.partial"
dc exec -T postgres pg_restore --list < "$RECORD/database.dump.partial" > /dev/null
mv "$RECORD/database.dump.partial" "$RECORD/database.dump"
# Both 0159 and 0160 are additive. Retain them on an application rollback.
dc run --rm --no-deps migrate node apps/api/src/practice-release-migrate.mjs
rollback_on_failure() {
  status=$?
  trap - ERR
  echo "Release failed ($status); restoring previous images from $RECORD" >&2
  bash "$RECORD/rollback.sh" || echo "Automatic rollback failed. Run: bash $RECORD/rollback.sh" >&2
  exit "$status"
}
trap rollback_on_failure ERR
printf '%s\n' "$EXPECTED" > "$RECORD/activation-started"
dc up -d --no-build --no-deps --wait --wait-timeout 240 "${SERVICES[@]}"
dc exec -T api node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {createVerifiedMathEngine} from './apps/api/src/practice/engine.mjs';
for(const key of ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']) assert.equal(process.env[key],'false',key);
const get=async route=>{const r=await fetch('http://127.0.0.1:3090'+route,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,route);return (await r.json()).data;};
const ready=await get('/ready');assert.equal(ready.status,'ready');assert.equal(ready.migrations.expected,160);assert.equal(ready.migrations.ready,true);
const catalog=await get('/v1/learning/practice/catalog');assert.ok(catalog.topics.length>0);
assert.equal(createVerifiedMathEngine().capabilities().ready,true,'verified engine must be installed');
const paper=await fetch('http://127.0.0.1:3090/v1/me/paper-studies');assert.equal(paper.status,404);
const {officialToolCapabilities}=await import('./packages/agent-capabilities/src/index.mjs');assert.ok(!officialToolCapabilities.some(x=>x.toolId==='paper-study'));
const mcp=await fetch('http://127.0.0.1:3090/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
assert.equal(mcp.status,200);const tools=await mcp.json();assert.ok(Array.isArray(tools.result?.tools));assert.ok(!tools.result.tools.some(x=>x.name==='open_paper_study'));
console.log(JSON.stringify({status:ready.status,migrations:ready.migrations,practiceTopics:catalog.topics.length,paperEnabled:false}));
NODE
trap - ERR
dc ps
echo "Release verified. Rollback command: bash $RECORD/rollback.sh"
