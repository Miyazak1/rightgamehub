#!/usr/bin/env bash
# Resolve live identity from Engine labels, independent of a changing Compose
# image/configuration overlay. Never select an arbitrary replica or one-off job.
running_project_services() {
  local project=${1:-gamehub-production} listed id identity running actual_project service oneoff
  [[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || return 1
  local -a services=()
  listed=$(docker ps --no-trunc --quiet --filter "label=com.docker.compose.project=$project") || {
    echo "Engine project lookup failed: project=$project" >&2; return 1;
  }
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    identity=$(docker inspect --format '{{.State.Running}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{index .Config.Labels "com.docker.compose.oneoff"}}' "$id") || return
    read -r running actual_project service oneoff <<< "$identity"
    [[ "$running" = true && "$actual_project" = "$project" && "$service" =~ ^[a-z][a-z0-9-]*$ ]] || {
      echo "Invalid running project identity: project=$project container=$id" >&2; return 1;
    }
    case "${oneoff,,}" in
      true|1) continue ;;
      false|0|''|'<no value>') services+=("$service") ;;
      *) echo "Unknown one-off label: project=$project container=$id" >&2; return 1 ;;
    esac
  done <<< "$listed"
  if [ "${#services[@]}" -gt 0 ]; then printf '%s\n' "${services[@]}" | LC_ALL=C sort -u; fi
}

running_service_id() {
  local service=${1:?service required} project=${2:-gamehub-production}
  [[ "$service" =~ ^[a-z][a-z0-9-]*$ && "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || {
    echo 'Invalid service/project identity.' >&2; return 1;
  }
  local listed id identity running actual_project actual_service oneoff
  local -a matches=()
  listed=$(docker ps --no-trunc --quiet \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service") || {
    echo "Engine container lookup failed: project=$project service=$service" >&2; return 1;
  }
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    identity=$(docker inspect --format '{{.State.Running}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{index .Config.Labels "com.docker.compose.oneoff"}}' "$id") || return
    read -r running actual_project actual_service oneoff <<< "$identity"
    if [ "$running" != true ] || [ "$actual_project" != "$project" ] || [ "$actual_service" != "$service" ]; then
      echo "Container identity changed: project=$project service=$service container=$id" >&2; return 1
    fi
    case "${oneoff,,}" in
      true|1) continue ;;
      false|0|''|'<no value>') matches+=("$id") ;;
      *) echo "Unknown one-off label: project=$project service=$service container=$id" >&2; return 1 ;;
    esac
  done <<< "$listed"
  if [ "${#matches[@]}" -ne 1 ]; then
    echo "Expected one running service container: project=$project service=$service found=${#matches[@]}" >&2
    return 1
  fi
  printf '%s\n' "${matches[0]}"
}
