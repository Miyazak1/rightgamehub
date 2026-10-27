#!/bin/sh
# Explicit Foundation public-runtime operations. This script never edits the
# production env file and never changes publication ownership.
set -eu
umask 077
cd "$(dirname "$0")"

ENV_FILE=${ENV_FILE:-.env.prod}
[ -f "$ENV_FILE" ] || { echo "Missing deploy/$ENV_FILE" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

set -a
. "./$ENV_FILE"
set +a

compose() {
  docker compose --parallel 1 --env-file "$ENV_FILE" -f compose.prod.yml "$@"
}

require_runtime() {
  [ "${AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:-false}" = "true" ] || {
    echo "AGENT_BLOG_PUBLIC_RUNTIME_ENABLED must be true." >&2
    exit 1
  }
  printf '%s' "${AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:-}" |
    grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' || {
      echo "AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID must be a UUID." >&2
      exit 1
    }
}

require_secret() {
  [ -n "${AGENT_SECRET_ENCRYPTION_KEY:-}" ] || {
    echo "AGENT_SECRET_ENCRYPTION_KEY is required for Provider execution." >&2
    exit 1
  }
}

preflight() {
  require_runtime
  compose --profile agent-blog-public-preflight run --rm --build agent-blog-public-preflight
}

usage() {
  cat <<'EOF'
Usage: ENV_FILE=.env.prod ./agent-blog-public-ops.sh COMMAND

Commands:
  status           Show non-secret switches and public executor containers.
  bootstrap        Register reviewed tools, models and workflows; creates no Run.
  preflight        Run the read-only public admission check.
  run-once         Preflight, then immediately attempt one public article Run.
  start-scheduler  Start the scheduler; its worker performs guarded activation.
  stop-scheduler   Stop the scheduler without changing ownership or history.
  logs             Follow scheduler logs.
EOF
}

command=${1:-}
compose config --quiet

case "$command" in
  status)
    printf 'runtime_enabled=%s\nschedule_enabled=%s\nagent_user_id=%s\n' \
      "${AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:-false}" \
      "${AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED:-false}" \
      "${AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:-unset}"
    compose --profile agent-blog-public-bootstrap \
      --profile agent-blog-public-preflight \
      --profile agent-blog-public-run \
      --profile agent-blog-public-scheduler \
      ps -a agent-blog-public-bootstrap agent-blog-public-preflight \
        agent-blog-public-run agent-blog-public-scheduler
    ;;
  bootstrap)
    require_runtime
    compose --profile agent-blog-public-bootstrap run --rm --build agent-blog-public-bootstrap
    ;;
  preflight)
    preflight
    ;;
  run-once)
    require_secret
    preflight
    compose --profile agent-blog-public-run run --rm --build agent-blog-public-run
    ;;
  start-scheduler)
    require_secret
    require_runtime
    [ "${AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED:-false}" = "true" ] || {
      echo "AGENT_BLOG_PUBLIC_SCHEDULE_ENABLED must be true." >&2
      exit 1
    }
    compose --profile agent-blog-public-scheduler up -d --build --wait \
      --wait-timeout "${DEPLOY_WAIT_SECONDS:-240}" agent-blog-public-scheduler
    compose --profile agent-blog-public-scheduler ps agent-blog-public-scheduler
    ;;
  stop-scheduler)
    compose --profile agent-blog-public-scheduler stop -t 60 agent-blog-public-scheduler
    ;;
  logs)
    compose --profile agent-blog-public-scheduler logs -f --tail 200 agent-blog-public-scheduler
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
