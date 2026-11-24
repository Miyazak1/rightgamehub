import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {gatewayComparable,assertGatewayUlimits} from './repair-napcat-process-mode.mjs';
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_PATH_REQUIRED');fs.mkdirSync(out,{recursive:true});
const id=crypto.randomBytes(8).toString('hex'),project='napcat-mode-compose-'+id,label='mooyu.napcat.mode-compose',image='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d';
const run=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2000000});if(r.status!==0){fs.writeFileSync(path.join(out,'synthetic-error.txt'),(r.stderr??'').slice(0,2000));throw Error('LOCAL_DOCKER_'+args[0]+'_FAILED');}return r.stdout.trim();};
const inspect=n=>JSON.parse(run(['inspect',n]))[0],command=['node','-e','process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'];
const service={image,entrypoint:[],command,environment:{NAPCAT_DISABLE_MULTI_PROCESS:'1'},read_only:true,tmpfs:['/tmp:rw,nosuid,size=128m'],cap_drop:['ALL'],security_opt:['no-new-privileges:true'],init:true,ulimits:{core:0},labels:{[label]:id},restart:'unless-stopped'};
fs.writeFileSync(path.join(out,'base.json'),JSON.stringify({services:{napcat:{...service,volumes:['history:/data']},protected:service},volumes:{history:{labels:{[label]:id}}},networks:{default:{internal:true,labels:{[label]:id}}}}));
for(const [mode,flag]of [['apply','0'],['rollback','1']])fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify({services:{napcat:{environment:{NAPCAT_DISABLE_MULTI_PROCESS:flag}}}}));
const base=['compose','--project-directory',out,'-p',project,'-f',path.join(out,'base.json')];let proof;
try{
 run([...base,'up','-d','--no-build','--pull','never']);const original=inspect(project+'-napcat-1'),other=inspect(project+'-protected-1');
 const canonical=JSON.parse(run([...base,'config','--format','json']));assertGatewayUlimits(original,canonical.services.napcat);const serializedCore=canonical.services.napcat.ulimits.core;
 for(const [mode,flag]of [['apply','0'],['rollback','1']])fs.writeFileSync(path.join(out,mode+'.json'),JSON.stringify({services:{napcat:{image,hostname:original.Config.Hostname,environment:{NAPCAT_DISABLE_MULTI_PROCESS:flag}}}}));
 run(['exec',project+'-napcat-1','node','-e','require("fs").writeFileSync("/data/history","preserved",{mode:0o444});']);
 for(const mode of ['apply','rollback']){
  run(['stop','--timeout','-1',project+'-napcat-1']);const args=[...base,...(mode==='rollback'?['-f',path.join(out,'apply.json')]:[]),'-f',path.join(out,mode+'.json')];run([...args,'up','-d','--no-deps','--no-build','--pull','never','napcat']);
  const c=inspect(project+'-napcat-1');assert.deepEqual(gatewayComparable(c,'1'),gatewayComparable(original,'1'));assert.equal(c.Image,image);assert.equal(c.Config.Hostname,original.Config.Hostname);assertGatewayUlimits(c,JSON.parse(run([...args,'config','--format','json'])).services.napcat);
  assert.equal(run(['exec',project+'-napcat-1','node','-e','process.stdout.write(require("fs").readFileSync("/data/history"));']),'preserved');
  const p=inspect(project+'-protected-1');assert.equal(p.Id,other.Id);assert.equal(p.State.StartedAt,other.State.StartedAt);
 }
 proof={result:'PASSED',realComposeModeSwitchAndRollback:true,canonicalUlimitsVerified:true,serializedCore,imageUnchanged:true,hostnamePreserved:true,historyPreserved:true,otherContainerNotRestarted:true,productionChanged:false,nativeLoginTested:false};
}finally{
 for(const c of run(['ps','-aq','--filter','label='+label+'='+id]).split(/\s+/).filter(Boolean)){assert.equal(inspect(c).Config.Labels[label],id);run(['rm','-f',c]);}
 for(const type of ['volume','network'])for(const n of run([type,'ls','--filter','label='+label+'='+id,'--format','{{.Name}}']).split(/\s+/).filter(Boolean)){assert.equal(JSON.parse(run([type,'inspect',n]))[0].Labels[label],id);run([type,'rm',n]);}
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...proof,testResourcesRemoved:true},null,2)+'\n');console.log(JSON.stringify(proof));
