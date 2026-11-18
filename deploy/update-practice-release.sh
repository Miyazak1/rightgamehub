#!/usr/bin/env bash
# Existing installation only. Run from a reviewed, fixed release commit.
set -Eeuo pipefail
umask 077
EXPECTED=${1:?Usage: bash update-practice-release.sh FULL_COMMIT_SHA}
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid release SHA'; exit 1; }
cd /www/gamehub
source deploy/pin-running-image.sh
source deploy/running-service.sh
test -f deploy/.env.prod
test "$(git rev-parse HEAD)" = "$EXPECTED"
test -z "$(git status --porcelain)" || { echo 'Local edits found; stop without reset/clean.'; exit 1; }
export COMPOSE_PROFILES= COMPOSE_PARALLEL_LIMIT=1
COMPOSE_ARGS=(-f deploy/compose.prod.yml)
if [ -n "${MOOYU_RELEASE_COMPOSE_FILES:-}" ]; then
  COMPOSE_ARGS=()
  while IFS= read -r file; do test -f "$file"; COMPOSE_ARGS+=(-f "$file"); done < "$MOOYU_RELEASE_COMPOSE_FILES"
fi
dc() { docker compose --project-directory /www/gamehub/deploy --project-name gamehub-production --env-file deploy/.env.prod "${COMPOSE_ARGS[@]}" --profile '*' "$@"; }
dc config --quiet
POSTGRES_ID=$(running_service_id postgres)
running_service_id api > /dev/null
running_service_id web > /dev/null
if [ "${MOOYU_RELEASE_RESUMING:-false}" = true ]; then
  count=$(docker exec "$POSTGRES_ID" psql -U gamehub -d gamehub -Atc 'SELECT count(*) FROM schema_migrations')
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
RUNNING_SERVICES=$(running_project_services)
CONFIGURED_SERVICES=$(dc config --services)
SERVICES=()
while IFS= read -r service; do
  [ -n "$service" ] || continue
  case "$service" in postgres|redis) continue;; esac
  grep -Fxq "$service" <<< "$CONFIGURED_SERVICES" || {
    echo "Running service absent from target configuration: $service; no services changed." >&2; exit 1;
  }
  SERVICES+=("$service")
done <<< "$RUNNING_SERVICES"
((${#SERVICES[@]} > 0)) || { echo 'No running application services found; no services changed.' >&2; exit 1; }
printf 'services:\n' > "$RECORD/rollback-images.yml"
WEB_RUNTIME_IMAGE=
# Preserve every original service image before any image build begins.
for service in "${SERVICES[@]}"; do
  id=$(running_service_id "$service")
  test -n "$id"
  original="mooyu-release-original:${STAMP,,}-$service"
  pin_running_image "$id" "$original"
done
for service in "${SERVICES[@]}"; do
  id=$(running_service_id "$service")
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
if [ -f downloads-environment.sh ]; then source downloads-environment.sh; fi
compose=(-f compose.before.yml)
if [ -f compose-files.rollback.txt ]; then
  compose=(); while IFS= read -r file; do compose+=(-f "$file"); done < compose-files.rollback.txt
fi
if [ -x restore-downloads.sh ]; then bash restore-downloads.sh; fi
docker compose --project-directory /www/gamehub/deploy --project-name gamehub-production \
  --env-file env.before "${compose[@]}" -f rollback-images.yml --profile '*' \
  up -d --no-build --no-deps --wait --wait-timeout 240 "${services[@]}"
echo 'Previous business code restored with the compatible migration inventory; user data retained.'
ROLLBACK
chmod 700 "$RECORD/rollback.sh"
echo "Release record and rollback: $RECORD"
# Resolve build roles from the effective configuration, then append a final
# image-only layer. This dominates renamed/nested rollback overlays without
# discarding operator settings or rebuilding into a historical image tag.
RELEASE_IMAGE_PREFIX="mooyu-release:${EXPECTED:0:16}-${STAMP,,}"
API_FOR_PLAN=$(running_service_id api)
dc config --format json | docker exec -i "$API_FOR_PLAN" node -e '
let text="";process.stdin.on("data",part=>text+=part);process.stdin.on("end",()=>{
 try{
  const config=JSON.parse(text),[prefix,...names]=process.argv.slice(1);
  if(!/^mooyu-release:[a-f0-9]{16}-[a-z0-9]+$/.test(prefix))throw Error();
  const lines=["services:"];
  for(const name of [...new Set(names)]){
   if(!/^[a-z][a-z0-9-]*$/.test(name)||!config.services?.[name])throw Error();
   if(config.services[name].build)lines.push("  "+name+":","    image: "+prefix+"-"+name);
  }
  if(lines.length===1)throw Error();
  console.log(lines.join("\n"));
 }catch{console.error("Release image role resolution failed; no services changed.");process.exitCode=1;}
});' "$RELEASE_IMAGE_PREFIX" migrate "${SERVICES[@]}" > "$RECORD/release-images.yml"
COMPOSE_ARGS+=(-f "$RECORD/release-images.yml")
printf '%s\n' "$RECORD/release-images.yml" >> "$RECORD/compose-files.target.txt"
dc config --quiet
# Build before touching running services or the database. Avoid full compose up.
# Keep the already working production Caddy binary and DNS provider. This is an
# application update, so rebuilding unrelated Go dependencies is unnecessary.
test -n "$WEB_RUNTIME_IMAGE"
dc build --build-arg "MOOYU_WEB_RUNTIME_IMAGE=$WEB_RUNTIME_IMAGE" migrate "${SERVICES[@]}"
docker exec "$POSTGRES_ID" pg_dump -U gamehub -d gamehub --format=custom > "$RECORD/database.dump.partial"
docker exec -i "$POSTGRES_ID" pg_restore --list < "$RECORD/database.dump.partial" > /dev/null
mv "$RECORD/database.dump.partial" "$RECORD/database.dump"
# Pending migrations through 0162 are additive; retain them on application rollback.
dc run --rm --no-deps migrate node apps/api/src/practice-release-migrate.mjs
rollback_on_failure() {
  status=$?
  trap - ERR
  printf 'Release check failed: phase=%s service=%s line=%s exit-code=%s\n' \
    "${RELEASE_PHASE:-unknown}" "${CURRENT_SERVICE:-none}" "${1:-unknown}" "$status" >&2
  docker ps -a --filter label=com.docker.compose.project=gamehub-production \
    --format '{{.ID}} {{.Names}} {{.Status}} {{.Image}}' > "$RECORD/failed-containers.txt" 2>&1 || true
  echo "Release failed ($status); restoring previous images from $RECORD" >&2
  bash "$RECORD/rollback.sh" || echo "Automatic rollback failed. Run: bash $RECORD/rollback.sh" >&2
  exit "$status"
}
trap 'rollback_on_failure "$LINENO"' ERR
RELEASE_PHASE=activate
printf '%s\n' "$EXPECTED" > "$RECORD/activation-started"
dc up -d --no-build --no-deps --wait --wait-timeout 240 "${SERVICES[@]}"

RELEASE_PHASE=verify-containers
: > "$RECORD/deployed-images.txt"
for service in "${SERVICES[@]}"; do
  CURRENT_SERVICE=$service
  echo "Verifying running container: $service"
  id=$(running_service_id "$service")
  test -n "$id"
  if grep -Fxq "  $service:" "$RECORD/release-images.yml"; then
    actual=$(docker inspect --format '{{.Config.Image}}' "$id")
    if [ "$actual" != "$RELEASE_IMAGE_PREFIX-$service" ]; then echo "Unexpected release image for $service" >&2; fi
    test "$actual" = "$RELEASE_IMAGE_PREFIX-$service"
  fi
  docker inspect --format '{{.Name}} {{.Image}} {{.Config.Image}}' "$id" >> "$RECORD/deployed-images.txt"
done

RELEASE_PHASE=verify-sources
CURRENT_SERVICE=api
VERIFIED_API_ID=$(running_service_id api)
: > "$RECORD/verified-source-sha256.txt"
for file in agent-provider-request.mjs agent-provider-gateway.mjs agent-runtime-repository.mjs agent-blog-prompt.mjs agent-blog-public-admission.mjs agent-runtime-worker.mjs; do
  expected_hash=$(git show "$EXPECTED:apps/api/src/$file" | sha256sum | awk '{print $1}')
  actual_hash=$(docker exec "$VERIFIED_API_ID" sha256sum "/app/apps/api/src/$file" | awk '{print $1}')
  if [ "$expected_hash" != "$actual_hash" ]; then echo "Running source mismatch: $file" >&2; fi
  test "$expected_hash" = "$actual_hash"
  printf '%s  %s\n' "$actual_hash" "$file" >> "$RECORD/verified-source-sha256.txt"
done
RELEASE_PHASE=verify-http
docker exec -i "$VERIFIED_API_ID" node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {createVerifiedMathEngine} from './apps/api/src/practice/engine.mjs';
for(const key of ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED']) assert.equal(process.env[key],'false',key);
const get=async route=>{
 const started=performance.now();
 console.log(JSON.stringify({check:'http-start',route}));
 try{
  const r=await fetch('http://127.0.0.1:3090'+route,{signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200,route);const body=await r.json();
  console.log(JSON.stringify({check:'http-ok',route,status:r.status,elapsedMs:Math.round(performance.now()-started)}));
  return body.data;
 }catch(error){
  console.error(JSON.stringify({check:'http-failed',route,elapsedMs:Math.round(performance.now()-started),name:error.name,message:error.message,cause:error.cause?.code}));
  throw error;
 }
};
const ready=await get('/ready');assert.equal(ready.status,'ready');assert.equal(ready.migrations.expected,162);assert.equal(ready.migrations.ready,true);
const catalog=await get('/v1/learning/practice/catalog');assert.ok(catalog.topics.length>0);
assert.equal(createVerifiedMathEngine().capabilities().ready,true,'verified engine must be installed');
const paper=await fetch('http://127.0.0.1:3090/v1/me/paper-studies');assert.equal(paper.status,404);
const {officialToolCapabilities}=await import('./packages/agent-capabilities/src/index.mjs');assert.ok(!officialToolCapabilities.some(x=>x.toolId==='paper-study'));
const mcp=await fetch('http://127.0.0.1:3090/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
assert.equal(mcp.status,200);const tools=await mcp.json();assert.ok(Array.isArray(tools.result?.tools));assert.ok(!tools.result.tools.some(x=>x.name==='open_paper_study'));
assert.ok(tools.result.tools.some(x=>x.name==='get_my_learning_data'),'new learning tool must be present');
for(const path of ['/v1/me/assistant/capabilities','/v1/me/learning/insights'])assert.equal((await fetch('http://127.0.0.1:3090'+path)).status,401,'private Agent routes require auth');
const agent=await fetch('http://127.0.0.1:3090/v1/me/agent/tools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'get_my_learning_data',arguments:{}})});assert.equal(agent.status,401);
const detail=await fetch('http://127.0.0.1:3090/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_capability',arguments:{capabilityId:'courseware:mathematics-practice'}}})});
assert.equal(detail.status,200);assert.equal((await detail.json()).result.structuredContent.capability.launch.route,'/learn/practice');
console.log(JSON.stringify({status:ready.status,migrations:ready.migrations,practiceTopics:catalog.topics.length,paperEnabled:false,platformAgent:true}));
NODE
trap - ERR
docker ps --filter label=com.docker.compose.project=gamehub-production \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo "Release verified. Rollback command: bash $RECORD/rollback.sh"
