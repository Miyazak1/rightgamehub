export const SCOPES_BASE='sha256:ca9f31fca496b2d78942c6e2fb5c9d33534caddf5d3a935285e011e9a4f33ad6';
export const RECOVERY_BASE='sha256:e07646378c71ebe44af6b8a50dd17cff4e92f458f9c3b7ceeac830c9cdc700b8';
export const SCOPES_PREFIX='github-search-scopes-operation-20261124-';
export function scopesUpdater(formatted,{variant='scopes'}={}){
 if(!['scopes','recovery'].includes(variant))throw Error('UNKNOWN_RELEASE_VARIANT');
 let s=formatted;
 const once=(a,b)=>{if(s.split(a).length!==2)throw Error('SCOPES_UPDATER_ANCHOR_REQUIRED');s=s.replace(a,b);};
 once("process.env.MOOYU_GITHUB_SEARCH_AUTH!=='20261123'","process.env.MOOYU_GITHUB_SEARCH_AUTH!=='20261124'");
 const rollback=s.match(/fs\.writeFileSync\(directory\+'\/rollback\.sh',[\s\S]*?\{flag:'wx',mode:0o700\}\);/)?.[0];
 if(!rollback)throw Error('ROLLBACK_SCRIPT_ANCHOR_REQUIRED');
 once(rollback,"fs.writeFileSync(directory+'/rollback.sh',scopesRollbackCommand(process.execPath,stage,directory),{flag:'wx',mode:0o700});");
 s+=(String.raw`
export function scopesRollbackCommand(runtime,stage,record){
 if(!/^\/root\/mooyu-(?:qq-gateway|github-search)-runtime-20261124-[A-Za-z0-9]+\/node$/.test(runtime)||stage!=='/www/backup/gamehub/github-search-release-20261124-scopes-r1'||!/^\/www\/backup\/gamehub\/github-search-scopes-operation-20261124-[A-Za-z0-9]+$/.test(record))throw Error('REVIEWED_ROLLBACK_PATH_REQUIRED');
 return '#!/bin/sh\nset -eu\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_GITHUB_SEARCH_AUTH=20261124\nexec '+"'"+runtime+"' '"+stage+"/update-github-search-online.mjs' rollback '"+stage+"' '"+record+"'\n";
}
`).replaceAll('20261124-scopes-r1','20261124-'+variant+'-r1').replaceAll('github-search-scopes-operation-20261124-','github-search-'+variant+'-operation-20261124-');
 if(s.includes('/agent-plugins-stage-20261122-r3/node')||s.includes('MOOYU_GITHUB_SEARCH_AUTH=20261123'))throw Error('STALE_NODE_OR_AUTH_ENTRY');
 return s;
}

// Only reads the running API's Node executable. Reuses a SHA-verified private
// runtime; otherwise writes a new private directory, never chmods an old file.
export const SCOPES_PRIVATE_RUNTIME=String.raw`node_hash=$(docker exec gamehub-production-api-1 node -e 'const fs=require("node:fs"),c=require("node:crypto");console.log(c.createHash("sha256").update(fs.readFileSync("/usr/local/bin/node")).digest("hex"));')
[[ "$node_hash" =~ ^[a-f0-9]{64}$ ]]
runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node /root/mooyu-github-search-runtime-20261124-*/node; do
 if test -f "$candidate" && test -x "$candidate" && printf '%s  %s\n' "$node_hash" "$candidate" | sha256sum --check --status -; then
  if version=$("$candidate" --version 2>/dev/null); then
   case "$version" in v22.*) runtime=$(dirname "$candidate"); break ;; esac
  fi
 fi
done
if test -z "$runtime"; then
 node_bytes=$(docker exec gamehub-production-api-1 node -e 'console.log(require("node:fs").statSync("/usr/local/bin/node").size);')
 [[ "$node_bytes" =~ ^[0-9]+$ ]]
 free_bytes=$(df -PB1 /root | awk 'NR==2 {print $4}')
 [[ "$free_bytes" =~ ^[0-9]+$ ]]
 test "$free_bytes" -gt "$((node_bytes + 268435456))"
 runtime=$(mktemp -d /root/mooyu-github-search-runtime-20261124-XXXXXX)
 chmod 700 -- "$runtime"
 docker cp -L gamehub-production-api-1:/usr/local/bin/node "$runtime/node"
 chmod 700 -- "$runtime/node"
fi
printf '%s  %s\n' "$node_hash" "$runtime/node" | sha256sum --check -
case "$("$runtime/node" --version)" in v22.*) ;; *) echo NODE22_REQUIRED >&2; exit 2 ;; esac
`;
