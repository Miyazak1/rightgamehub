import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createDatabase} from '../apps/api/src/database.mjs';

// This rehearsal is intentionally restricted to dedicated local test databases.
const sourceUrl=new URL(process.env.GAMEHUB_GAME_SAVE_DATABASE_URL??'http://missing');
const container=process.env.GAMEHUB_REHEARSAL_CONTAINER;
const source=sourceUrl.pathname.slice(1),user=decodeURIComponent(sourceUrl.username);
if(!['postgres:','postgresql:'].includes(sourceUrl.protocol)||!['127.0.0.1','localhost'].includes(sourceUrl.hostname)
  ||!/^gamehub_[a-z0-9_]+_test$/.test(source)||!/^gamehub-[a-z0-9-]+-test$/.test(container??'')||!/^gamehub_[a-z0-9_]+$/.test(user))
  throw Error('Use an explicit dedicated loopback gamehub_*_test database and gamehub-*-test container.');
const root=path.resolve(import.meta.dirname,'..','.runtime','restore-rehearsals');
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'')+'_'+crypto.randomBytes(3).toString('hex');
const target='gamehub_restore_'+stamp+'_test',directory=path.join(root,stamp);
await fs.mkdir(directory,{recursive:true,mode:0o700});
const artifact=path.join(directory,'database.dump'),dump='/tmp/'+target+'.dump';
const docker=args=>execFileSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
const inspect=JSON.parse(docker(['inspect',container]))[0];
const mapped=inspect.NetworkSettings.Ports['5432/tcp']??[];
if(!mapped.some(p=>p.HostPort===(sourceUrl.port||'5432')&&['127.0.0.1','::1'].includes(p.HostIp)))throw Error('Container is not the specified loopback database endpoint.');
const sourceDb=createDatabase({databaseUrl:sourceUrl.href,databaseSsl:false});
const targetUrl=new URL(sourceUrl);targetUrl.pathname='/'+target;
const targetDb=createDatabase({databaseUrl:targetUrl.href,databaseSsl:false});
const snapshot=await sourceDb.pool.connect();
const fingerprint=async client=>{
  await client.query("SET TIME ZONE 'UTC'");
  const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),tables=[];
  for(const name of names){
    if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('Unexpected table name');
    // Database-only row digests avoid exposing credentials or progress in the report.
    const rows=(await client.query("SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS digest FROM \""+name+"\" t ORDER BY digest")).rows;
    tables.push({name,rows:rows.length,sha256:crypto.createHash('sha256').update(rows.map(r=>r.digest).join('\n')).digest('hex')});
  }
  return tables;
};
const invariantQuery=`SELECT
  (SELECT count(*)::int FROM game_save_slots s LEFT JOIN game_save_revisions r ON r.slot_id=s.id AND r.id=s.current_revision_id
    WHERE r.id IS NULL OR r.revision<>s.revision OR r.tombstone<>(s.deleted_at IS NOT NULL)) AS bad_pointers,
  (SELECT count(*)::int FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id LEFT JOIN game_save_payloads p ON p.revision_id=r.id WHERE NOT r.tombstone AND p.revision_id IS NULL) AS missing_current_payloads,
  (SELECT count(*)::int FROM game_save_payloads p JOIN game_save_revisions r ON r.id=p.revision_id WHERE octet_length(p.payload_inline)<>r.stored_bytes OR encode(sha256(p.payload_inline),'hex')<>r.payload_sha256) AS bad_payloads,
  (SELECT count(*)::int FROM game_save_operations o JOIN game_save_revisions r ON r.id=o.revision_id WHERE o.slot_id<>r.slot_id OR o.result->>'revisionId'<>r.id::text OR o.result->>'etag'<>r.etag OR o.result->>'revision'<>r.revision::text) AS bad_receipts,
  (SELECT count(*)::int FROM game_save_user_events e JOIN game_save_slots s ON s.id=e.slot_id JOIN game_save_revisions r ON r.id=e.revision_id WHERE e.user_id<>s.user_id OR r.slot_id<>s.id OR e.action='restore' AND r.source_kind<>'restore') AS bad_audit,
  (SELECT count(*)::int FROM game_save_usage u WHERE
    u.live_slots<>(SELECT count(*) FROM game_save_slots s WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND s.deleted_at IS NULL) OR
    u.live_bytes<>(SELECT COALESCE(sum(r.stored_bytes),0) FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND NOT r.tombstone) OR
    u.history_bytes<>(SELECT COALESCE(sum(r.stored_bytes),0) FROM game_save_slots s JOIN game_save_revisions r ON r.slot_id=s.id JOIN game_save_payloads p ON p.revision_id=r.id WHERE (s.user_id,s.work_id,s.channel)=(u.user_id,u.work_id,u.channel) AND r.id<>s.current_revision_id)) AS bad_usage`;
const started=Date.now();let sourceTables;
try{
  await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const token=(await snapshot.query('SELECT pg_export_snapshot() AS token')).rows[0].token;
  sourceTables=await fingerprint(snapshot);
  if(!sourceTables.some(t=>t.name==='game_save_user_events'))throw Error('Apply all current migrations to the test source first.');
  docker(['exec',container,'pg_dump','-U',user,'-d',source,'--format=custom','--snapshot='+token,'--file='+dump]);
  await snapshot.query('COMMIT');
  docker(['cp',container+':'+dump,artifact]);
  await fs.chmod(artifact,0o600);
  const backupMs=Date.now()-started,backupSha256=crypto.createHash('sha256').update(await fs.readFile(artifact)).digest('hex');
  // createdb fails if the generated target already exists. Never use clean, drop or overwrite.
  docker(['exec',container,'createdb','-U',user,target]);
  const restoreStarted=Date.now();
  const restoreDump='/tmp/'+target+'-from-backup.dump';
  docker(['cp',artifact,container+':'+restoreDump]);
  if(docker(['exec',container,'sha256sum',restoreDump]).split(/\s/)[0]!==backupSha256)throw Error('Copied backup digest mismatch.');
  docker(['exec',container,'pg_restore','-U',user,'--dbname='+target,'--exit-on-error',restoreDump]);
  const restoreMs=Date.now()-restoreStarted;
  const client=await targetDb.pool.connect();let restoredTables,invariants;
  try{restoredTables=await fingerprint(client);const capacityCheck=restoredTables.some(t=>t.name==='game_save_capacity')?', (SELECT CASE WHEN count(*)=1 AND min(retained_bytes)=(SELECT COALESCE(sum(octet_length(payload_inline)),0) FROM game_save_payloads) THEN 0 ELSE 1 END FROM game_save_capacity) AS bad_payload_capacity':'';invariants=(await client.query(invariantQuery+capacityCheck)).rows[0];}finally{client.release();}
  if(JSON.stringify(sourceTables)!==JSON.stringify(restoredTables))throw Error('Restored table fingerprints differ from source snapshot.');
  if(Object.values(invariants).some(value=>value!==0))throw Error('Restored save invariants failed: '+JSON.stringify(invariants));
  const report={verified:true,at:new Date().toISOString(),sourceDatabase:source,restoredDatabase:target,backupSha256,backupBytes:(await fs.stat(artifact)).size,backupMs,restoreMs,totalMs:Date.now()-started,invariants,tables:restoredTables};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await fs.writeFile(path.join(directory,'SHA256SUMS'),backupSha256+'  database.dump\n',{mode:0o600});
  console.log(JSON.stringify({...report,tables:report.tables.filter(t=>t.name.startsWith('game_save_')),artifact,reportPath:path.join(directory,'report.json')},null,2));
}catch(error){await snapshot.query('ROLLBACK').catch(()=>{});throw error;}finally{snapshot.release();await sourceDb.close();await targetDb.close();}
