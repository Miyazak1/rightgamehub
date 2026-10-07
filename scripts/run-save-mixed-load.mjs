import {evaluateMixedLoad} from './save-mixed-load-gate.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import net from 'node:net';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {createDatabase} from '../apps/api/src/database.mjs';
import {loadRulesRegistry} from '../packages/rules-sdk/src/index.mjs';
import {summary,scheduled,seedMixedFixture,prepareMixedClients,saveInvariants,failure} from './save-mixed-load-support.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
const flags=new Set(process.argv.slice(2));
if([...flags].some(x=>!['--smoke','--backup-uncompressed'].includes(x)))throw failure('UNKNOWN_ARGUMENT');
const smoke=flags.has('--smoke'),project='gamehub-save-mixed-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex');
const output=path.join(root,'.runtime','mixed-load',project);
await fs.mkdir(output,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('hex'),envPath=path.join(output,'test.env');
const publicKeys=JSON.parse(await fs.readFile(path.join(root,'rules/trusted-public-keys.json'),'utf8'));
await fs.writeFile(envPath,[
  'MIXED_PASSWORD='+password,'MIXED_OTP='+crypto.randomBytes(32).toString('hex'),
  'MIXED_RULE_KEYS='+JSON.stringify(publicKeys),
  'MIXED_API_IMAGE='+project+'-api:test','MIXED_RT_IMAGE='+project+'-realtime:test',''
].join('\n'),{mode:0o600});
const composeArgs=['compose','--project-name',project,'--env-file',envPath,'-f',path.join(root,'deploy/compose.mixed-load.yml')];
const cli=async(file,args,{timeout=120000,log}={})=>{
  try{
    const r=await exec(file,args,{cwd:root,windowsHide:true,timeout,maxBuffer:8*1024*1024});
    if(log)await fs.writeFile(path.join(output,log),r.stdout+r.stderr);
    return r.stdout.trim();
  }catch(error){
    if(log)await fs.writeFile(path.join(output,log),(error.stdout??'')+(error.stderr??''));
    throw failure(file.toUpperCase()+'_FAILED');
  }
};
const compose=(args,options)=>cli('docker',[...composeArgs,...args],options);
const api='http://127.0.0.1:55790',realtime='ws://127.0.0.1:55793',rtHttp='http://127.0.0.1:55793';
const emit=event=>process.stdout.write(JSON.stringify(event)+'\n');
const report={schemaVersion:3,project,smoke,at:new Date().toISOString(),productionReady:false,
  coverage:['signed Mizhen authoritative matches','real bearer authentication','real game sessions and cloud saves','PostgreSQL','Redis','storage probe','periodic maintenance','concurrent pg_dump','restore of mixed-phase backup'],
  excluded:['competition verifier (not implemented in this branch)','source/rule builders','global shared resource governor','TLS/reverse proxy','production disk/host','offsite backup/RPO/RTO'],
  thresholds:{saveP95Ms:300,saveP99Ms:1000,readP95Ms:150,readP99Ms:500,commandP95Ms:150,commandP99Ms:500,heartbeatP95Ms:100,heartbeatP99Ms:250,maxWindowLoopP99Ms:100,maxSchedulerMisses:0,maxErrors:0},
  offered:{actors:smoke?4:16,pairs:smoke?1:4,saveIntervalMs:6000,readIntervalMs:4000,commandIntervalMs:1000,heartbeatIntervalMs:2000,fillerMiB:smoke?8:64},
  backupCompression:flags.has('--backup-uncompressed')?'none':'pg_dump default',
  phases:[],backups:[],checks:[],errors:[]};
let db,clients,fixture,containers=[],pgId,started=false;const backupBoundaries=[];
async function inspect(){
  const ids=(await compose(['ps','--all','--quiet'])).split(/\s+/).filter(Boolean);
  if(!ids.length)return [];
  const values=JSON.parse(await cli('docker',['inspect',...ids]));
  if(values.some(v=>v.Config.Labels?.['com.docker.compose.project']!==project))throw failure('CONTAINER_PROJECT_MISMATCH');
  return values.map(v=>({id:v.Id,service:v.Config.Labels['com.docker.compose.service'],image:v.Image,cpus:v.HostConfig.NanoCpus/1e9,memoryBytes:v.HostConfig.Memory,status:v.State.Status,exitCode:v.State.ExitCode,oomKilled:v.State.OOMKilled,restartCount:v.RestartCount}));
}
async function checkPorts(){
  for(const port of [55739,55790,55793])await new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',()=>reject(failure('LOOPBACK_PORT_IN_USE')));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
async function waitReady(){
  for(let i=0;i<60;i++){
    try{
      const values=await Promise.all([api,rtHttp].map(async base=>{
        const r=await fetch(base+'/ready',{signal:AbortSignal.timeout(2000)});return r.ok;
      }));
      const sampled=await db.pool.query("SELECT observed_at>clock_timestamp()-interval '90 seconds' ready FROM game_save_storage_status");
      if(values.every(Boolean)&&sampled.rows[0]?.ready)return;
    }catch{}
    await delay(1000);
  }
  throw failure('STACK_NOT_READY');
}
async function cpuCounters(){
  return Object.fromEntries(await Promise.all(containers.filter(c=>['postgres','realtime','redis'].includes(c.service)).map(async c=>{
    const value=await cli('docker',['exec',c.id,'cat','/sys/fs/cgroup/cpu.stat']);
    return [c.service,Object.fromEntries(value.split('\n').map(line=>{const [key,value]=line.trim().split(/\s+/);return [key,Number(value)];}))];
  })));
}
async function backup(){
  const acknowledged={saves:fixture.people.flatMap(a=>a.writes.map(w=>w.revisionId)),commands:clients.rooms.flatMap(r=>r.commands)};
  backupBoundaries.push(acknowledged);
  const file='/tmp/mixed-backup-'+report.backups.length+'.dump',start=performance.now(),startedAt=new Date().toISOString();
  await cli('docker',['exec',pgId,'pg_dump','-U','gamehub_test','-d','gamehub_mixed_load_test','--format=custom',...(flags.has('--backup-uncompressed')?['--compress=0']:[]),'--file='+file],{timeout:60000});
  const checksum=(await cli('docker',['exec',pgId,'sha256sum',file])).split(/\s+/)[0];
  const bytes=Number(await cli('docker',['exec',pgId,'stat','-c','%s',file]));
  const item={file,sha256:checksum,bytes,acknowledgedAtStart:{saves:acknowledged.saves.length,commands:acknowledged.commands.length},startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-start};report.backups.push(item);return item;
}
async function phase(name,seconds){
  const cpuStart=await cpuCounters(),driverLoop=monitorEventLoopDelay({resolution:20});driverLoop.enable();
  const startedAt=new Date().toISOString(),phaseStart=performance.now(),trace=[];
  const durationMs=seconds*1000,metrics={save:[],read:[],command:[],fanout:[],heartbeat:[],database:[]},observations=[];
  emit({phase:name,event:'started',seconds});
  const sample=async()=>{
    const start=performance.now();
    const pg=(await db.pool.query("SELECT pg_database_size(current_database())::text database_bytes,(SELECT sum(size)::text FROM pg_ls_waldir()) wal_bytes,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) connections,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') lock_waiters,(SELECT count(*)::int FROM game_save_maintenance_runs) maintenance_runs")).rows[0];
    metrics.database.push(performance.now()-start);
    const response=await fetch(rtHttp+'/metrics',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw failure('REALTIME_METRICS_UNAVAILABLE');
    const lines=await response.text(),values=Object.fromEntries(lines.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(' ').map((x,i)=>i?Number(x):x)));
    const states=await cli('docker',['stats','--no-stream','--format','{{json .}}',...containers.filter(c=>c.status==='running').map(c=>c.id)]);
    observations.push({at:new Date().toISOString(),pg,realtime:values,cpu:await cpuCounters(),containers:states.split('\n').filter(Boolean).map(JSON.parse)});
  };
  const tasks=[],timed=async(kind,run)=>{const start=performance.now(),at=new Date().toISOString();const value=await run(),ms=performance.now()-start;metrics[kind].push(ms);trace.push({kind,at,ms});return value;};
  for(const [i,actor] of fixture.people.entries()){
    tasks.push(scheduled({durationMs,periodMs:6000,offsetMs:i*6000/fixture.people.length,run:()=>timed('save',()=>clients.save(actor))}));
    tasks.push(scheduled({durationMs,periodMs:4000,offsetMs:i*4000/fixture.people.length,run:()=>timed('read',()=>clients.read(actor))}));
    if(actor.socket)tasks.push(scheduled({durationMs,periodMs:2000,offsetMs:i*200,run:()=>timed('heartbeat',()=>actor.socket.request('heartbeat.ping'))}));
  }
  for(const [i,pair] of clients.rooms.entries())tasks.push(scheduled({durationMs,periodMs:1000,offsetMs:i*150,run:async()=>{
    const r=await clients.act(pair);if(!r.restarted){metrics.command.push(r.ackMs);metrics.fanout.push(r.fanoutMs);trace.push({kind:'command',at:r.startedAt,ms:r.ackMs,fanoutMs:r.fanoutMs});}
  }}));
  tasks.push(scheduled({durationMs,periodMs:5000,run:sample}));
  if(name==='mixed')tasks.push(scheduled({durationMs,periodMs:25000,run:backup}));
  const streams=await Promise.all(tasks),summaryMetrics=Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,summary(v)]));
  await delay(Math.max(0,durationMs-(performance.now()-phaseStart)));driverLoop.disable();
  const cpuEnd=await cpuCounters(),cpuDelta=Object.fromEntries(Object.keys(cpuStart).map(service=>[service,Object.fromEntries(Object.keys(cpuStart[service]).map(key=>[key,cpuEnd[service][key]-cpuStart[service][key]]))]));
  const driverLoopMs={p99:driverLoop.percentile(99)/1e6,max:driverLoop.max/1e6};
  const result={name,seconds,startedAt,finishedAt:new Date().toISOString(),cpuDelta,driverLoopMs,metrics:summaryMetrics,offered:streams.reduce((a,s)=>a+s.attempts+s.missed,0),missed:streams.reduce((a,s)=>a+s.missed,0),
    errors:streams.flatMap(s=>s.errors),observations};
  report.phases.push(result);
  await fs.writeFile(path.join(output,name+'-latency.json'),JSON.stringify(trace,null,2)+'\n');
  const errors=result.errors.length,missed=result.missed;
  emit({phase:name,event:'finished',errors,missed,metrics:summaryMetrics});
}

try{
  await checkPorts();await compose(['config','--quiet']);started=true;
  report.gitHead=await cli('git',['rev-parse','HEAD']);report.gitDirty=Boolean(await cli('git',['status','--porcelain']));
  report.sourceFiles=Object.fromEntries(await Promise.all(['scripts/run-save-mixed-load.mjs','scripts/save-mixed-load-support.mjs','scripts/save-mixed-load-gate.mjs','deploy/compose.mixed-load.yml','apps/realtime/src/performance-metrics.mjs','apps/realtime/src/realtime-server.mjs'].map(async file=>[file,crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
  await compose(['build','migrate','realtime'],{timeout:600000,log:'build.log'});
  await compose(['up','-d','postgres','redis','migrate','api','realtime','save-storage-probe'],{timeout:180000,log:'start.log'});
  db=createDatabase({databaseUrl:'postgres://gamehub_test:'+password+'@127.0.0.1:55739/gamehub_mixed_load_test',databaseSsl:false});
  await waitReady();containers=await inspect();pgId=containers.find(c=>c.service==='postgres').id;
  const active=containers.filter(c=>c.status==='running'),cpu=active.reduce((n,c)=>n+c.cpus,0)+.10,memory=active.reduce((n,c)=>n+c.memoryBytes,0)+128*1024*1024;
  if(active.some(c=>c.cpus<=0||c.memoryBytes<=0)||cpu>2.001||memory>4*1024**3)throw failure('RESOURCE_BUDGET_INVALID');
  report.budget={cpu,memoryBytes:memory,kind:'sum of service quotas; not a production-equivalent host',containers};
  report.docker=await cli('docker',['info','--format','{{.NCPU}} CPUs; {{.MemTotal}} bytes; {{.OSType}}']);
  fixture=await seedMixedFixture(db.pool,report.offered);
  const registry=loadRulesRegistry({manifestPath:path.join(root,'rules/manifest.json'),trustedKeys:publicKeys});
  report.rules=registry.describe();
  clients=await prepareMixedClients({api,realtime,fixture,adapter:registry.get({workId:fixture.workId,modeKey:'duel',rulesetVersion:'1.0.0'})});
  await delay(5500);
  await phase('baseline',smoke?12:40);
  await compose(['up','-d','save-maintenance'],{log:'maintenance-start.log'});
  containers=await inspect();
  report.budget.mixedContainers=containers;
  report.budget.cpu=containers.filter(c=>c.status==='running').reduce((n,c)=>n+c.cpus,0);
  report.budget.memoryBytes=containers.filter(c=>c.status==='running').reduce((n,c)=>n+c.memoryBytes,0);
  if(report.budget.cpu>2.001||report.budget.memoryBytes>4*1024**3||containers.filter(c=>c.status==='running').some(c=>c.cpus<=0||c.memoryBytes<=0))throw failure('RESOURCE_BUDGET_INVALID');
  await phase('mixed',smoke?30:100);
  await compose(['stop','save-maintenance']);
  containers=await inspect();
  await phase('recovery',smoke?12:40);
  for(const actor of fixture.people)await clients.read(actor,{latest:true});
  report.invariants=await saveInvariants(db.pool);
  report.receipts=Number((await db.pool.query('SELECT count(*) n FROM game_save_operations')).rows[0].n);
  report.matchCommands=Number((await db.pool.query('SELECT count(*) n FROM multiplayer_match_events WHERE command_id IS NOT NULL')).rows[0].n);
  report.maintenance=(await db.pool.query('SELECT status,code,count(*)::int count FROM game_save_maintenance_runs GROUP BY status,code')).rows;
  report.unexpectedSocketErrors=fixture.people.reduce((n,a)=>n+(a.socket?.unexpected??0),0);
  const restored='gamehub_mixed_restore_test';
  await cli('docker',['exec',pgId,'createdb','-U','gamehub_test',restored]);
  if((await cli('docker',['exec',pgId,'sha256sum',report.backups[0].file])).split(/\s+/)[0]!==report.backups[0].sha256)throw failure('BACKUP_DIGEST_CHANGED');
  await cli('docker',['exec',pgId,'pg_restore','-U','gamehub_test','--dbname='+restored,'--exit-on-error',report.backups[0].file]);
  const restoredDb=createDatabase({databaseUrl:'postgres://gamehub_test:'+password+'@127.0.0.1:55739/'+restored,databaseSsl:false});
  try{
    report.restoredInvariants=await saveInvariants(restoredDb.pool);
    const saves=new Set((await restoredDb.pool.query('SELECT revision_id FROM game_save_operations')).rows.map(r=>r.revision_id));
    const commands=new Set((await restoredDb.pool.query('SELECT command_id FROM multiplayer_match_events WHERE command_id IS NOT NULL')).rows.map(r=>r.command_id));
    report.restoredAcknowledged={saves:backupBoundaries[0].saves.length>0&&backupBoundaries[0].saves.every(id=>saves.has(id)),commands:backupBoundaries[0].commands.length>0&&backupBoundaries[0].commands.every(id=>commands.has(id))};
  }finally{await restoredDb.close();}
  containers=await inspect();report.finalContainers=containers;
  const actualReceipts=(await db.pool.query('SELECT revision_id FROM game_save_operations ORDER BY revision_id')).rows.map(r=>r.revision_id);
  const actualCommands=(await db.pool.query('SELECT command_id FROM multiplayer_match_events WHERE command_id IS NOT NULL ORDER BY command_id')).rows.map(r=>r.command_id);
  report.evidence={saveReceipts:JSON.stringify(actualReceipts)===JSON.stringify(fixture.people.flatMap(a=>a.writes.map(w=>w.revisionId)).sort()),matchCommands:JSON.stringify(actualCommands)===JSON.stringify(clients.rooms.flatMap(r=>r.commands).sort())};
  Object.assign(report,evaluateMixedLoad(report));
  if(!report.localGatePassed)process.exitCode=1;
}catch(error){
  report.errors.push(error.code??error.name);report.localGatePassed=false;process.exitCode=1;
  emit({event:'failed',code:error.code??error.name,report:path.join(output,'report.json')});
}finally{
  fixture?.people.forEach(actor=>actor.socket?.close());
  if(db){
    if(fixture)await db.pool.query('UPDATE device_grants SET revoked_at=now() WHERE id=ANY($1::uuid[])',[fixture.people.map(p=>p.grantId)]).catch(()=>{report.errors.push('FIXTURE_REVOKE_FAILED');});
    await db.close().catch(()=>{report.errors.push('DATABASE_CLOSE_FAILED');});
  }
  if(started){
    await compose(['logs','--no-color','--tail','100'],{log:'services.log'}).catch(()=>{});
    await compose(['stop','--timeout','60'],{log:'stop.log'}).catch(()=>{report.errors.push('STOP_FAILED');report.localGatePassed=false;process.exitCode=1;});
  }
  if(started){
    try{
      report.stoppedContainers=await inspect();
      if(report.stoppedContainers.some(c=>c.status!=='exited'||c.exitCode!==0||c.oomKilled))report.errors.push('TEARDOWN_ABNORMAL_EXIT');
    }catch{report.errors.push('TEARDOWN_INSPECT_FAILED');}
  }
  report.teardown={containersStopped:started&&!report.errors.some(code=>['STOP_FAILED','TEARDOWN_ABNORMAL_EXIT','TEARDOWN_INSPECT_FAILED'].includes(code)),dataRetained:true};
  if(report.errors.length){report.localGatePassed=false;process.exitCode=1;}
  if(report.restoredInvariants)Object.assign(report,evaluateMixedLoad(report));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  emit({event:'result',localGatePassed:report.localGatePassed,productionReady:false,report:path.join(output,'report.json')});
}
