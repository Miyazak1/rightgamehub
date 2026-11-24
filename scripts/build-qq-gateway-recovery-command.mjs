import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('./recover-qq-gateway-once.mjs',import.meta.url),'utf8');
const probe=source.match(/const loginProbe=String.raw`([\s\S]*?)`;/)?.[1];
for(const code of [source,probe])if(!code||spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'}).status!==0)throw Error('RECOVERY_NODE_SYNTAX_FAILED');
const body=source+"\nawait recoverGatewayOnce().catch(()=>{console.error(JSON.stringify({result:'RECOVERY_ENTRY_REFUSED',automaticRetry:false}));process.exitCode=1;});\n";
const shell="# Explicitly authorized: one gateway recovery, no recreate or login-data cleanup.\n(\nset -euo pipefail\numask 077\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_GATEWAY_RECOVERY_AUTH=20261123-once\nnice -n 10 /www/backup/gamehub/agent-plugins-stage-20261122-r3/node --input-type=module <<'NODE'\n"+body+"NODE\n)\n";
const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';if(spawnSync(bash,['-n'],{input:shell,encoding:'utf8'}).status!==0)throw Error('RECOVERY_SHELL_SYNTAX_FAILED');
const out=path.resolve('deploy/agent-plugins/server-qq-gateway-recovery-once-command.txt');fs.writeFileSync(out,shell,{flag:'wx'});console.log(JSON.stringify({result:'LOCAL_RECOVERY_COMMAND_PREPARED',output:out,serverCommandExecuted:false}));
