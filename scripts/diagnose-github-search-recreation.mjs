// Read-only diagnostic of a stopped update. Prints field names and equality
// checks only, never environment values or a raw Compose/inspect document.
import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync}from'node:child_process';
import {composeArgs,fingerprint,Cutover}from'/www/backup/gamehub/github-search-release-20261123-r1/agent-server-cutover.mjs';
import {comparableUpdate}from'/www/backup/gamehub/github-search-release-20261123-r1/update-github-search-online.mjs';
const ROOT='/www/backup/gamehub',canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),env=c=>Object.fromEntries(c.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
function docker(args,options={}){if(!['inspect','image','compose','ps'].includes(args[0])||args[0]==='image'&&args[1]!=='inspect'||args[0]==='compose'&&args.slice(-3).join(' ')!=='config --format json')throw Error('READONLY_REQUIRED');const r=spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:12000000,...options});if(r.status!==0)throw Error('READONLY_DOCKER_FAILED');return r.stdout.trim();}
const inspect=n=>JSON.parse(docker(['inspect',n]))[0];
try{
 const api=inspect('gamehub-production-api-1'),actualCompose=composeArgs(api),last=actualCompose.files.findLast(p=>p.startsWith(ROOT+'/github-search-operation-')&&p.endsWith('/api.json'));
 if(!last)throw Error('CURRENT_UPDATE_RECORD_NOT_FOUND');const record=last.slice(0,-'/api.json'.length),state=read(record+'/state.private.json'),failure=read(record+'/failure.private.json'),role=state.roles.find(r=>r.container==='gamehub-production-api-1');
 if(failure.phase!=='recreate-only-api'||failure.code!=='RECREATED_CONFIGURATION_MISMATCH'||!role)throw Error('EXPECTED_FAILURE_REQUIRED');
 const processEnv={...process.env};for(const [k,v]of Object.entries(env(api)))processEnv['MOOYU_CUTOVER_API_'+k]=v;
 const web=inspect('gamehub-production-web-1');for(const [key,dest]of [['AGENT_DOWNLOADS_DIR','/srv/agent-downloads'],['DESKTOP_DOWNLOADS_DIR','/srv/desktop-downloads']]){const m=web.Mounts.find(m=>m.Destination===dest);if(m?.Type==='bind')processEnv[key]=m.Source;}
 const model=overlay=>JSON.parse(docker([...role.compose.args,...(overlay?['-f',overlay]:[]),'--profile','*','config','--format','json'],{env:processEnv,cwd:role.compose.directory}));
 const before=model(null).services.api,after=model(last).services.api,oldImage=JSON.parse(docker(['image','inspect',role.image]))[0],newImage=JSON.parse(docker(['image','inspect',api.Image]))[0];
 const serviceDiff=Object.keys({...before,...after}).filter(k=>k!=='image'&&hash(before[k]??null)!==hash(after[k]??null));
 const expectedEnv={...env(newImage),...Object.fromEntries(Object.entries(after.environment??{}).map(([k,v])=>[k,String(v)]))};
 const cfgKeys=Object.keys({...oldImage.Config,...api.Config}).filter(k=>!['Image','Hostname','Env','Labels'].includes(k)&&hash(oldImage.Config[k]??null)!==hash(api.Config[k]??null));
 const host=api.HostConfig;
 const report={record,phase:failure.phase,api:{running:api.State.Running,health:api.State.Health?.Status??null,imageMatches:api.Image===state.targetImage,comparableHashMatches:hash(comparableUpdate(api))===role.comparableHash,keyRuntimeFingerprintMatches:fingerprint({...api,Image:role.image})===role.fingerprint,composeChainMatches:hash(actualCompose.args)===hash([...role.compose.args,'-f',last]),originalComposeFileCount:role.compose.files.length,currentComposeFileCount:actualCompose.files.length},model:{onlyImageChanged:serviceDiff.length===0,changedOtherKeys:serviceDiff,environmentMatches:hash(expectedEnv)===hash(env(api)),imageConfigPreserved:hash(oldImage.Config)===hash(newImage.Config),containerVsImageConfigKeys:cfgKeys,customLabelKeys:Object.keys(api.Config.Labels??{}).filter(k=>!k.startsWith('com.docker.compose.')).sort(),declaredServiceKeys:Object.keys(after).sort()},host:{networkMode:host.NetworkMode,memory:host.Memory,nanoCpus:host.NanoCpus,readonlyRootfs:host.ReadonlyRootfs,privileged:host.Privileged,logType:host.LogConfig?.Type??null,bindCount:host.Binds?.length??0,mountCount:host.Mounts?.length??0,securityOptCount:host.SecurityOpt?.length??0,portBindingCount:Object.keys(host.PortBindings??{}).length},executor:{running:inspect('gamehub-production-agent-interactions-1').State.Running,image:inspect('gamehub-production-agent-interactions-1').Image}};
 const ids=docker(['ps','-aq']).split(/\s+/).filter(Boolean),cs=JSON.parse(docker(['inspect',...ids]));
 const protectedNow=cs.filter(c=>!state.roles.some(r=>r.container===c.Name.slice(1))).map(c=>({id:c.Id,name:c.Name,image:c.Image,running:c.State.Running,started:c.State.StartedAt,restarts:c.RestartCount,fingerprint:fingerprint(c)})).sort((a,b)=>a.id.localeCompare(b.id));
 report.otherServicesUnchanged=hash(protectedNow)===hash(state.protectedBefore);
 console.log(JSON.stringify(report,null,2));console.log('READONLY_COMPLETE_NO_RESTART_NO_FILE_WRITES');
}catch(e){console.error(/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READONLY_DIAGNOSTIC_FAILED');process.exitCode=1;}
