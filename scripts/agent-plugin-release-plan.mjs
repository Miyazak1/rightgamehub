// Produces reviewable commands from an explicit inventory; does not deploy.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const image=v=>/^sha256:[a-f0-9]{64}$/u.test(v??''),quote=v=>"'"+String(v).replaceAll("'","'\\''")+"'";
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),mounts=c=>c.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),environment=c=>(c.Config.Env??[]).slice().sort();
const paperFlags=['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED','AGENT_PAPER_SEMANTIC_ENABLED','AGENT_PAPER_RESEARCH_WORKER_ENABLED'];
export function renderReleasePlan(inventory,manifest){
 if(inventory?.schemaVersion!=='agent-unified-inventory-v1'||manifest?.schemaVersion!=='agent-unified-release-v1'||manifest.paperEnabled!==false)throw Error('RELEASE_PLAN_INPUT_INVALID');
 const blockers=[];for(const key of ['backupsVerified','configurationAligned','secretMountsAligned','loginMountsVerified','allExecutionServicesInventoried'])if(inventory.evidence?.[key]!==true)blockers.push(key);
 const roles=inventory.roles??[];for(const key of ['api','web','worker','executor'])if(!roles.some(r=>r.role===key))blockers.push('missing-'+key);
 for(const r of roles){if(!['api','web','worker','executor','scheduler'].includes(r.role)||!image(r.imageId)||typeof r.running!=='boolean'||!r.container||!r.project||!r.service||!r.directory?.startsWith('/')||!r.files?.length||!Array.isArray(r.envFiles)||[...r.files,...r.envFiles].some(f=>!f.startsWith('/')))throw Error('RELEASE_ROLE_INVALID');}
 for(const role of ['api','web','worker'])if(!image(manifest.images?.[role]?.id))throw Error('RELEASE_IMAGE_INVALID');
 for(const r of roles){if(!/^[a-f0-9]{64}$/u.test(r.mountsSha256??'')||!/^[a-f0-9]{64}$/u.test(r.environmentSha256??''))blockers.push('missing-fingerprints-'+r.role);if(['api','executor','scheduler'].includes(r.role)&&r.imageId!==manifest.images.api.baseImageId&&r.schema166Compatible!==true)blockers.push('rollback-schema-unverified-'+r.role);}
 if(!image(manifest.rollbackImages?.api?.id))blockers.push('schema-compatible-rollback-image-required');
 if(new Set(roles.map(r=>r.container)).size!==roles.length)throw Error('RELEASE_ROLE_DUPLICATE');
 if(!inventory.configurationFiles?.length||!inventory.backups?.length||!inventory.gateway||!inventory.databases?.api||!inventory.databases?.qq)blockers.push('complete-private-inventory-required');
 if(blockers.length)return {ready:false,blockers,commandsGenerated:false,productionChanged:false};
 const compose=(r,overlay)=>['docker','compose','--project-directory',r.directory,...r.envFiles.flatMap(f=>['--env-file',f]),'-p',r.project,...r.files.flatMap(f=>['-f',f]),...(overlay?['-f',overlay]:[])].map(quote).join(' ');
 const active=roles.filter(r=>r.running),overlays={};
 for(const [index,r]of roles.entries()){const target=manifest.images[r.role==='web'?'web':r.role==='worker'?'worker':'api'].id,rollback=['api','executor','scheduler'].includes(r.role)&&r.imageId===manifest.images.api.baseImageId?manifest.rollbackImages.api.id:r.imageId;overlays[`target-${index}.json`]={services:{[r.service]:{image:target}}};overlays[`original-${index}.json`]={services:{[r.service]:{image:rollback}}};}
 // Use literal script-directory paths, escaped separately from inventory paths.
 const selected=(r,original)=>compose(r).concat(' -f "$RECORD/',original?'original':'target','-',roles.indexOf(r),'.json"');
 const header='#!/usr/bin/env bash\nset -euo pipefail\numask 077\nRECORD="$(cd -- "$(dirname -- "$0")" && pwd)"\nexec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9 || { echo RELEASE_WINDOW_LOCKED >&2; exit 1; }\n';
 const check='node "$RECORD/agent-plugin-release-plan.mjs" --check-window "$RECORD/inventory.private.json"\n';
 const stopOrder=[...active].sort((a,b)=>['worker','api','executor','scheduler','web'].indexOf(a.role)-['worker','api','executor','scheduler','web'].indexOf(b.role));
 const stop=stopOrder.map(r=>compose(r)+' stop --timeout 45 '+quote(r.service)).join('\n')+'\n';
 const upgradeOrder=[...active].sort((a,b)=>['api','executor','scheduler','worker','web'].indexOf(a.role)-['api','executor','scheduler','worker','web'].indexOf(b.role));
 const api=roles.find(r=>r.role==='api');
 const upgrade=header+check+stop+check+selected(api,false)+' run --rm --no-deps --pull never '+quote(api.service)+' node apps/api/src/migrate-cli.mjs\n'+selected(api,false)+' run --rm --no-deps --pull never '+quote(api.service)+' node apps/api/src/agent-interaction-bootstrap-cli.mjs\n'+upgradeOrder.map(r=>selected(r,false)+' up -d --wait --wait-timeout 90 --no-deps --no-build --pull never '+quote(r.service)).join('\n')+'\n';
 const rollback=header+check+stop+check+'# Keep additive schema, all task bindings, image pages and history.\n'+upgradeOrder.map(r=>selected(r,true)+' up -d --wait --wait-timeout 90 --no-deps --no-build --pull never '+quote(r.service)).join('\n')+'\n';
 return {ready:true,blockers:[],commandsGenerated:true,overlays,scripts:{'upgrade.sh':upgrade,'rollback.sh':rollback},originallyStopped:roles.filter(r=>!r.running).map(r=>r.container),productionChanged:false};
}
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4000000});if(r.status!==0)throw Error('RELEASE_INSPECTION_FAILED');return r.stdout.trim();}
export function checkWindow(inventory,{dockerRead=docker}={}){
 // Must be run again after processes are stopped. A prior paper or idle claim
 // is never trusted as authorization to change live containers.
 for(const id of inventory.imageIds??[])if(JSON.parse(dockerRead(['image','inspect',id]))[0].Id!==id)throw Error('PINNED_IMAGE_UNAVAILABLE');
 for(const r of inventory.roles){const c=JSON.parse(dockerRead(['inspect',r.container]))[0],env=Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));if(!(r.allowedImageIds??[r.imageId]).includes(c.Image))throw Error('ROLE_IMAGE_CHANGED');if(paperFlags.some(k=>env[k]!=null&&env[k]!=='false'))throw Error('PAPER_MUST_REMAIN_DISABLED');if(digest(mounts(c))!==r.mountsSha256||digest(environment(c))!==r.environmentSha256)throw Error('ROLE_CONFIGURATION_CHANGED');}
 if(!inventory.configurationFiles?.length)throw Error('CONFIGURATION_FINGERPRINTS_REQUIRED');
 for(const file of inventory.configurationFiles)if(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')!==file.sha256)throw Error('CONFIGURATION_CHANGED');
 for(const file of inventory.backups??[])if(createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')!==file.sha256)throw Error('BACKUP_CHANGED');
 if(!inventory.backups?.length)throw Error('VERIFIED_BACKUPS_REQUIRED');
 const gateway=JSON.parse(dockerRead(['inspect',inventory.gateway.container]))[0];
 if(gateway.Image!==inventory.gateway.imageId||gateway.State.StartedAt!==inventory.gateway.startedAt||digest(mounts(gateway))!==inventory.gateway.mountsSha256)throw Error('LOGIN_GATEWAY_CHANGED');
 const query=(db,sql)=>{if(!/^[a-zA-Z0-9_]+$/u.test(db.user)||!/^[a-zA-Z0-9_]+$/u.test(db.database))throw Error('RELEASE_DATABASE_INVALID');return Number(dockerRead(['exec',db.container,'psql','-X','-U',db.user,'-d',db.database,'-At','-v','ON_ERROR_STOP=1','-c',sql]));};
 const counts={interactions:query(inventory.databases.api,"SELECT count(*) FROM agent_interactions WHERE state IN ('queued','running','waiting','needs-review')"),runs:query(inventory.databases.api,"SELECT count(*) FROM agent_runs WHERE status IN ('queued','running','waiting','uncertain')"),fires:query(inventory.databases.api,"SELECT count(*) FROM agent_schedule_fires WHERE status IN ('running','uncertain')"),deliveries:query(inventory.databases.qq,"SELECT count(*) FROM mooyu_qq.messages WHERE status NOT IN ('delivered','failed')")};
 counts.unsettledTasks=query(inventory.databases.qq,"SELECT CASE WHEN to_regclass('mooyu_qq.agent_links') IS NULL THEN 0 ELSE 1 END")?query(inventory.databases.qq,'SELECT count(*) FROM mooyu_qq.agent_links WHERE task_id IS NOT NULL AND NOT task_settled'):0;
 counts.unfinishedImagePages=query(inventory.databases.qq,"SELECT CASE WHEN to_regclass('mooyu_qq.agent_image_pages') IS NULL THEN 0 ELSE 1 END")?query(inventory.databases.qq,"SELECT count(*) FROM mooyu_qq.agent_image_pages p JOIN mooyu_qq.messages m USING(channel_id,message_id) WHERE m.status<>'delivered'"):0;
 if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n!==0))throw Error('RELEASE_WINDOW_BUSY');return {ready:true,counts,paperEnabled:false,loginGatewayPreserved:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv[2]==='--check-window'){console.log(JSON.stringify(checkWindow(JSON.parse(fs.readFileSync(process.argv[3],'utf8')))));}
 else{const [manifestFile,inventoryFile,out]=process.argv.slice(2);if(!out||fs.existsSync(out))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');const inventory=JSON.parse(fs.readFileSync(inventoryFile,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),plan=renderReleasePlan(inventory,manifest);fs.mkdirSync(out,{recursive:true,mode:0o700});fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600});if(plan.ready){inventory.imageIds=[...new Set([...Object.values(manifest.images).map(i=>i.id),manifest.rollbackImages.api.id,...inventory.roles.map(r=>r.imageId)])];for(const r of inventory.roles)r.allowedImageIds=[r.imageId,manifest.images[r.role==='web'?'web':r.role==='worker'?'worker':'api'].id,...(['api','executor','scheduler'].includes(r.role)?[manifest.rollbackImages.api.id]:[])];fs.writeFileSync(path.join(out,'inventory.private.json'),JSON.stringify(inventory,null,2),{mode:0o600});fs.copyFileSync(process.argv[1],path.join(out,'agent-plugin-release-plan.mjs'));for(const [file,value]of Object.entries(plan.overlays))fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2),{mode:0o600});for(const [file,value]of Object.entries(plan.scripts))fs.writeFileSync(path.join(out,file),value,{mode:0o700});}console.log(JSON.stringify({ready:plan.ready,blockers:plan.blockers,commandsGenerated:plan.commandsGenerated,productionChanged:false}));if(!plan.ready)process.exitCode=2;}}
 catch(e){console.error(/^[A-Z0-9_]+$/u.test(e.message)?e.message:'RELEASE_PLAN_FAILED');process.exitCode=1;}
}
