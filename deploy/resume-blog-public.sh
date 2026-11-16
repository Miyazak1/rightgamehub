#!/usr/bin/env bash
# Use the running scheduler's image and environment; do not recreate Compose
# services or overwrite production configuration.
set -euo pipefail
mapfile -t containers < <(docker ps -q \
  --filter label=com.docker.compose.project=gamehub-production \
  --filter label=com.docker.compose.service=agent-blog-public-scheduler)
if [ "${#containers[@]}" -ne 1 ]; then
  echo 'Expected exactly one running production public scheduler; no changes made.' >&2
  exit 1
fi
docker exec "${containers[0]}" node /app/apps/api/src/agent-blog-public-resume-cli.mjs
