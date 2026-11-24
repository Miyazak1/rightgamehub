// Uses only newly labelled synthetic PostgreSQL containers, no production access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {backupDatabase,verifyArchive,fileHash,backupSnapshot,assertBackupSnapshotUnchanged} from './create-three-live-backups.mjs';
const out=path.resolve(process.argv[2]??'');if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_E_TEST_DIRECTORY_REQUIRED');fs.mkdirSync(out);
const task='three-backup-'+crypto.randomBytes(6).toString('hex'),owned=[];
function run(args,options={}){const r=spawnSync('docker',args,{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,...options});if(r.status!==0)throw Error('SYNTHETIC_DOCKER_FAILED');return r.stdout?.trim()??'';}
const sql=(c,db,q)=>run(['exec',c,'psql','-X','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1','-c',q]);
const before=run(['ps','-aq','--no-trunc']).split(/\s+/).filter(Boolean),originalSnapshot=before.length?backupSnapshot(JSON.parse(run(['inspect',...before]))):[];let result;
try{
 const servers={};for(const [version,image]of [['16','postgres:16.10-alpine'],['17','postgres:17']]){
  const name=task+'-'+version;run(['run','-d','--pull','never','--name',name,'--label','mooyu.three-backup-test='+task,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=192m','-e','POSTGRES_PASSWORD=synthetic-only',image]);owned.push(name);servers[version]=name;
  let ready=false;for(let i=0;i<80;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready,'PG_READY');sql(name,'postgres','CREATE ROLE synthetic_reader');
 }
 const outputs=[];for(const [role,version]of [['api','16'],['qq','17'],['desktop','16']]){
  const c=servers[version],database='fixture_'+role;sql(c,'postgres','CREATE DATABASE '+database);
  const tables=role==='api'?['schema_migrations','agent_accounts','agent_schedules','agent_capability_grants']:role==='qq'?['settings','control_settings','messages']:['paper_study_documents','paper_study_tasks','agent_runs'];
  sql(c,database,tables.map(t=>'CREATE TABLE '+t+'(id integer PRIMARY KEY)').join(';')+"; CREATE TABLE fixture_history(id integer PRIMARY KEY,note text NOT NULL); INSERT INTO fixture_history VALUES(1,'history preserved'),(2,'permission preserved'),(3,'schedule preserved'); GRANT SELECT ON fixture_history TO synthetic_reader");
  const original=sql(c,database,'SELECT json_agg(t ORDER BY id) FROM fixture_history t');
  const backup=backupDatabase({role,container:c,user:'postgres',database,requiredTables:tables},out);assert.equal(backup.fullDecodePassed,true);assert.equal(backup.ownerAndACLMetadataRetained,true);assert.equal(fileHash(path.join(out,backup.file)),backup.sha256);
  assert.match(fs.readFileSync(path.join(out,role+'.toc.txt'),'utf8'),/ACL.*fixture_history/);
  const restore='restored_'+role;sql(c,'postgres','CREATE DATABASE '+restore);const fd=fs.openSync(path.join(out,backup.file),'r');try{run(['exec','-i',c,'pg_restore','--exit-on-error','-U','postgres','-d',restore],{stdio:[fd,'pipe','pipe']});}finally{fs.closeSync(fd);}
  assert.equal(sql(c,restore,'SELECT json_agg(t ORDER BY id) FROM fixture_history t'),original);assert.equal(sql(c,restore,"SELECT has_table_privilege('synthetic_reader','fixture_history','SELECT')"),'t');assert.equal(sql(c,database,'SELECT json_agg(t ORDER BY id) FROM fixture_history t'),original);
  outputs.push({role,serverVersion:version,backupVerified:true,restoredIntoNewSyntheticDatabase:true,historyAndACLRestored:true,sourceUnchanged:true});
 }
 const damaged=path.join(out,'damaged.dump');fs.copyFileSync(path.join(out,'api.dump'),damaged);fs.truncateSync(damaged,70);assert.throws(()=>verifyArchive(servers['16'],damaged));
 result={result:'PASSED',scope:'new-local-synthetic-databases-only',databases:outputs,corruptArchiveRejected:true,productionChanged:false,originalLocalContainersTouched:false};
}finally{
 for(const name of owned){const c=JSON.parse(run(['inspect',name]))[0];assert.equal(c.Config.Labels['mooyu.three-backup-test'],task);run(['rm','-f',name]);}
 assertBackupSnapshotUnchanged(originalSnapshot,before.length?backupSnapshot(JSON.parse(run(['inspect',...before]))):[]);
}
result.testResourcesCleaned=true;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
