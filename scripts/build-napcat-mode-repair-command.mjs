import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const out=process.argv[2],smoke=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),compose=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_DIRECTORY_REQUIRED');
if(smoke.result!=='PASSED_BOOTSTRAP_ONLY'||!smoke.minimalEnvironmentChange||smoke.nodeProcessCount<2||!smoke.markers.addonPreloaded||compose.result!=='PASSED'||!compose.realComposeModeSwitchAndRollback||!compose.canonicalUlimitsVerified||!compose.hostnamePreserved||!compose.otherContainerNotRestarted||!compose.historyPreserved)throw Error('ACTUAL_LOCAL_PROOFS_REQUIRED');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=['repair-napcat-process-mode.mjs','recover-qq-gateway-once.mjs','github-search-runtime-verification.mjs'].map(name=>{const b=fs.readFileSync(path.join('scripts',name));if(spawnSync(process.execPath,['--input-type=module','--check'],{input:b,encoding:'utf8'}).status!==0)throw Error('NODE_SYNTAX_FAILED');return {name,sha256:sha(b),base64:b.toString('base64')};});
const probe=fs.readFileSync('scripts/repair-napcat-process-mode.mjs','utf8').match(/const nativeProbe=String.raw`([\s\S]*?)`;/)?.[1];
if(!probe||spawnSync(process.execPath,['--input-type=module','--check'],{input:probe,encoding:'utf8'}).status!==0)throw Error('NATIVE_PROBE_SYNTAX_FAILED');
const body=String.raw`import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const files=FILES;
for(const f of files)if(crypto.createHash('sha256').update(Buffer.from(f.base64,'base64')).digest('hex')!==f.sha256)throw Error('REPAIR_TOOL_HASH_MISMATCH');
const tools=fs.mkdtempSync('/www/backup/gamehub/qq-gateway-mode-tools-20261124-');fs.chmodSync(tools,0o700);
for(const f of files)fs.writeFileSync(tools+'/'+f.name,Buffer.from(f.base64,'base64'),{flag:'wx',mode:0o600});
console.log('新网关修复工具目录：'+tools);
const r=spawnSync(process.execPath,[tools+'/repair-napcat-process-mode.mjs','apply'],{stdio:'inherit',env:{...process.env,MOOYU_GATEWAY_MODE_AUTH:'20261124'}});process.exitCode=r.status??1;`.replace('FILES',JSON.stringify(files));
const runtime=String.raw`node_hash=$(docker exec gamehub-production-api-1 node -e 'const fs=require("node:fs"),c=require("node:crypto");console.log(c.createHash("sha256").update(fs.readFileSync("/usr/local/bin/node")).digest("hex"));')
[[ "$node_hash" =~ ^[a-f0-9]{64}$ ]]
runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node; do
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
runtime=$(mktemp -d /root/mooyu-qq-gateway-runtime-20261124-XXXXXX)
chmod 700 -- "$runtime"
docker cp -L gamehub-production-api-1:/usr/local/bin/node "$runtime/node"
chmod 700 -- "$runtime/node"
fi
printf '%s  %s\n' "$node_hash" "$runtime/node" | sha256sum --check -
version=$("$runtime/node" --version)
case "$version" in v22.*) ;; *) echo NODE22_REQUIRED >&2; exit 2 ;; esac
printf '已校验私有运行时：%s (%s)\n' "$runtime/node" "$version"
`;
const shell="(\nset -euo pipefail\numask 077\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\n"+runtime+'nice -n 10 "$runtime/node" --input-type=module <<\'NODE\'\n'+body+'\nNODE\n)\n';
if(spawnSync('C:\\Program Files\\Git\\bin\\bash.exe',['-n'],{input:shell,encoding:'utf8',windowsHide:true}).status!==0)throw Error('SHELL_SYNTAX_FAILED');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server-repair-only-qq-gateway.txt'),shell);
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({result:'PREPARED_NOT_EXECUTED',scope:'only QQ gateway recreation, same native image and login volume',image:smoke.image,onlyEnvironmentChange:{NAPCAT_DISABLE_MULTI_PROCESS:{from:'1',to:'0'}},runtimeProvisioning:{source:'running API /usr/local/bin/node',destination:'new /root/mooyu-qq-gateway-runtime-20261124-* directory',freeSpaceChecked:true,sha256Compared:true,node22Required:true,existingFilePermissionsChanged:false,usedByRollback:true},originalHostnamePinned:true,loginBackupsBeforeAndWhileStopped:true,noDatabaseWrites:true,noLoginDataDeletion:true,noOtherServiceRestart:true,papersRemainClosed:true,rollback:'new-operation-directory/rollback.sh',nativeLoginAndReconnectNotYetAccepted:true,nativeParentMayRestartItsOwnChild:true,sourceHashes:files.map(({base64,...f})=>f),smoke,compose},null,2)+'\n');
console.log(JSON.stringify({result:'PREPARED_NOT_EXECUTED',command:path.join(out,'server-repair-only-qq-gateway.txt')}));
