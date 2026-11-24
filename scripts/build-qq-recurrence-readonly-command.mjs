import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const body=fs.readFileSync(new URL('./qq-recurrence-readonly.mjs',import.meta.url),'utf8');
const nested=[...body.matchAll(/const (?:nativeCode|controlCode)=String.raw`([\s\S]*?)`;/g)].map(m=>m[1]);
for(const text of [body,...nested])if(spawnSync(process.execPath,['--input-type=module','--check'],{input:text,encoding:'utf8'}).status!==0)throw Error('NODE_SYNTAX_FAILED');
const command="nice -n 10 /www/backup/gamehub/agent-plugins-stage-20261122-r3/node --input-type=module <<'NODE'\n"+body+'\nNODE\n';
if(spawnSync('C:\\Program Files\\Git\\bin\\bash.exe',['-n'],{input:command,encoding:'utf8',windowsHide:true}).status!==0)throw Error('SHELL_SYNTAX_FAILED');
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_DIRECTORY_REQUIRED');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'server-readonly-command.txt'),command);console.log(JSON.stringify({result:'READONLY_COMMAND_PREPARED',command:path.join(out,'server-readonly-command.txt')}));
