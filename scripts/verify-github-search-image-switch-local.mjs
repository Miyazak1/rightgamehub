// Real image-only Compose update and rollback on an isolated synthetic project.
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';import{comparableUpdate}from'./update-github-search-online.mjs';
import{verifyDeclaredRuntime}from'./github-search-runtime-verification.mjs';
const out=path.resolve(process.argv[2]??''),target=process.argv[3],old=process.argv[4]??'sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out)||!/^sha256:[a-f0-9]{64}$/.test(target)||!/^sha256:[a-f0-9]{64}$/.test(old))throw Error('NEW_ISOLATED_TEST_REQUIRED');fs.mkdirSync(out);
const task='github-update-'+crypto.randomBytes(6).toString('hex'),key='mooyu.github.update.test',command=['node','-e',"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"];
const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2000000});if(r.status!==0){fs.writeFileSync(path.join(out,'synthetic-failure.txt'),r.stderr??'');throw Error('SYNTHETIC_COMPOSE_FAILED');}return r.stdout.trim();};
const services=Object.fromEntries(['api','agent-interactions','protected'].map(service=>[service,{image:old,entrypoint:[],command,healthcheck:{disable:true},labels:{[key]:task},restart:'unless-stopped',environment:{KEEP_HISTORY:'true'},volumes:service==='api'?['history:/data']:[]} ]));
fs.writeFileSync(path.join(out,'base.json'),JSON.stringify({services,volumes:{history:{labels:{[key]:task}}},networks:{default:{internal:true,labels:{[key]:task}}}}));
for(const service of ['api','agent-interactions'])for(const [mode,image]of [['candidate',target],['rollback',old]])fs.writeFileSync(path.join(out,service+'-'+mode+'.json'),JSON.stringify({services:{[service]:{image}}}));
const base=['compose','--project-directory',out,'-p',task,'-f',path.join(out,'base.json')],inspect=n=>JSON.parse(run(['inspect',n]))[0],up=(args,service)=>run([...args,'up','-d','--no-deps','--no-build','--pull','never',...(service?[service]:[])]);let result;
try{
 up(base);const baseline=Object.fromEntries(Object.keys(services).map(s=>[s,inspect(task+'-'+s+'-1')]));run(['exec',task+'-api-1','node','-e',"require('fs').writeFileSync('/data/history','preserve')"]);
 for(const mode of ['candidate','rollback']){
  for(const s of ['agent-interactions','api'])run(['stop','--timeout','-1',task+'-'+s+'-1']);
  for(const s of ['api','agent-interactions']){
   const args=mode==='candidate'?[...base]:[...base,'-f',path.join(out,s+'-candidate.json')];args.push('-f',path.join(out,s+'-'+mode+'.json'));up(args,s);
   const c=inspect(task+'-'+s+'-1');assert.equal(c.Image,mode==='candidate'?target:old);assert.deepEqual(comparableUpdate(c),comparableUpdate(baseline[s]));
   const model=JSON.parse(run([...args,'--profile','*','config','--format','json']));const image=JSON.parse(run(['image','inspect',c.Image]))[0];verifyDeclaredRuntime(c,model.services[s],image);
  }
  const p=inspect(task+'-protected-1');assert.equal(p.Id,baseline.protected.Id);assert.equal(p.State.StartedAt,baseline.protected.State.StartedAt);assert.equal(run(['exec',task+'-api-1','node','-e',"process.stdout.write(require('fs').readFileSync('/data/history'))"]),'preserve');
 }
 result={result:'PASSED',image:target,baseImage:old,realComposeSwitchAndRollback:true,onlyTwoSyntheticRolesRecreated:true,configurationAndAliasesPreserved:true,unrelatedContainerNotRestarted:true,historyVolumePreserved:true,productionChanged:false};
}finally{
 for(const id of run(['ps','-aq','--filter','label='+key+'='+task]).split(/\s+/).filter(Boolean)){assert.equal(inspect(id).Config.Labels[key],task);run(['rm','-f',id]);}
 for(const type of ['volume','network'])for(const n of run([type,'ls','--filter','label='+key+'='+task,'--format','{{.Name}}']).split(/\s+/).filter(Boolean)){assert.equal(JSON.parse(run([type,'inspect',n]))[0].Labels[key],task);run([type,'rm',n]);}
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,testResourcesCleaned:true},null,2)+'\n');console.log(JSON.stringify(result));
