#!/usr/bin/env bash
# Source this file; all snapshots stay on the same Docker host.
pin_running_image() {
  local container=$1 destination=$2 image key entry value
  image=$(docker inspect --format '{{.Image}}' "$container") || return
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker image tag "$image" "$destination"
    return
  fi
  echo "Original image metadata unavailable for $container; preserving its running filesystem without pausing it."
  # Export/import also works when the parent manifest is gone (commit does not).
  # Mounted volume data is excluded. Only public base environment values are
  # imported; Compose supplies the original application environment on rollback.
  local names
  names=$(docker inspect --format '{{range (index .Config "Env")}}{{println (index (split . "=") 0)}}{{end}}' "$container") || return
  local -a changes=()
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo 'Unsupported environment key; snapshot aborted.' >&2; return 1; }
    case "$key" in
      PATH|HOME|NODE_ENV|NODE_VERSION|YARN_VERSION|NODE_OPTIONS|LANG|LC_ALL|TZ|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_CACHE_HOME|CADDY_VERSION|SSL_CERT_DIR|SSL_CERT_FILE|FONTCONFIG_PATH|FONTCONFIG_FILE|LD_LIBRARY_PATH|PYTHONPATH|VIRTUAL_ENV)
        entry=$(docker inspect --format "{{range (index .Config \"Env\")}}{{if eq (index (split . \"=\") 0) \"$key\"}}{{println .}}{{end}}{{end}}" "$container") || return
        value=${entry#*=}
        [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || { echo 'Unsupported base environment value; snapshot aborted.' >&2; return 1; }
        value=${value//\\/\\\\}; value=${value//\"/\\\"}
        changes+=(--change "ENV $key=\"$value\"")
        ;;
      *) :;;
    esac
  done <<< "$names"
  local field instruction
  for field in Entrypoint Cmd; do
    value=$(docker inspect --format "{{json (index .Config \"$field\")}}" "$container") || return
    if [ "$value" != null ] && [ "$value" != '[]' ]; then
      instruction=${field^^}; changes+=(--change "$instruction $value")
    fi
  done
  for field in User WorkingDir; do
    value=$(docker inspect --format "{{with index .Config \"$field\"}}{{.}}{{end}}" "$container") || return
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    [ -n "$value" ] || continue
    if [ "$field" = User ]; then instruction=USER; else instruction=WORKDIR; fi
    changes+=(--change "$instruction $value")
  done
  names=$(docker inspect --format '{{range $port, $value := (index .Config "ExposedPorts")}}{{println $port}}{{end}}' "$container") || return
  while IFS= read -r value; do
    [ -n "$value" ] || continue
    [[ "$value" =~ ^[0-9]+/(tcp|udp|sctp)$ ]] || return 1
    changes+=(--change "EXPOSE $value")
  done <<< "$names"
  names=$(docker inspect --format '{{range $path, $value := (index .Config "Volumes")}}{{println $path}}{{end}}' "$container") || return
  while IFS= read -r value; do
    [ -n "$value" ] || continue
    [[ "$value" = /* && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
    value=${value//\\/\\\\}; value=${value//\"/\\\"}
    changes+=(--change "VOLUME [\"$value\"]")
  done <<< "$names"
  docker export "$container" | docker import "${changes[@]}" - "$destination"
}
