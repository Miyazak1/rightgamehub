import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {QQ_BASES,runtimeComparable} from './qq-independent-release-common.mjs';
const release=path.resolve(process.argv[2]??''),b=JSON.parse(fs.readFileSync(path.join(release,'build-proof-final.json'),'utf8')),out=path.join(release,'switch-acceptance');if(fs.existsSync(out))throw Error('NEW_SWITCH_PROOF_REQUIRED');fs.mkdirSync(out);
const id=crypto.randomBytes(8).toString('hex'),project='qq-independent-switch-'+id,label='mooyu.qq.independent.switch';
const run=a=>{const r=spawnSync('docker',a,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:4*1024*1024});if(r.status!==0)throw Error('ISOLATED_COMPOSE_'+a[0]+'_FAILED');return r.stdout.trim();},inspect=n=>JSON.parse(run(['inspect',n]))[0];
const old={api:QQ_BASES.api,worker:QQ_BASES.localWorker,web:QQ_BASES.web},service=image=>({image,entrypoint:['sh','-c'],command:["trap 'exit 0' TERM; while :; do sleep 1; done"],restart:'unless-stopped',healthcheck:{disable:true},labels:{[label]:id},environment:{PAPER_STUDY_ENABLED:'false',KEEP_EXISTING_HISTORY:'true'}});
fs.writeFileSync(path.join(out,'base.json'),JSON.stringify({services:{...Object.fromEntries(Object.entries(old).map(([k,v])=>[k,{...service(v),volumes:[k+'-data:/data-test']}])),'protected-gateway':{...service(QQ_BASES.api),volumes:['login-data:/login-test']}},volumes:Object.fromEntries(['api-data','worker-data','web-data','login-data'].map(n=>[n,{labels:{[label]:id}}])),networks:{default:{internal:true,labels:{[label]:id}}}}));
for(const mode of ['upgrade','rollback'])fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify({services:Object.fromEntries(Object.entries(old).map(([k,v])=>[k,{image:mode==='upgrade'?b.images[k].id:v}]))}));
const base=['compose','--project-directory',out,'-p',project,'-f',path.join(out,'base.json')];let result;
try{
 run([...base,'up','-d','--no-build','--pull','never']);const originals=Object.fromEntries(['api','worker','web'].map(k=>[k,inspect(project+'-'+k+'-1')])),gateway=inspect(project+'-protected-gateway-1');
 for(const k of ['api','worker','web'])run(['exec','--user','0',project+'-'+k+'-1','sh','-c','echo preserved > /data-test/history']);run(['exec','--user','0',gateway.Id,'sh','-c','echo preserved-login > /login-test/session']);
 for(const mode of ['upgrade','rollback']){
  const chain=[...base,'-f',path.join(out,mode+'.json')];for(const k of ['worker','api'])run(['stop','--timeout','-1',project+'-'+k+'-1']);
  for(const k of ['api','worker','web']){run([...chain,'up','-d','--no-deps','--no-build','--pull','never',k]);const c=inspect(project+'-'+k+'-1');assert.equal(c.Image,mode==='upgrade'?b.images[k].id:old[k]);assert.deepEqual(runtimeComparable(c),runtimeComparable(originals[k]));assert.equal(run(['exec',c.Id,'cat','/data-test/history']),'preserved');}
  const g=inspect(project+'-protected-gateway-1');assert.equal(g.Id,gateway.Id);assert.equal(g.State.StartedAt,gateway.State.StartedAt);assert.equal(g.RestartCount,gateway.RestartCount);assert.equal(run(['exec',g.Id,'cat','/login-test/session']),'preserved-login');
 }
 result={result:'PASSED',realComposeThreeRoleUpdateAndRollback:true,images:b.images,localWorkerReferenceBase:QQ_BASES.localWorker,serverWorkerBaseNotAvailableLocally:true,protectedSyntheticGatewayNeverRestarted:true,syntheticHistoryAndLoginVolumesPreserved:true,productionChanged:false};
}finally{
 for(const c of run(['ps','-aq','--filter','label='+label+'='+id]).split(/\s+/).filter(Boolean)){assert.equal(inspect(c).Config.Labels[label],id);run(['rm','-f',c]);}
 for(const kind of ['volume','network'])for(const n of run([kind,'ls','--filter','label='+label+'='+id,'--format','{{.Name}}']).split(/\s+/).filter(Boolean)){assert.equal(JSON.parse(run([kind,'inspect',n]))[0].Labels[label],id);run([kind,'rm',n]);}
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,ownedTestResourcesCleaned:true},null,2)+'\n');console.log(JSON.stringify(result));
