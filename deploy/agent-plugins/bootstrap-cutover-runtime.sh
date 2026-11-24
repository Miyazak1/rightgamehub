#!/usr/bin/env bash
# Future server preparation only. Copies the existing API's native Node binary;
# does not install packages, restart services, or modify original configuration.
set -euo pipefail
umask 077
runtime=${1:?new private runtime directory required}
runtime=$(realpath -m -- "$runtime")
case "$runtime" in
  /www/backup/gamehub/agent-cutover-runtime-*) ;;
  *) echo PRIVATE_RUNTIME_PATH_REQUIRED >&2; exit 2 ;;
esac
test ! -e "$runtime"
mkdir -m 700 -- "$runtime"
docker cp gamehub-production-api-1:/usr/local/bin/node "$runtime/node"
chmod 700 "$runtime/node"
version=$("$runtime/node" --version)
case "$version" in v22.*) ;; *) echo NODE22_REQUIRED >&2; exit 2 ;; esac
printf 'Node runtime prepared: %s/node (%s)\n' "$runtime" "$version"
