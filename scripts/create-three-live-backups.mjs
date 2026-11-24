// Backups only: reads databases; writes exclusively to a new private directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const BASE='/www/backup/gamehub/agent-cutover-files-20261122-r1';
const PLAN='/www/backup/gamehub/agent-all-paper-plan-20261122-r1';
const OPTIONS='PGOPTIONS=-c default_transaction_read_only=on -c lock_timeout=10000 -c statement_timeout=0';
const fail=m=>{throw Error(m);};
const validId=v=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(v??'');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function backupSnapshot(containers){return containers.map(c=>({name:c.Name,id:c.Id,image:c.Image,running:c.State.Running,startedAt:c.State.StartedAt,restartCount:c.RestartCount,configurationSha256:crypto.createHash('sha256').update(JSON.stringify(canonical([c.Config,c.HostConfig,(c.Mounts??[]).slice().sort((a,b)=>a.Destination.localeCompare(b.Destination)),Object.entries(c.NetworkSettings.Networks??{}).map(([n,v])=>[n,(v.Aliases??[]).slice().sort()]).sort((a,b)=>a[0].localeCompare(b[0]))]))).digest('hex')})).sort((a,b)=>a.id.localeCompare(b.id));}
export function assertBackupSnapshotUnchanged(before,after){if(JSON.stringify(before)!==JSON.stringify(after))fail('EXISTING_CONTAINER_CHANGED_REVIEW_REQUIRED');}
export function assertBackupDockerCommand(args){
 if(args[0]==='ps'&&args.length===2&&args[1]==='-aq')return;
 if(args[0]==='inspect'&&args.length>=2)return;
 if(args[0]!=='exec')fail('BACKUP_COMMAND_REFUSED');
 const start=args[1]==='-i'?2:1;
 if(args[start]==='-e'&&args[start+1]===OPTIONS){
  const cmd=args[start+3],tail=args.slice(start+4);
  if(cmd==='pg_dump'&&tail.length===7&&tail[0]==='-U'&&validId(tail[1])&&tail[2]==='-d'&&validId(tail[3])&&tail[4]==='--format=custom'&&tail[5]==='--no-password'&&tail[6]==='--lock-wait-timeout=10s')return;
  if(cmd==='psql'&&tail[0]==='-X'&&tail[1]==='-U'&&validId(tail[2])&&tail[3]==='-d'&&validId(tail[4])&&tail.slice(5,9).join(' ')==='-At -v ON_ERROR_STOP=1 -c'&&tail.length===10&&/^SELECT\b/.test(tail[9])&&!/;|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|SET|RESET)\b/i.test(tail[9]))return;
 }
 if(args[1]==='-i'&&args.length===5&&args[3]==='pg_restore'&&['--list','--file=/dev/null'].includes(args[4]))return;
 fail('BACKUP_COMMAND_REFUSED');
}
export function runDocker(args,options={}){assertBackupDockerCommand(args);const r=spawnSync('docker',args,{encoding:'utf8',timeout:1200000,maxBuffer:16*1024*1024,windowsHide:true,...options});if(r.error||r.status!==0)fail('BACKUP_DOCKER_OPERATION_FAILED');return r.stdout?.trim()??'';}
export function fileHash(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
export function verifyArchive(container,file,{run=runDocker,requiredTables=[]}={}){
 const head=Buffer.alloc(5),fd=fs.openSync(file,'r');try{fs.readSync(fd,head,0,5,0);}finally{fs.closeSync(fd);}if(head.toString()!=='PGDMP')fail('CUSTOM_ARCHIVE_HEADER_INVALID');
 let toc='';for(const mode of ['--list','--file=/dev/null']){const input=fs.openSync(file,'r');try{const out=run(['exec','-i',container,'pg_restore',mode],{stdio:[input,'pipe','pipe']});if(mode==='--list')toc=out;}finally{fs.closeSync(input);}}
 for(const table of requiredTables)if(!toc.split(/\r?\n/).some(line=>/\bTABLE\b/.test(line)&&line.split(/\s+/).includes(table)))fail('REQUIRED_BACKUP_TABLE_MISSING');
 return toc;
}
export function backupDatabase(db,dir,{run=runDocker}={}){
 if(!['api','qq','desktop'].includes(db.role)||!validId(db.user)||!validId(db.database)||!/^[A-Za-z0-9_.-]+$/.test(db.container))fail('BACKUP_DATABASE_IDENTIFIER_INVALID');
 const startAt=new Date().toISOString(),target=path.join(dir,db.role+'.dump'),partial=target+'.partial';if(fs.existsSync(target)||fs.existsSync(partial))fail('NEW_BACKUP_FILE_REQUIRED');
 const fd=fs.openSync(partial,'wx',0o600);try{run(['exec','-e',OPTIONS,db.container,'pg_dump','-U',db.user,'-d',db.database,'--format=custom','--no-password','--lock-wait-timeout=10s'],{stdio:['ignore',fd,'pipe']});fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const toc=verifyArchive(db.container,partial,{run,requiredTables:db.requiredTables??[]});
 fs.writeFileSync(path.join(dir,db.role+'.toc.txt'),toc+'\n',{mode:0o600,flag:'wx'});fs.renameSync(partial,target);
 return {role:db.role,container:db.container,database:db.database,file:path.basename(target),bytes:fs.statSync(target).size,sha256:fileHash(target),startedAt:startAt,finishedAt:new Date().toISOString(),archiveListPassed:true,fullDecodePassed:true,requiredTablesVerified:db.requiredTables??[],ownerAndACLMetadataRetained:true,quiesced:false};
}
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const env=c=>Object.fromEntries((c.Config.Env??[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
function checkFiles(root,manifest){for(const f of manifest){if(!/^[A-Za-z0-9_.-]+$/.test(f.name)||fileHash(path.join(root,f.name))!==f.sha256)fail('RECORDED_FILE_CHANGED');}}
export async function createLiveBackups(){
 let directory=null;const completed=[];
 try{
  checkFiles(BASE,read(path.join(BASE,'generation-files.sha256.json')).files);checkFiles(PLAN,read(path.join(PLAN,'files.sha256.json')).files);
  const state=read(path.join(BASE,'state.private.json')),plan=read(path.join(PLAN,'three-database-backup.plan.json'));
  if(state.executionLocked!==true||plan.executionLocked!==true)fail('EXISTING_EXECUTION_LOCK_REQUIRED');
  for(const f of state.files)if(fileHash(f.path)!==f.sha256)fail('FROZEN_CONFIGURATION_CHANGED');
  const dbs=plan.databases.map(d=>({role:d.role,container:d.container,user:d.user,database:d.database,requiredTables:d.role==='api'?['schema_migrations','agent_accounts','agent_schedules','agent_capability_grants']:d.role==='qq'?['settings','control_settings','messages']:['paper_study_documents','paper_study_tasks','agent_runs']}));
  if(dbs.length!==3||new Set(dbs.map(d=>d.role)).size!==3||!['api','qq','desktop'].every(r=>dbs.some(d=>d.role===r))||new Set(dbs.map(d=>d.container+':'+d.database)).size!==3)fail('EXACTLY_THREE_DATABASES_REQUIRED');
  const all=()=>{const ids=runDocker(['ps','-aq']).split(/\s+/).filter(Boolean);if(!ids.length)fail('CONTAINERS_REQUIRED');return JSON.parse(runDocker(['inspect',...ids]));};
  const before=all(),byName=new Map(before.map(c=>[c.Name.slice(1),c]));
  const sourceNames={api:state.roles.find(r=>r.role==='api').container,qq:state.roles.find(r=>r.role==='worker').container,desktop:'mooyu-desktop-business-test-business-paper-worker-1'};
  const expected={api:['gamehub-production','gamehub'],qq:['mooyu-qq','mooyu_qq_local_server'],desktop:['mooyu-desktop-business-test','desktop_business_test']};
  const sizes=[];for(const d of dbs){
   const c=byName.get(d.container),source=byName.get(sourceNames[d.role]);if(!c?.State.Running||!source?.State.Running||c.Config.Labels?.['com.docker.compose.project']!==expected[d.role][0]||d.database!==expected[d.role][1])fail('EXPECTED_DATABASE_CONTAINER_REQUIRED');
   const u=new URL(env(source)[d.role==='qq'?'QQ_DATABASE_URL':'DATABASE_URL']);if(decodeURIComponent(u.username)!==d.user||decodeURIComponent(u.pathname.slice(1))!==d.database)fail('DATABASE_REFERENCE_MISMATCH');
   const common=Object.keys(source.NetworkSettings.Networks??{}).filter(n=>c.NetworkSettings.Networks?.[n]);if(!common.some(n=>(c.NetworkSettings.Networks[n].Aliases??[]).includes(u.hostname)||u.hostname===c.Name.slice(1)))fail('DATABASE_HOST_NETWORK_MISMATCH');
   const info=JSON.parse(runDocker(['exec','-e',OPTIONS,d.container,'psql','-X','-U',d.user,'-d',d.database,'-At','-v','ON_ERROR_STOP=1','-c',"SELECT json_build_object('database',current_database(),'user',current_user,'readOnly',current_setting('transaction_read_only'),'bytes',pg_database_size(current_database()))"]));if(info.database!==d.database||info.user!==d.user||info.readOnly!=='on')fail('DATABASE_IDENTITY_OR_READONLY_MISMATCH');sizes.push(info.bytes);
  }
  const parent='/www/backup/gamehub',space=fs.statfsSync(parent),needed=Math.max(1024**3,sizes.reduce((n,v)=>n+Number(v),0)*2+256*1024**2);if(space.bavail*space.bsize<needed)fail('INSUFFICIENT_BACKUP_DISK_SPACE');
  directory=fs.mkdtempSync(path.join(parent,'agent-live-three-db-20261122-'));fs.chmodSync(directory,0o700);console.log('新私有备份目录：'+directory);
  for(const d of dbs){console.log('正在备份并完整解码校验：'+d.role);const r=backupDatabase(d,directory);completed.push(r);console.log('已通过：'+d.role+'，'+r.bytes+' bytes');}
  for(const b of completed)if(fileHash(path.join(directory,b.file))!==b.sha256||fs.statSync(path.join(directory,b.file)).size!==b.bytes)fail('BACKUP_CHANGED_AFTER_VERIFICATION');
  assertBackupSnapshotUnchanged(backupSnapshot(before),backupSnapshot(all()));
  checkFiles(BASE,read(path.join(BASE,'generation-files.sha256.json')).files);checkFiles(PLAN,read(path.join(PLAN,'files.sha256.json')).files);for(const f of state.files)if(fileHash(f.path)!==f.sha256)fail('FROZEN_CONFIGURATION_CHANGED');
  fs.writeFileSync(path.join(directory,'backups.sha256'),completed.map(b=>b.sha256+'  '+b.file).join('\n')+'\n',{flag:'wx',mode:0o600});
  const receipt={result:'THREE_LIVE_BACKUPS_VERIFIED',directory,databases:completed,allExecutionLocksPreserved:true,containersUnchanged:true,quiesced:false,crossDatabaseAtomic:false,servicesRestarted:false,paperClosed:false,databaseRestored:false,sourceConfigurationChanged:false,notMigrationWindowBackups:true};
  fs.writeFileSync(path.join(directory,'backup-receipt.private.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(receipt,null,2));return receipt;
 }catch(e){console.error(JSON.stringify({result:'BACKUP_INCOMPLETE_REVIEW_REQUIRED',directory,completedRoles:completed.map(b=>b.role),error:/^[A-Z0-9_]+$/.test(e.message)?e.message:'BACKUP_FAILED',partialFilesRetained:true}));process.exitCode=1;}
}
