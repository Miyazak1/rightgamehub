import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {SCOPES_PRIVATE_RUNTIME} from './github-search-scopes-release.mjs';
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_PATH_REQUIRED');
const command=out+'.command.txt';fs.writeFileSync(command,'(\nset -euo pipefail\n'+SCOPES_PRIVATE_RUNTIME+'\nnice -n 10 "$runtime/node" --version\n)\n',{flag:'wx'});
const r=spawnSync(process.execPath,['scripts/verify-napcat-runtime-bootstrap-local.mjs',out,command],{stdio:'inherit',windowsHide:true,timeout:150000});process.exitCode=r.status??1;
