import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const out=process.argv[2];
if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_DIRECTORY_REQUIRED');
let source=fs.readFileSync(new URL('./recover-qq-gateway-once.mjs',import.meta.url),'utf8');
const once=(from,to)=>{if(source.split(from).length!==2)throw Error('SOURCE_ANCHOR_REQUIRED');source=source.replace(from,to);};
// Earlier deployment fingerprints precede two subsequently authorized updates.
// Keep that record immutable and verify the current successful worker repair,
// then freeze all current non-gateway containers for this one operation.
once("const oldSnapshot=()=>",`function currentRepairCheck(){
 const worker=JSON.parse(docker(['inspect','mooyu-qq-worker-1']))[0];
 if(!worker.State.Running||worker.State.Health?.Status!=='healthy')fail('REPAIRED_WORKER_NOT_HEALTHY');
 const receipts=fs.readdirSync(ROOT).filter(n=>/^qq-auth-client-operation-20261123-[A-Za-z0-9]+$/.test(n)).filter(n=>fs.existsSync(ROOT+'/'+n+'/result.private.json')).map(n=>read(ROOT+'/'+n+'/result.private.json')).filter(r=>r.result==='QQ_AUTH_CLIENT_UPDATED_VERIFIED'&&r.image===worker.Image&&r.onlyQQWorkerRecreated&&r.papersStillClosed);
 if(receipts.length!==1)fail('CURRENT_WORKER_REPAIR_RECEIPT_REQUIRED');
 const g=onlyGateway();if(g.Image!=='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d')fail('ORIGINAL_GATEWAY_IMAGE_REQUIRED');
 for(const n of ['gamehub-production-agent-paper-research-worker-1','mooyu-desktop-business-test-business-paper-worker-1']){const c=JSON.parse(docker(['inspect',n]))[0];if(c.State.Running||c.HostConfig.RestartPolicy.Name!=='no')fail('PAPERS_MUST_REMAIN_CLOSED');}
 }
 const oldSnapshot=()=>`);
once("tool.checkConfiguration();deliveryCheck();deploymentStateHash",'currentRepairCheck();deliveryCheck();deploymentStateHash');
once('protectedCheck();tool.checkConfiguration();deliveryCheck();offlineCheck();','protectedCheck();currentRepairCheck();deliveryCheck();offlineCheck();');
once("status='sending'","status NOT IN ('delivered','failed','cancelled')");
once("'20261123-once'","'20261123-duplicate-login-once'");
once("ROOT+'/qq-gateway-recovery-once-20261123-'","ROOT+'/qq-gateway-duplicate-login-recovery-20261123-'");
const body=source+'\nawait recoverGatewayOnce();\n';
const node=spawnSync(process.execPath,['--input-type=module','--check'],{input:body,encoding:'utf8'});
if(node.status!==0)throw Error('NODE_SYNTAX_FAILED');
const shell="(\nset -euo pipefail\numask 077\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexport MOOYU_GATEWAY_RECOVERY_AUTH=20261123-duplicate-login-once\nnice -n 10 /www/backup/gamehub/agent-plugins-stage-20261122-r3/node --input-type=module <<'NODE'\n"+body+'NODE\n)\n';
const bash=spawnSync('C:\\Program Files\\Git\\bin\\bash.exe',['-n'],{input:shell,encoding:'utf8',windowsHide:true});
if(bash.status!==0)throw Error('SHELL_SYNTAX_FAILED');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'server-gateway-recovery-once.txt'),shell);
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({result:'PREPARED_NOT_EXECUTED',separateAuthorizationRequired:true,scope:'same QQ gateway container normal stop/start once',loginDataBackups:['before-stop','while-stopped'],noContainerRecreate:true,noImageUpgrade:true,noLoginDataDeletion:true,noDatabaseRestore:true,noAutomaticSecondRestart:true,otherContainersMustRemainUnchanged:true,papersMustRemainClosed:true,limitation:'Does not prove or permanently fix the native duplicate-login callback; real login verification required.'},null,2)+'\n');
console.log(JSON.stringify({result:'PREPARED_NOT_EXECUTED',directory:out}));
