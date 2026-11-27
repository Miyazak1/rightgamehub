// Bounded read-only stability observation of the existing opt-in local QQ lab.
// Does not create a native management client, send messages or restart services.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const directory=path.resolve(process.argv[2]??''),duration=Number(process.argv[3]??600);
assert(directory.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261127\\'),'LOCAL_LAB_REQUIRED');
assert(Number.isInteger(duration)&&duration>=600&&duration<=1800,'TEN_TO_THIRTY_MINUTE_WINDOW_REQUIRED');
const lab=JSON.parse(fs.readFileSync(path.join(directory,'lab.json'),'utf8')),url=new URL(lab.url);
assert(/^qq_owner_local_[a-f0-9]{20}$/.test(lab.labId));assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
const id=lab.labId.slice('qq_owner_local_'.length),names=[lab.gateway,lab.worker,lab.database];
const inspect=()=>{
 const r=spawnSync('docker',['inspect',...names],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:2*1024*1024});assert.equal(r.status,0,'LOCAL_INSPECT_FAILED');
 return JSON.parse(r.stdout).map(c=>{assert.equal(c.Config.Labels?.['right.qq.owner-local'],id);assert.equal(c.State.Running,true);return {name:c.Name,id:c.Id,image:c.Image,started:c.State.StartedAt,restarts:c.RestartCount};});
};
const baseline=inspect(),start=Date.now(),samples=[],tag=new Date(start).toISOString().replace(/[:.]/g,'-');let previousVerified=0;
const file=path.join(directory,'stability-'+tag+'.json');
const save=result=>fs.writeFileSync(file,JSON.stringify({result,startedAt:new Date(start).toISOString(),observedSeconds:(Date.now()-start)/1000,requiredSeconds:duration,
 baseline,samples,mode:'real QQ passive status; no test messages generated',productionAccessed:false,servicesRestarted:false},null,2)+'\n');
console.log(JSON.stringify({result:'LOCAL_STABILITY_OBSERVATION_STARTED',file,requiredSeconds:duration}));
try{
 while(true){
  const r=await fetch(lab.url+'/local-status',{signal:AbortSignal.timeout(10000)});assert(r.ok,'LOCAL_STATUS_UNAVAILABLE');const s=await r.json(),v=s.runtime;
  assert(s.paperEnabled===false&&v?.available===true&&v.loggedIn===true&&v.coreReady===true&&v.accountMatches===true&&v.groupReady===true&&v.connected===true&&v.observation==='fresh','QQ_READINESS_LOST');
  const checked=Date.parse(v.checkedAt),verified=Date.parse(v.verifiedAt);assert(Date.now()-checked<20000&&Date.now()-verified<20000,'QQ_OBSERVATION_STALE');
  assert(verified>previousVerified,'QQ_OBSERVATION_NOT_ADVANCING');previousVerified=verified;
  assert.deepEqual(inspect(),baseline,'LOCAL_CONTAINER_RESTARTED_DURING_OBSERVATION');
  assert((s.status?.states??[]).every(row=>row.status==='delivered'),'UNDELIVERED_OR_FAILED_MESSAGE');assert.equal(s.status?.review?.length,0);
  samples.push({at:new Date().toISOString(),checkedAt:v.checkedAt,verifiedAt:v.verifiedAt,loggedIn:v.loggedIn,coreReady:v.coreReady,groupReady:v.groupReady,connected:v.connected,states:s.status.states,budget:s.status.budget});save('RUNNING');
  if(Date.now()-start>=duration*1000)break;
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 save('PASSED');console.log(JSON.stringify({result:'LOCAL_STABILITY_WINDOW_PASSED',seconds:(Date.now()-start)/1000,samples:samples.length,file,
 limit:'Passive readiness does not prove continued event delivery; a new post-window real QQ message is still required.'}));
}catch(e){save('FAILED');console.error(JSON.stringify({result:'LOCAL_STABILITY_WINDOW_FAILED',code:/^[A-Z_]+$/.test(e.message??'')?e.message:'LOCAL_OBSERVATION_FAILED',file}));process.exitCode=1;}
