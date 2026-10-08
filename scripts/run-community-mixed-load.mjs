import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createDatabase} from '../apps/api/src/database.mjs';
import {loadRulesRegistry} from '../packages/rules-sdk/src/index.mjs';
import {summary,scheduled,seedMixedFixture,prepareMixedClients,failure,jsonRequest,uuid,digest} from './save-mixed-load-support.mjs';
import {evaluateCommunityLoad} from './community-mixed-load-gate.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
const flags=new Set(process.argv.slice(2));
if([...flags].some(x=>!['--smoke'].includes(x)))throw failure('UNKNOWN_ARGUMENT');
const smoke=flags.has('--smoke'),project='gamehub-community-load-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex');
const output=path.join(root,'.runtime','community-load',project);
await fs.mkdir(output,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('hex'),envPath=path.join(output,'test.env');
const publicKeys=JSON.parse(await fs.readFile(path.join(root,'rules/trusted-public-keys.json'),'utf8'));
await fs.writeFile(envPath,[
  'MIXED_PASSWORD='+password,'MIXED_OTP='+crypto.randomBytes(32).toString('hex'),
  'MIXED_RULE_KEYS='+JSON.stringify(publicKeys),
  'MIXED_API_IMAGE='+project+'-api:test','MIXED_RT_IMAGE='+project+'-realtime:test',''
].join('\n'),{mode:0o600});
const composeArgs=['compose','--project-name',project,'--env-file',envPath,'-f',path.join(root,'deploy/compose.community-load.yml')];
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
const api='http://127.0.0.1:55890',realtime='ws://127.0.0.1:55893',rtHttp='http://127.0.0.1:55893';

const emit=event=>process.stdout.write(JSON.stringify(event)+'\n');
const report={schemaVersion:1,project,smoke,at:new Date().toISOString(),productionReady:false,
 coverage:['real bearer auth','signed authoritative matches and WebSocket heartbeats','sharing feed/detail','likes/private bookmarks','upload/reservation/moderation','isolated image service','PostgreSQL/Redis'],
 excluded:['production host/disk/network','TLS/proxy','other source/rule builders and validation jobs','concurrent backup','long-duration soak'],
 thresholds:{read:{p95:200,p99:500},interaction:{p95:300,p99:1000},command:{p95:150,p99:500},heartbeat:{p95:100,p99:250},image:{p95:15000,p99:20000}},
 offered:{actors:smoke?4:16,pairs:smoke?1:4,fillerMiB:0,cloudSaves:false,feedIntervalMs:4000,detailIntervalMs:5000,interactionIntervalMs:12000,commandIntervalMs:1000,heartbeatIntervalMs:2000,imageStreams:4,imageIntervalMs:24000},
 phases:[],errors:[],imageReads:0};
let db,fixture,clients,containers=[],started=false;
const posts=[],assets=[],inputs=[];
// Node's fetch timeout and pooled sockets may both be unreferenced during startup.
// Keep the runner alive so failed readiness always reaches cleanup and reporting.
const keepAlive=setInterval(()=>{},1000);
async function inspect(){
  const ids=(await compose(['ps','--all','--quiet'])).split(/\s+/).filter(Boolean);
  if(!ids.length)return [];
  const values=JSON.parse(await cli('docker',['inspect',...ids]));
  if(values.some(v=>v.Config.Labels?.['com.docker.compose.project']!==project))throw failure('CONTAINER_PROJECT_MISMATCH');
  return values.map(v=>({id:v.Id,service:v.Config.Labels['com.docker.compose.service'],image:v.Image,cpus:v.HostConfig.NanoCpus/1e9,memoryBytes:v.HostConfig.Memory,status:v.State.Status,exitCode:v.State.ExitCode,oomKilled:v.State.OOMKilled,restartCount:v.RestartCount}));
}
async function checkPorts(){
  for(const port of [55839,55890,55893])await new Promise((resolve,reject)=>{
    const server=net.createServer();server.once('error',()=>reject(failure('LOOPBACK_PORT_IN_USE')));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
async function waitReady(){
  for(let i=0;i<60;i++){
    try{if((await Promise.all([api,rtHttp].map(async base=>{const response=await fetch(base+'/ready',{signal:AbortSignal.timeout(2000)});await response.arrayBuffer();return response.ok;}))).every(Boolean))return;}catch{}
    await delay(1000);
  }
  throw failure('STACK_NOT_READY');
}
const headers=post=>({'idempotency-key':uuid(),...(post?{'if-match':'"'+post.version+'"'}:{})});
async function publish(actor,post){
  post=await jsonRequest(api,actor,'/v1/community/posts/'+post.id+'/submit',{method:'POST',headers:headers(post)});
  post=await jsonRequest(api,fixture.people[0],'/v1/admin/community/posts/'+post.id+'/decisions',{method:'POST',headers:headers(post),body:{action:'approve',revisionId:post.revisionId,reason:'Synthetic local acceptance fixture'}});
  posts.push(post.id);return post;
}
async function imagePost(actor,index){
  const body={channel:'computing',title:'Synthetic image '+uuid(),blocks:[{type:'paragraph',text:'Local mixed load test; never published to production.'}]};
  let post=await jsonRequest(api,actor,'/v1/community/posts',{method:'POST',headers:headers(),body});
  const input=inputs[index%inputs.length];
  const asset=await jsonRequest(api,actor,'/v1/community/posts/'+post.id+'/media',{method:'POST',headers:headers(),body:{bytes:input.bytes.length,sha256:digest(input.bytes),contentType:'image/jpeg'}});
  const uploaded=await fetch(api+'/v1/community/media/'+asset.id+'/content',{method:'PUT',headers:{authorization:'Bearer '+actor.token,'content-type':'application/octet-stream'},body:input.bytes,signal:AbortSignal.timeout(5000)});
  if(!uploaded.ok)throw failure('IMAGE_UPLOAD_'+uploaded.status);await uploaded.arrayBuffer();
  await jsonRequest(api,actor,'/v1/community/media/'+asset.id+'/complete',{method:'POST'});
  const until=performance.now()+45000;
  for(;;){
    const state=await jsonRequest(api,actor,'/v1/community/me/media/'+asset.id);
    if(state.state==='ready')break;
    if(state.state==='failed')throw failure(state.errorCode??'IMAGE_FAILED');
    if(performance.now()>until)throw failure('IMAGE_PROCESSING_TIMEOUT');await delay(300);
  }
  post=await jsonRequest(api,actor,'/v1/community/posts/'+post.id,{method:'PATCH',headers:headers(post),body:{...body,blocks:[...body.blocks,{type:'image',assetId:asset.id,alt:'Synthetic benchmark image'}]}});
  await publish(actor,post);assets.push(asset.id);
}
async function readImage(actor,id){
  const response=await fetch(api+'/v1/community/media/'+id+'/thumb',{headers:{authorization:'Bearer '+actor.token},signal:AbortSignal.timeout(5000)});
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!response.ok||response.headers.get('content-type')!=='image/webp'||bytes.length>163840||bytes.toString('ascii',8,12)!=='WEBP')throw failure('THUMB_INVALID');
  report.imageReads++;
}
async function cgroups(){
  return Object.fromEntries(await Promise.all(containers.filter(c=>c.status==='running').map(async c=>{
    const value=await cli('docker',['exec',c.id,'cat','/sys/fs/cgroup/cpu.stat','/sys/fs/cgroup/memory.current','/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory.events']);
    const result={},memory=[];
    for(const line of value.split('\n')){const [key,val]=line.trim().split(/\s+/);if(val===undefined)memory.push(Number(key));else result[key]=Number(val);}
    return [c.service,{...result,memoryCurrent:memory[0],memoryPeak:memory[1]}];
  })));
}
async function phase(name,seconds){
  const durationMs=seconds*1000,phaseStart=performance.now(),metrics={read:[],interaction:[],command:[],fanout:[],heartbeat:[],image:[]},observations=[],trace=[],tasks=[];
  emit({event:'started',phase:name,seconds});
  const timed=async(kind,run)=>{const start=performance.now();await run();const ms=performance.now()-start;metrics[kind].push(ms);trace.push({kind,at:new Date().toISOString(),ms});};
  const sample=async()=>{
    const pg=(await db.pool.query("SELECT pg_database_size(current_database())::text database_bytes,(SELECT sum(size)::text FROM pg_ls_waldir()) wal_bytes,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) connections,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') lock_waiters")).rows[0];
    const response=await fetch(rtHttp+'/metrics',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw failure('METRICS_UNAVAILABLE');
    const realtime=Object.fromEntries((await response.text()).split('\n').filter(l=>l&&!l.startsWith('#')).map(line=>{const [k,v]=line.split(' ');return [k,Number(v)];}));
    observations.push({at:new Date().toISOString(),pg,realtime,cgroups:await cgroups()});
  };
  for(const [i,actor] of fixture.people.entries()){
    let interaction=0,detail=0;
    tasks.push(scheduled({durationMs,periodMs:4000,offsetMs:i*4000/fixture.people.length,run:()=>timed('read',async()=>{
      const result=await jsonRequest(api,actor,'/v1/community/posts');if(!result.items?.length)throw failure('EMPTY_FEED');
    })}));
    tasks.push(scheduled({durationMs,periodMs:5000,offsetMs:i*5000/fixture.people.length,run:()=>timed('read',async()=>{
      await jsonRequest(api,actor,'/v1/community/posts/'+posts[(i+detail++)%posts.length]);await readImage(actor,assets[i%assets.length]);
    })}));
    tasks.push(scheduled({durationMs,periodMs:12000,offsetMs:i*12000/fixture.people.length,run:()=>timed('interaction',async()=>{
      const type=interaction%2?'bookmark':'like',active=Math.floor(interaction++/2)%2===0;
      await jsonRequest(api,actor,'/v1/community/posts/'+posts[i%posts.length]+'/'+type,{method:active?'PUT':'DELETE'});
    })}));
    if(actor.socket)tasks.push(scheduled({durationMs,periodMs:2000,offsetMs:i*200,run:()=>timed('heartbeat',()=>actor.socket.request('heartbeat.ping'))}));
  }
  for(const [i,pair] of clients.rooms.entries())tasks.push(scheduled({durationMs,periodMs:1000,offsetMs:i*150,run:async()=>{
    const result=await clients.act(pair);if(!result.restarted){metrics.command.push(result.ackMs);metrics.fanout.push(result.fanoutMs);trace.push({kind:'command',at:result.startedAt,ms:result.ackMs,fanoutMs:result.fanoutMs});}
  }}));
  if(name==='mixed')for(let i=0;i<4;i++)tasks.push(scheduled({durationMs,periodMs:24000,offsetMs:i*1000,run:()=>timed('image',()=>imagePost(fixture.people[i],i))}));
  tasks.push(scheduled({durationMs,periodMs:5000,run:sample}));
  const streams=await Promise.all(tasks);await delay(Math.max(0,durationMs-(performance.now()-phaseStart)));
  const result={name,seconds,metrics:Object.fromEntries(Object.entries(metrics).map(([k,v])=>[k,summary(v)])),observations,missed:streams.reduce((n,s)=>n+s.missed,0),attempts:streams.reduce((n,s)=>n+s.attempts,0),errors:streams.flatMap(s=>s.errors)};
  report.phases.push(result);await fs.writeFile(path.join(output,name+'-latency.json'),JSON.stringify(trace,null,2));
  emit({event:'finished',phase:name,metrics:result.metrics,missed:result.missed,errors:result.errors});
}
try{
  await checkPorts();await compose(['config','--quiet']);started=true;
  report.gitHead=await cli('git',['rev-parse','HEAD']);report.gitDirty=Boolean(await cli('git',['status','--porcelain']));
  report.sourceFiles=Object.fromEntries(await Promise.all(['scripts/run-community-mixed-load.mjs','scripts/save-mixed-load-support.mjs','scripts/community-mixed-load-gate.mjs','deploy/compose.community-load.yml','apps/api/src/community-media-service.mjs','apps/api/src/community-image-cli.mjs'].map(async file=>[file,digest(await fs.readFile(path.join(root,file)))])));
  emit({event:'building',project});
  await compose(['build','migrate','realtime'],{timeout:600000,log:'build.log'});
  await compose(['up','-d','postgres','redis','migrate','api','realtime','worker','community-image'],{timeout:180000,log:'start.log'});
  db=createDatabase({databaseUrl:'postgres://gamehub_test:'+password+'@127.0.0.1:55839/gamehub_community_load_test',databaseSsl:false});
  await waitReady();containers=await inspect();
  const active=containers.filter(c=>c.status==='running');
  report.budget={cpu:active.reduce((n,c)=>n+c.cpus,0),memoryBytes:active.reduce((n,c)=>n+c.memoryBytes,0),kind:'sum of service quotas; not whole-host isolation',containers};
  if(active.length!==6||active.some(c=>c.cpus<=0||c.memoryBytes<=0)||report.budget.cpu>2.001||report.budget.memoryBytes>4*1024**3)throw failure('RESOURCE_BUDGET_INVALID');
  report.docker=await cli('docker',['info','--format','{{.NCPU}} CPUs; {{.MemTotal}} bytes; {{.OSType}}']);
  fixture=await seedMixedFixture(db.pool,report.offered);
  for(const actor of fixture.people){
    await db.pool.query("UPDATE users SET social_visibility='public',profile_handle=$2 WHERE id=$1",[actor.userId,'load'+actor.userId.replaceAll('-','').slice(0,12)]);
  }
  const capability=await jsonRequest(api,fixture.people[0],'/v1/community/capabilities');
  if(!capability.canShare||!capability.imagesEnabled||capability.commentsEnabled)throw failure('CAPABILITIES_MISMATCH');
  const saves=await fetch(api+'/v1/me/save-library',{headers:{authorization:'Bearer '+fixture.people[0].token}});
  report.cloudSavesDisabled=saves.status===503&&(await saves.json()).error?.code==='CLOUD_SAVE_DISABLED';
  if(!report.cloudSavesDisabled)throw failure('CLOUD_SAVE_NOT_DISABLED');
  const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),sharp=require('sharp');
  for(const [width,height] of [[1600,900],[4000,3000]]){
    const raw=Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const k=(y*width+x)*3;raw[k]=(x+y)%256;raw[k+1]=(x*3+y)%256;raw[k+2]=(y*2)%256;}
    const bytes=await sharp(raw,{raw:{width,height,channels:3}}).jpeg({quality:75}).toBuffer();
    if(bytes.length>2097152)throw failure('FIXTURE_TOO_LARGE');inputs.push({width,height,bytes});
  }
  report.images=inputs.map(({width,height,bytes})=>({width,height,bytes:bytes.length}));
  for(const actor of fixture.people)for(let i=0;i<2;i++)await publish(actor,await jsonRequest(api,actor,'/v1/community/posts',{method:'POST',headers:headers(),body:{channel:'game',title:'Synthetic text '+uuid(),blocks:[{type:'paragraph',text:'Local fixture '.repeat(30)},{type:'link',url:'https://example.com/research',label:'Synthetic link'}]}}));
  for(let i=0;i<4;i++)await imagePost(fixture.people[i],i);
  const registry=loadRulesRegistry({manifestPath:path.join(root,'rules/manifest.json'),trustedKeys:publicKeys});report.rules=registry.describe();
  clients=await prepareMixedClients({api,realtime,fixture,adapter:registry.get({workId:fixture.workId,modeKey:'duel',rulesetVersion:'1.0.0'}),cloudSaves:false});
  await delay(5500);
  await phase('baseline',smoke?12:40);await phase('mixed',smoke?30:120);await phase('recovery',smoke?12:40);
  report.invariants=(await db.pool.query("SELECT "+
    "(SELECT count(*)::int FROM community_post_stats s WHERE like_count<>(SELECT count(*) FROM community_post_likes l WHERE l.post_id=s.post_id)) bad_likes,"+
    "(SELECT count(*)::int FROM community_posts p LEFT JOIN community_post_revisions r ON r.id=p.published_revision_id WHERE p.publication_state='published' AND (r.id IS NULL OR r.review_status<>'approved' OR r.post_id<>p.id)) bad_publication,"+
    "(SELECT count(*)::int FROM community_revision_media r JOIN community_media_assets a ON a.id=r.asset_id JOIN community_posts p ON p.id=r.post_id WHERE a.post_id<>r.post_id OR a.owner_id<>p.author_id OR a.state<>'ready') bad_media,"+
    "(SELECT count(*)::int FROM community_media_assets WHERE state<>'ready' OR reserved_bytes<>0) unfinished_images,"+
    "(SELECT count(*)::int FROM game_save_slots) unexpected_cloud_saves,"+
    "(SELECT count(*)::int FROM multiplayer_matches m WHERE m.revision<>(SELECT COALESCE(max(e.seq),0) FROM multiplayer_match_events e WHERE e.match_id=m.id) OR m.next_event_seq<>m.revision+1) bad_match_sequence")).rows[0];
  const commands=(await db.pool.query('SELECT command_id FROM multiplayer_match_events WHERE command_id IS NOT NULL ORDER BY command_id')).rows.map(r=>r.command_id);
  report.matchCommandsVerified=JSON.stringify(commands)===JSON.stringify(clients.rooms.flatMap(r=>r.commands).sort());
  report.unexpectedSocketErrors=fixture.people.reduce((n,a)=>n+(a.socket?.unexpected??0),0);
  report.finalContainers=await inspect();report.finalCgroups=await cgroups();
}catch(error){report.errors.push(error.code??error.name);emit({event:'failed',code:error.code??error.name});}
finally{
  clients?.close();
  if(db){if(fixture)await db.pool.query('UPDATE device_grants SET revoked_at=now() WHERE id=ANY($1::uuid[])',[fixture.people.map(p=>p.grantId)]).catch(()=>report.errors.push('FIXTURE_REVOKE_FAILED'));await db.close().catch(()=>report.errors.push('DATABASE_CLOSE_FAILED'));}
  if(started){
    await compose(['logs','--no-color','--tail','100'],{log:'services.log'}).catch(()=>{});
    await compose(['stop','--timeout','60'],{log:'stop.log'}).catch(()=>report.errors.push('STOP_FAILED'));
    report.stoppedContainers=await inspect().catch(()=>{report.errors.push('INSPECT_FAILED');return [];});
    if(report.stoppedContainers.some(c=>c.status!=='exited'||c.oomKilled||c.exitCode!==0))report.errors.push('TEARDOWN_ABNORMAL');
  }
  Object.assign(report,evaluateCommunityLoad(report));report.dataRetained=true;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  emit({event:'result',localGatePassed:report.localGatePassed,productionReady:false,report:path.join(output,'report.json')});
  if(!report.localGatePassed)process.exitCode=1;
  clearInterval(keepAlive);
}
