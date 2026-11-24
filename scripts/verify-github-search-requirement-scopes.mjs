// Local fixtures only: no server access, credentials, provider or network calls.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const out=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_BUILD_DIRECTORY_REQUIRED');
fs.mkdirSync(out,{recursive:true});
const suites=['github-search-verification-recovery.test.mjs','github-search-requirement-scopes.test.mjs','github-search-quality.test.mjs','github-search-plan-format.test.mjs','github-search-verification-format.test.mjs','agent-github-question.test.mjs','agent-github-repository-materials.test.cjs','agent-github-source-archive-date.test.cjs','agent-task-receipt-grounding.test.mjs','agent-plugin-runtime.test.mjs','agent-plugin-host.test.mjs'];
const r=spawnSync(process.execPath,['--test',...suites.map(f=>'tests/platform/'+f)],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(out,'tests.tap'),r.stdout??'');fs.writeFileSync(path.join(out,'tests.stderr.txt'),r.stderr??'');
const count=label=>Number((r.stdout??'').match(new RegExp('^# '+label+' (\\d+)$','m'))?.[1]??0);
const sourceHashes=Object.fromEntries(['apps/api/src/agent-plugins/github/search.mjs',...suites.map(f=>'tests/platform/'+f)].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const result={result:r.status===0?'PASSED':'FAILED',exitCode:r.status,tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),suites,sourceHashes,githubAndModelResponses:'deterministic-fixtures',productionAccessed:false,servicesRestarted:false,credentialsRead:false};
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(r.status!==0)process.exitCode=1;
