import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

test('incident diagnostic only reads existing snapshots and whitelisted metadata, never prints secrets or requests recovery',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/qq-independent-incident-readonly.mjs',import.meta.url),'utf8');
 const output=[],commands=[],secret='DO_NOT_PRINT_RAW_LOGIN_ERROR_OR_TOKEN',base='/www/backup/gamehub/qq-independent-guardian-20261124-r1';
 const files=new Map([[base+'/config.private.json',{enabled:true,version:1,gateway:'mooyu-qq-napcat-1',worker:'mooyu-qq-worker-1',botId:'3922489710',groupId:'905757031',image:'sha256:fixture',secret}],
  [base+'/recovery-state.private.json',{version:1,lastAt:1,attempts:[1],manualRequired:true,incidentHandled:true,lastOutcome:'review-required',recoveryDirectory:secret,incident:null}]]);
 const key=p=>p.replaceAll('\\','/');
 const readOnlyFs={lstatSync:p=>{assert(files.has(key(p)));return {isFile:()=>true,isSymbolicLink:()=>false,size:100};},readFileSync:p=>JSON.stringify(files.get(key(p))),existsSync:p=>files.has(key(p))};
 const spawnSync=(command,args)=>{
  commands.push([command,args]);let value='';
  if(command==='docker'){
   assert(['inspect','exec','logs'].includes(args[0]));
   if(args[0]==='inspect')value=JSON.stringify([{Id:'a'.repeat(64),Image:'sha256:fixture',State:{Running:true,Restarting:false,OOMKilled:false,StartedAt:'2026-11-25T00:00:00Z'},RestartCount:0,Config:{Env:['NAPCAT_DISABLE_MULTI_PROCESS=0','SECRET='+secret]}}]);
   if(args[0]==='exec'){
    assert.equal(args[1],'mooyu-qq-worker-1');assert.equal(args[2],'node');const code=args.at(-1);
    assert(!/QQLogin|auth\/login|operation:'(?:qr|refresh|password)'/.test(code));
    value=code.includes("operation:'status'")?JSON.stringify({runtime:{snapshotVersion:2,available:false,observation:'stale'},expectedBot:true,expectedGroup:true}):JSON.stringify({'napcat-control.mjs':'a'.repeat(64)});
   }
   if(args[0]==='logs')value=secret+' login rate limit';
  }else if(command==='systemctl'){assert.equal(args[0],'show');value='LoadState=loaded\nActiveState=failed\nResult=exit-code';}
  else if(command==='journalctl')value=JSON.stringify({result:'QQ_GUARDIAN_REVIEW_REQUIRED',code:'QQ_WORKER_SNAPSHOT_CONTRACT_REQUIRED',raw:secret});
  else assert.fail('unexpected command '+command);
  return {status:0,stdout:value,stderr:''};
 };
 const body=source.replace(/^import .*;\r?\n/gm,'');
 await new (Object.getPrototypeOf(async function(){}).constructor)('fs','path','crypto','spawnSync','console','setTimeout',body)(readOnlyFs,path,crypto,spawnSync,{log:v=>output.push(JSON.parse(v))},fn=>fn());
 assert.equal(output.filter(o=>o.section==='existingWorkerSnapshot').length,2);
 assert.equal(output.find(o=>o.section==='guardianState').manualRequired,true);
 assert.equal(output.find(o=>o.section==='guardianOutcomes').outcomes[0].code,'QQ_WORKER_SNAPSHOT_CONTRACT_REQUIRED');
 assert.equal(output.find(o=>o.section==='readOnlyEnd').newNapcatManagementClients,0);
 assert.equal(JSON.stringify(output).includes(secret),false);
 assert(commands.length>0);
});
