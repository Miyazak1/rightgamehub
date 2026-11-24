// Local artifact only; no server operations happen here.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('./authorized-agent-upgrade.mjs',import.meta.url),'utf8');
const body=source+"\nawait deployAuthorized().catch(e=>{console.error(JSON.stringify({result:'UPGRADE_ENTRY_REFUSED',code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED',automaticRetry:false}));process.exitCode=1;});\n";
const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:body,encoding:'utf8'});if(syntax.status!==0)throw Error('UPGRADE_COMMAND_SYNTAX_FAILED');
const shell="# Authorized scope: plugin upgrade + fresh Agent-quiesced dual backups.\n(\nset -euo pipefail\numask 077\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_AUTHORIZED_RELEASE_LOCK=20261123\nnice -n 10 /www/backup/gamehub/agent-plugins-stage-20261122-r3/node --input-type=module <<'NODE'\n"+body+"NODE\n)\n";
const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';if(spawnSync(bash,['-n'],{input:shell,encoding:'utf8'}).status!==0)throw Error('UPGRADE_SHELL_SYNTAX_FAILED');
const out=path.resolve('deploy/agent-plugins/server-authorized-upgrade-20261123-command.txt');fs.writeFileSync(out,shell,{flag:'wx'});console.log(JSON.stringify({result:'AUTHORIZED_UPGRADE_COMMAND_GENERATED_LOCALLY',output:out,nodeAndShellSyntaxPassed:true,serverCommandExecuted:false}));
