// Builds a NEW local candidate from the original immutable scheduler image.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {SCHEDULER_BASE,BASE_GRAPH,GRAPH_PROBE,hash,patchSchedulerModules,verifyCompatGraph} from './scheduler-interaction-compat.mjs';
const out=path.resolve(process.argv[2]??''),tag='mooyu-agent-scheduler:20261123-interaction-compat-r1';if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_BUILD_DIRECTORY_REQUIRED');
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});if(r.status!==0)throw Error('LOCAL_COMPAT_BUILD_FAILED');return r.stdout.trim();}
if(spawnSync('docker',['image','inspect',tag],{stdio:'ignore'}).status===0)throw Error('NEW_IMAGE_TAG_REQUIRED');
const base=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',SCHEDULER_BASE,'-e',GRAPH_PROBE]));if(base.hash!==BASE_GRAPH)throw Error('BASE_GRAPH_CHANGED');
const patched=patchSchedulerModules(base.sources);fs.mkdirSync(out);const context=path.join(out,'context');fs.mkdirSync(context);
for(const [f,s]of Object.entries(patched))fs.writeFileSync(path.join(context,path.basename(f)),s,{flag:'wx'});
// BuildKit treats FROM sha256:<id> as a registry name. A new local alias is
// verified against the immutable ID before use; existing tags are untouched.
const baseTag='mooyu-scheduler-base-local:ee818f213525';const prior=spawnSync('docker',['image','inspect',baseTag],{encoding:'utf8'});if(prior.status===0){if(JSON.parse(prior.stdout)[0].Id!==SCHEDULER_BASE)throw Error('LOCAL_BASE_ALIAS_CONFLICT');}else docker(['tag',SCHEDULER_BASE,baseTag]);
if(JSON.parse(docker(['image','inspect',baseTag]))[0].Id!==SCHEDULER_BASE)throw Error('LOCAL_BASE_ALIAS_CHANGED');
const dockerfile='FROM '+baseTag+'\nCOPY agent-blog-public-schedule.mjs /app/apps/api/src/agent-blog-public-schedule.mjs\nCOPY agent-blog-public-request-repository.mjs /app/apps/api/src/agent-blog-public-request-repository.mjs\n';
fs.writeFileSync(path.join(context,'Dockerfile'),dockerfile,{flag:'wx'});docker(['build','--network','none','--pull=false','-t',tag,context]);
const candidate=JSON.parse(docker(['image','inspect',tag]))[0],original=JSON.parse(docker(['image','inspect',SCHEDULER_BASE]))[0];
if(JSON.stringify(candidate.Config)!==JSON.stringify(original.Config)||JSON.stringify(candidate.RootFS.Layers.slice(0,original.RootFS.Layers.length))!==JSON.stringify(original.RootFS.Layers))throw Error('BASE_RUNTIME_CONFIGURATION_CHANGED');
const actual=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',candidate.Id,'-e',GRAPH_PROBE])),graph=verifyCompatGraph(base,actual);
const proof={result:'LOCAL_COMPAT_CANDIDATE_BUILT',tag,imageId:candidate.Id,baseImageId:SCHEDULER_BASE,configExactlyPreserved:true,...graph,patches:Object.keys(patched).map(f=>({file:f,before:hash(base.sources[f]),after:hash(patched[f])})),productionChanged:false,fullAcceptancePending:true};fs.writeFileSync(path.join(out,'build-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));
