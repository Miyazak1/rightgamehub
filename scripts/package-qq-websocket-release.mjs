import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fileHash} from './qq-independent-release-common.mjs';import {WS_RELEASE,WS_STAGE,WS_RECORD,WS_BASE_IMAGE,WS_PATCH_SHA256} from './qq-websocket-release-common.mjs';import {NAPCAT_OWNER_BASE_SHA256} from './patch-napcat-websocket-owner.mjs';
const [outArg,opsArg,switchArg,policyArg]=process.argv.slice(2),out=path.resolve(outArg??''),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
if(!outArg||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261128\\')||fs.existsSync(out)||!opsArg||!switchArg||!policyArg)throw Error('NEW_OUTPUT_AND_COMPLETE_PROOFS_REQUIRED');
const ops=read(opsArg),sw=read(switchArg),policy=read(policyArg),real=read('docs/releases/qq-owner-local-acceptance-20261127.json');
if(policy.result!=='PASSED'||policy.tests!==1||policy.pass!==1||policy.fail!==0||policy.skipped!==0||!policy.recordsUnchanged||policy.policySourceSha256!==fileHash('scripts/qq-websocket-window-policy.mjs')||policy.testSourceSha256!==fileHash('tests/platform/qq-websocket-outbox-db.test.mjs'))throw Error('TERMINAL_WINDOW_POLICY_PROOF_REQUIRED');
for(const p of [ops,sw])if(p.result!=='PASSED'||p.updaterSourceSha256!==fileHash('scripts/update-qq-websocket-owner.mjs')||p.commonSourceSha256!==fileHash('scripts/qq-websocket-release-common.mjs'))throw Error('OPERATOR_PROOF_STALE');
if(ops.windowPolicySourceSha256!==fileHash('scripts/qq-websocket-window-policy.mjs')||!ops.terminalRuntimeClaimsRefused||ops.fail||ops.skipped||ops.tests!==10||!ops.realPostgresNewMessageAcceptance||!ops.coldBackupFailureRecoverableByExplicitRollback||!ops.scanRequiredStateHandled||!sw.realComposeGatewaySwitchAndRollback||!sw.workerSameContainerAndImage||!sw.loginVolumeAndDataRetained||!sw.otherExistingContainersUnchanged||real.result!=='PASSED'||real.realQQ.deliveredMessages!==4||real.stability.newMessageAfterWindow!==true)throw Error('COMPLETE_LOCAL_ACCEPTANCE_REQUIRED');
fs.mkdirSync(out,{recursive:true});const payload=path.join(out,'payload');fs.mkdirSync(payload);
const copy=(a,b)=>{const target=path.join(payload,b);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(a,target);};
for(const n of ['qq-websocket-window-policy.mjs','update-qq-websocket-owner.mjs','qq-websocket-release-common.mjs','patch-napcat-websocket-owner.mjs','agent-server-cutover.mjs','qq-independent-release-common.mjs','qq-plugin-guardian.mjs','github-search-runtime-verification.mjs','recover-qq-gateway-once.mjs'])copy('scripts/'+n,'scripts/'+n);
copy('apps/qq-channel/src/recovery-policy.mjs','apps/qq-channel/src/recovery-policy.mjs');copy('docs/qq-websocket-owner-release-20261128.zh-CN.md','README.zh-CN.md');copy(opsArg,'proofs/operations-acceptance.json');copy(switchArg,'proofs/compose-acceptance.json');copy(policyArg,'proofs/terminal-window-acceptance.json');copy('docs/releases/qq-owner-local-acceptance-20261127.json','proofs/real-qq-acceptance.json');
const walk=(dir,prefix='')=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{if(e.isSymbolicLink())throw Error('NO_ARCHIVE_SYMLINKS');return e.isDirectory()?walk(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name];});
const manifest={schemaVersion:'qq-websocket-owner-patch-v1',releaseId:WS_RELEASE,fixSourceRef:'refs/tags/qq-websocket-owner-source-20261127-r1',toolingSourceRef:'refs/tags/qq-websocket-release-source-20261128-r2',baseImage:WS_BASE_IMAGE,baseSourceSha256:NAPCAT_OWNER_BASE_SHA256,patchedSourceSha256:WS_PATCH_SHA256,updatedServices:['mooyu-qq-napcat-1'],stopStartSameContainer:['mooyu-qq-worker-1'],guardianFieldsChanged:['image','identityHash'],guardianCapsAndStateChanged:false,apiWebExecutorSchedulerDatabaseDesktopRestarts:false,oldTasksRetried:false,paperDevelopmentIncluded:false,files:walk(payload).map(p=>({path:p,sha256:fileHash(path.join(payload,p))}))};
fs.writeFileSync(payload+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');const files=walk(payload);fs.writeFileSync(payload+'/SHA256SUMS',files.map(p=>fileHash(path.join(payload,p))+'  '+p).join('\n')+'\n');files.push('SHA256SUMS');
for(const p of files.filter(p=>p.endsWith('.mjs'))){const r=spawnSync(process.execPath,['--check',path.join(payload,p)],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('PACKAGED_MODULE_PARSE_FAILED:'+p);}
const filename=WS_RELEASE+'.tar.gz',archive=path.join(out,filename),tar=spawnSync('tar',['-czf',archive,'-C',payload,...files],{encoding:'utf8',windowsHide:true,timeout:120000});if(tar.status!==0)throw Error('ARCHIVE_FAILED');const digest=fileHash(archive);fs.writeFileSync(archive+'.sha256',digest+'  '+filename+'\n');
const runtime=`runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node /root/mooyu-github-search-runtime-20261124-*/node; do
  if test -f "$candidate" && test -x "$candidate" && test ! -L "$candidate"; then
    case "$("$candidate" --version)" in v22.*) runtime="$candidate"; break ;; esac
  fi
done
test -n "$runtime" || { echo VERIFIED_PRIVATE_NODE_NOT_FOUND; exit 2; }
`;
const lock='exec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexec 8>/var/lock/mooyu-qq-guardian.lock\nflock -w 20 8\n',check=`base='${WS_STAGE}'
test -d "$base" && test ! -L "$base"
cd "$base"
sha256sum --check SHA256SUMS
`,auth=`export MOOYU_QQ_WEBSOCKET_AUTH='${WS_RELEASE}'\n`;
const commands={
 'server-create-upload-directory.txt':`(\nset -euo pipefail\numask 077\nbase='${WS_STAGE}'\ntest ! -e "$base" && test ! -L "$base"\nmkdir -m 700 -- "$base"\nprintf '上传目录：%s\\n' "$base"\n)\n`,
 'server-prepare-and-plan.txt':`(\nset -euo pipefail\numask 077\n${lock}base='${WS_STAGE}'\ntest -d "$base" && test ! -L "$base"\ncd "$base"\ntest -z "$(find . -mindepth 1 -maxdepth 1 ! -name '${filename}' ! -name '${filename}.sha256' -print -quit)"\nprintf '%s  %s\\n' '${digest}' '${filename}' | sha256sum --check -\nsha256sum --check '${filename}.sha256'\ntar --no-same-owner --no-same-permissions -xzf '${filename}'\nsha256sum --check SHA256SUMS\n${runtime}nice -n 10 "$runtime" scripts/update-qq-websocket-owner.mjs plan\n)\n`,
 'server-check-plan.txt':`(\nset -euo pipefail\numask 077\n${lock}${check}${runtime}nice -n 10 "$runtime" scripts/update-qq-websocket-owner.mjs plan\n)\n`,
 'server-update-gateway.txt':`(\nset -euo pipefail\numask 077\n${lock}${check}${runtime}${auth}nice -n 10 "$runtime" scripts/update-qq-websocket-owner.mjs upgrade\n)\n`
};
for(const mode of ['rollback','acceptance']){
 const code=`import fs from 'node:fs';import{spawnSync}from'node:child_process';const stage=${JSON.stringify(WS_STAGE)},index=JSON.parse(fs.readFileSync(stage+'/last-operation.private.json','utf8'));if(index.releaseId!==${JSON.stringify(WS_RELEASE)}||index.mode!=='upgrade'||!new RegExp('^'+${JSON.stringify(WS_RECORD)}+'[A-Za-z0-9]+$').test(index.record))throw Error('EXACT_NEW_UPGRADE_RECORD_REQUIRED');const r=spawnSync(process.execPath,[stage+'/scripts/update-qq-websocket-owner.mjs',${JSON.stringify(mode)},index.record],{stdio:'inherit',env:process.env});process.exitCode=r.status??1;`;
 commands[mode==='rollback'?'server-rollback-gateway.txt':'server-check-new-message.txt']=`(\nset -euo pipefail\numask 077\n${mode==='rollback'?lock:''}${check}${runtime}${mode==='rollback'?auth:''}"$runtime" --input-type=module <<'NODE'\n${code}\nNODE\n)\n`;
}
for(const [n,body]of Object.entries(commands)){const r=spawnSync('C:/Program Files/Git/bin/bash.exe',['-n'],{input:body,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('BASH_SYNTAX_FAILED:'+n);fs.writeFileSync(path.join(out,n),body);}
fs.copyFileSync('docs/qq-websocket-owner-release-20261128.zh-CN.md',out+'/README.zh-CN.md');
const result={result:'QQ_WEBSOCKET_RELEASE_PREPARED_NOT_DEPLOYED',archive,sha256:digest,bytes:fs.statSync(archive).size,stage:WS_STAGE,fixSourceRef:manifest.fixSourceRef,toolingSourceRef:manifest.toolingSourceRef,commands:Object.keys(commands),updatedServices:manifest.updatedServices,stopStartSameContainer:manifest.stopStartSameContainer,guardianFieldsChanged:manifest.guardianFieldsChanged,otherServicesRestarted:false,productionAccessed:false,oldTasksRetried:false};fs.writeFileSync(out+'/package-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
