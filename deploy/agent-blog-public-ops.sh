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
  paper-draft ID   Turn one verified paper analysis UUID into a private draft.
  paper-accept IDS Run the R2.3 gate for exactly 3 comma-separated analysis UUIDs.
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
      --profile agent-paper-article-run \
      --profile agent-paper-article-acceptance \
      --profile agent-blog-public-scheduler \
      ps -a agent-blog-public-bootstrap agent-blog-public-preflight \
        agent-blog-public-run agent-paper-article-run agent-paper-article-acceptance \
        agent-blog-public-scheduler
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
  paper-draft)
    require_secret
    require_runtime
    analysis_id=${2:-}
    printf '%s' "$analysis_id" |
      grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' || {
        echo "paper-draft requires a verified analysis UUID." >&2
        exit 1
      }
    export AGENT_PAPER_ARTICLE_ANALYSIS_ID=$analysis_id
    compose --profile agent-blog-public-bootstrap run --rm --build agent-blog-public-bootstrap
    compose --profile agent-paper-article-run run --rm --build agent-paper-article-run
    ;;
  paper-accept)
    require_secret
    require_runtime
    analysis_ids=${2:-}
    printf '%s' "$analysis_ids" | grep -Eq \
      '^[0-9a-fA-F-]{36},[0-9a-fA-F-]{36},[0-9a-fA-F-]{36}$' || {
        echo "paper-accept requires exactly 3 comma-separated analysis UUIDs." >&2
        exit 1
      }
    old_ifs=$IFS
    IFS=,
    set -- $analysis_ids
    IFS=$old_ifs
    [ "$1" != "$2" ] && [ "$1" != "$3" ] && [ "$2" != "$3" ] || {
      echo "paper-accept requires 3 distinct analysis UUIDs." >&2
      exit 1
    }
    for analysis_id in "$1" "$2" "$3"; do
      printf '%s' "$analysis_id" | grep -Eq \
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' || {
          echo "paper-accept contains an invalid analysis UUID." >&2
          exit 1
        }
    done
    export AGENT_PAPER_ARTICLE_ACCEPTANCE_ANALYSIS_IDS=$analysis_ids
    compose --profile agent-blog-public-bootstrap run --rm --build agent-blog-public-bootstrap
    compose --profile agent-paper-article-acceptance run --rm --build agent-paper-article-acceptance
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
