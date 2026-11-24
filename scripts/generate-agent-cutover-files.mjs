// This entry point permits only Docker metadata/config and SELECT operations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Cutover,PAPER_KEYS,composeArgs} from './agent-server-cutover.mjs';
import {backupSnapshot as snapshot,assertBackupSnapshotUnchanged as assertUnchanged} from './create-three-live-backups.mjs';
const fail=m=>{throw Error(m);};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function assertReadOnlyDocker(args){
 if(args[0]==='inspect'&&args.length>=2)return;
 if(args[0]==='image'&&args[1]==='inspect')return;
 if(args[0]==='ps'&&args.includes('-aq'))return;
 if(args[0]==='compose'&&args.slice(-3).join(' ')==='config --format json'&&!args.some(v=>['up','down','run','start','stop','restart','create','rm','kill','exec'].includes(v)))return;
 if(args[0]==='exec'&&args.includes('psql')&&args.includes('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000')&&args.at(-2)==='-c'&&/^SELECT\b/.test(args.at(-1))&&!/;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|SET|RESET)\b/i.test(args.at(-1)))return;
 fail('GENERATOR_MUTATING_DOCKER_COMMAND_REFUSED');
}
function run(args,options={}){assertReadOnlyDocker(args);const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,...options});if(r.error||r.status!==0)fail('GENERATOR_READ_FAILED');return r.stdout.trim();}
function read(f){return JSON.parse(fs.readFileSync(f,'utf8'));}
function write(f,v){fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag:'wx'});}
export function isOutsidePaperWorker(c,roles){const text=[...(c.Config.Entrypoint??[]),...(c.Config.Cmd??[]),c.Config.Labels?.['com.docker.compose.service']??''].join(' ');return /paper.*worker/i.test(text)&&!roles.some(r=>'/'+r.container===c.Name);}
export async function generate(stage,record){
 stage=fs.realpathSync(stage);record=path.resolve(record);
 if(!stage.startsWith('/www/backup/gamehub/agent-plugins-stage-')||!record.startsWith('/www/backup/gamehub/agent-cutover-files-')||fs.existsSync(record))fail('NEW_PRIVATE_GENERATION_PATH_REQUIRED');
 const receipt=read(path.join(stage,'staging-result.json'));if(receipt.result!=='STAGED_ONLY'||receipt.imagesVerified!==7||!receipt.containersUnchanged)fail('STAGING_RECEIPT_REQUIRED');
 const list=read(path.join(stage,'staging-artifacts.json'));for(const f of list.files){if(!/^[A-Za-z0-9_.-]+$/.test(f.name))fail('INVALID_ARTIFACT_NAME');if(f.name==='images.tar')continue;if(sha(fs.readFileSync(path.join(stage,f.name)))!==f.sha256)fail('STAGED_FILE_CHANGED');}
 const spec=read(path.join(stage,'server-cutover-spec.draft.json')),manifest=read(path.join(stage,'release-manifest.json'));
 const inspectAll=()=>{const ids=run(['ps','-aq']).split(/\s+/).filter(Boolean);if(!ids.length)fail('CONTAINERS_REQUIRED');return JSON.parse(run(['inspect',...ids]));};
 const before=inspectAll();
 const tool=new Cutover(record,{run});await tool.prepare(spec,manifest,{generationOnly:true});
 // Keep separate review material for other projects; no shutdown command is issued.
 const outside=[];for(const c of before){const labels=c.Config.Labels??{};if(!isOutsidePaperWorker(c,spec.roles))continue;
  const name=c.Name.replace(/^\//,''),filename='paper-outside-scope-'+outside.length+'.draft.json';
  const chain=composeArgs(c);write(path.join(record,filename),{services:{[chain.service]:{image:c.Image,restart:'no',profiles:['paper-disabled'],environment:Object.fromEntries(PAPER_KEYS.map(k=>[k,'false'])),entrypoint:['node','-e','process.exit(0)'],command:[]}}});
  outside.push({container:name,project:labels['com.docker.compose.project'],image:c.Image,running:c.State.Running,compose:chain,overlay:filename,applyAuthorized:false});
 }
 write(path.join(record,'paper-outside-scope-review.private.json'),{outside,applied:false,scopeReviewRequired:true});
 write(path.join(record,'execution-review.required.json'),{generationOnly:true,executionLocked:true,executionInventoryReviewed:spec.allExecutionServicesInventoried===true,legacyParticipantsReviewed:spec.adoptLegacyQQParticipants===true,paperOutsideScopeReviewRequired:outside.length>0,reminder:'Do not edit state to unlock. After review and separate execution authorization generate a fresh operational record with the regular prepare entry point.'});
 const after=inspectAll();assertUnchanged(snapshot(before),snapshot(after));tool.checkConfiguration();
 const files=fs.readdirSync(record).sort().map(name=>({name,sha256:sha(fs.readFileSync(path.join(record,name)))}));
 write(path.join(record,'generation-files.sha256.json'),{files});
 const result={result:'FILES_GENERATED_ONLY',record,filesGenerated:files.length+2,executionLocked:true,outsidePaperProjectsRequireReview:outside.length,containersUnchanged:true,servicesRestarted:false,databaseMigrated:false,paperClosureExecuted:false,backupsCreated:false};
 write(path.join(record,'generation-result.json'),result);console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)generate(process.argv[2],process.argv[3]).catch(e=>{console.error(/^[A-Z0-9_]+$/.test(e.message)?e.message:'GENERATION_FAILED');process.exitCode=1;});
