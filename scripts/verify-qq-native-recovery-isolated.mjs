import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {manualReceiveRecoverySequence,reserveManualReceiveRecovery} from './recover-qq-native-reception-once.mjs';
const out=path.resolve(process.argv[2]??'');if(!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_ISOLATED_OUTPUT_REQUIRED');fs.mkdirSync(out,{recursive:true});
const token=crypto.randomBytes(10).toString('hex'),name='right-qq-native-recovery-'+token,volume=name+'-data',label='right.qq.native-recovery-test',image='mooyu-qq-observation:20261125-r2';
const docker=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1048576,...options});if(r.status!==0||r.error){proof.failedTestCommand=args.slice(0,2);proof.testToolError=String(r.stderr??r.error?.code??'').slice(0,500);throw Error('ISOLATED_DOCKER_FAILED');}return r.stdout?.trim()??'';};
const inspect=()=>JSON.parse(docker(['inspect',name]))[0],hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let made=false,volumeMade=false,stops=0,starts=0;const receipts=[],proof={result:'FAILED',productionChanged:false,nativeQQStarted:false,network:'none'};
try{
 docker(['volume','create','--label',label+'='+token,volume]);volumeMade=true;
 docker(['run','-d','--name',name,'--label',label+'='+token,'--pull','never','--network','none','--read-only','--init','--user','0','--mount','type=volume,source='+volume+',target=/data','--entrypoint','node',image,'-e',"require('fs').writeFileSync('/data/fixture.txt','synthetic-login-fixture');process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);"]);made=true;
 await new Promise(r=>setTimeout(r,500));const before=inspect(),identity=c=>JSON.stringify({id:c.Id,image:c.Image,config:c.Config,host:c.HostConfig,mounts:c.Mounts});
 const guard=running=>{const c=inspect();if(c.Config.Labels[label]!==token||c.State.Running!==running||c.HostConfig.NetworkMode!=='none'||identity(c)!==identity(before))throw Error('ISOLATED_IDENTITY_CHANGED');};
 const backup=cold=>{const file=path.join(out,cold?'login-stopped.tar':'login-before-stop.tar'),fd=fs.openSync(file,'wx');try{docker(['cp','-a',name+':/data/.','-'],{encoding:null,stdio:['ignore',fd,'pipe']});}finally{fs.closeSync(fd);}for(const a of [['-tf',file],['-xOf',file]]){const r=spawnSync('tar',a,{stdio:['ignore','ignore','pipe'],timeout:10000});if(r.status!==0)throw Error('ISOLATED_ARCHIVE_INVALID');}receipts.push({quiesced:cold,sha256:hash(file),fullyRead:true});};
 const now=Date.now(),initial={version:1,attempts:[],incident:null,stableSince:null,manualRequired:false,lastAt:now-1};
 await manualReceiveRecoverySequence({reserved:reserveManualReceiveRecovery(initial,now),io:{guard:()=>guard(true),save:s=>fs.writeFileSync(path.join(out,'fixture-state.json'),JSON.stringify(s)),backup,confirmIncident:async()=>{},assertIdle:async()=>{},
 stop:()=>{stops++;docker(['stop','--timeout','-1',name]);},guardStopped:()=>guard(false),start:()=>{starts++;docker(['start',name]);},verify:()=>guard(true)}});
 const after=inspect(),data=docker(['exec',name,'node','-e',"console.log(require('fs').readFileSync('/data/fixture.txt','utf8'))"]);
 if(stops!==1||starts!==1||data!=='synthetic-login-fixture'||after.State.StartedAt===before.State.StartedAt)throw Error('ISOLATED_RESTART_VERIFICATION_FAILED');
 Object.assign(proof,{result:'PASSED',sameContainerImageAndVolume:identity(before)===identity(after),fixturePreserved:true,stops,starts,backups:receipts});
}catch(e){proof.error=/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'ISOLATED_TEST_FAILED';process.exitCode=1;}
finally{
 if(made){const c=inspect();if(c.Config.Labels[label]!==token||c.HostConfig.NetworkMode!=='none')throw Error('TEST_CLEANUP_SCOPE_CHANGED');docker(['rm','-f',name]);}
 if(volumeMade){const v=JSON.parse(docker(['volume','inspect',volume]))[0];if(v.Labels?.[label]!==token)throw Error('TEST_VOLUME_SCOPE_CHANGED');docker(['volume','rm',volume]);}
 proof.testResourcesRemoved=true;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}
