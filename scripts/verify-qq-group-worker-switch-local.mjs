import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
import{comparableUpdate}from'./update-github-search-online.mjs';import{verifyDeclaredRuntime}from'./github-search-runtime-verification.mjs';
const out=process.argv[2],old=process.argv[3],target=process.argv[4];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out)||![old,target].every(v=>/^sha256:[a-f0-9]{64}$/.test(v)))throw Error('NEW_LOCAL_TEST_REQUIRED');fs.mkdirSync(out,{recursive:true});
const task='qq-group-'+crypto.randomBytes(6).toString('hex'),label='mooyu.qq.group.local-test';
const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});if(r.status!==0)throw Error('LOCAL_SWITCH_'+args[0]+'_FAILED');return r.stdout.trim();},inspect=n=>JSON.parse(run(['inspect',n]))[0];
const service={image:old,entrypoint:['node','-e'],command:["process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],healthcheck:{disable:true},restart:'unless-stopped',labels:{[label]:task},environment:{KEEP_HISTORY:'true'}};
fs.writeFileSync(path.join(out,'base.json'),JSON.stringify({services:{worker:{...service,volumes:['worker-data:/data']},protected:{...service,volumes:['login-data:/data']}},volumes:Object.fromEntries(['worker-data','login-data'].map(n=>[n,{labels:{[label]:task}}])),networks:{default:{internal:true,labels:{[label]:task}}}}));
for(const[mode,image]of[['candidate',target],['rollback',old]])fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify({services:{worker:{image}}}));
const base=['compose','--project-directory',out,'-p',task,'-f',path.join(out,'base.json')];let result;
try{
 run([...base,'up','-d','--no-build','--pull','never']);const w=inspect(task+'-worker-1'),p=inspect(task+'-protected-1');
 for(const n of ['worker','protected'])run(['exec','--user','0',task+'-'+n+'-1','node','-e',"require('fs').writeFileSync('/data/history','preserve',{mode:0o644})"]);
 for(const mode of ['candidate','rollback']){
  run(['stop','--timeout','-1',task+'-worker-1']);const args=[...base,...(mode==='rollback'?['-f',path.join(out,'candidate.json')]:[]),'-f',path.join(out,mode+'.json')];
  run([...args,'up','-d','--no-deps','--no-build','--pull','never','worker']);const c=inspect(task+'-worker-1');assert.equal(c.Image,mode==='candidate'?target:old);assert.deepEqual(comparableUpdate(c),comparableUpdate(w));
  const model=JSON.parse(run([...args,'config','--format','json'])),image=JSON.parse(run(['image','inspect',c.Image]))[0];verifyDeclaredRuntime(c,model.services.worker,image);
  const after=inspect(task+'-protected-1');assert.equal(after.Id,p.Id);assert.equal(after.State.StartedAt,p.State.StartedAt);assert.equal(after.RestartCount,p.RestartCount);
  for(const n of ['worker','protected'])assert.equal(run(['exec',task+'-'+n+'-1','node','-e',"process.stdout.write(require('fs').readFileSync('/data/history'))"]),'preserve');
 }
 result={result:'PASSED',oldImage:old,targetImage:target,realComposeWorkerOnlyUpdateAndRollback:true,protectedContainerUnchanged:true,syntheticHistoryAndLoginVolumesPreserved:true,productionChanged:false,realGatewayOrLoginDataAccessed:false};
}finally{
 for(const id of run(['ps','-aq','--filter','label='+label+'='+task]).split(/\s+/).filter(Boolean)){assert.equal(inspect(id).Config.Labels[label],task);run(['rm','-f',id]);}
 for(const type of ['volume','network'])for(const n of run([type,'ls','--filter','label='+label+'='+task,'--format','{{.Name}}']).split(/\s+/).filter(Boolean)){assert.equal(JSON.parse(run([type,'inspect',n]))[0].Labels[label],task);run([type,'rm',n]);}
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,testResourcesCleaned:true},null,2)+'\n');console.log(JSON.stringify(result));
