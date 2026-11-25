import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {QQ_ROUTE_SQL,API_ROUTE_SQL,GATEWAY_CONFIG_PROBE,SNAPSHOT_PROBE,databaseProbe,summarizeWorkerLogs} from '../../scripts/qq-message-route-readonly.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

test('only event names, fixed error codes and incident counts escape log sanitization',()=>{
 const secret='RAW_PRIVATE_MESSAGE_TOKEN';
 const logs=[`2026-11-25T05:05:05.000Z ${JSON.stringify({event:'admission',messageId:secret})}`,
 `2026-11-25T10:00:00.000Z ${JSON.stringify({event:'worker-waiting',code:'QQ_GATEWAY_OFFLINE',details:secret})}`,
 `2026-11-25T10:00:01.000Z ${JSON.stringify({event:secret,code:secret})}`,secret].join('\n');
 const summary=summarizeWorkerLogs(logs);assert.equal(summary.admission.incidentWindowCount,1);
 assert.equal(summary['worker-waiting:QQ_GATEWAY_OFFLINE'].count,1);assert(!JSON.stringify(summary).includes(secret));
});

test('gateway configuration probe reports format and target without URLs or tokens',async()=>{
 const out=[],secret='DO_NOT_PRINT_TOKEN_OR_PRIVATE_URL';
 const fakeFs={lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false,size:400}),readFileSync:()=>JSON.stringify({network:{websocketClients:[{enable:true,name:'mooyu-admin-managed',url:'ws://worker:6700/onebot/v11?secret='+secret,token:secret,messagePostFormat:'string',reportSelfMessage:false}]}})};
 await new AsyncFunction('fs','console',GATEWAY_CONFIG_PROBE.replace("import fs from 'node:fs';",''))(fakeFs,{log:v=>out.push(JSON.parse(v))});
 assert.equal(out[0].configuration[0].clients[0].messagePostFormat,'string');assert.equal(out[0].configuration[0].clients[0].workerEndpoint,true);
 assert(!JSON.stringify(out).includes(secret));
});

test('snapshot uses existing signed status only; SQL probes enforce server-side read-only and suppress raw errors',async()=>{
 const calls=[],out=[],secret='PRIVATE_SECRET_AND_MESSAGE';
 const source=SNAPSHOT_PROBE.replace(/^import .*;\r?\n/gm,'');
 await new AsyncFunction('fs','crypto','qqSignature','process','fetch','console',source)(
  {readFileSync:()=>secret},{randomUUID:()=>crypto.randomUUID()},()=>secret,
  {env:{QQ_ADMIN_SECRET_FILE:'private',QQ_ADMIN_AGENT_USER_ID:'fixture-agent',QQ_AGENT_INTERACTIONS_ENABLED:'true'}},
  async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({data:{runtime:{ready:true,available:true},binding:{executionMode:'agent'},private:secret}})};},
  {log:v=>out.push(JSON.parse(v))});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:6780/control');assert.equal(calls[0].body.operation,'status');
 for(const kind of ['qq','api']){
  let settings;const queries=[];
  class Pool{constructor(v){settings=v;}async query(sql){assert.match(sql.trim(),/^SELECT\b/);queries.push(sql);throw Object.assign(Error(secret),{code:'42P01'});}async end(){}}
  await new AsyncFunction('createRequire','process','console',databaseProbe(kind).replace("import {createRequire} from 'node:module';",''))(()=>()=>({Pool}),{env:{}},{log:v=>out.push(JSON.parse(v))});
  assert.match(settings.options,/default_transaction_read_only=on/);assert.equal(queries.length,Object.keys(kind==='qq'?QQ_ROUTE_SQL:API_ROUTE_SQL).length);
 }
 assert(!JSON.stringify(out).includes(secret));
});

test('incident and recent SQL execute against isolated PostgreSQL; read-only collection leaves records unchanged',
 {skip:process.env.QQ_ROUTE_SQL_ISOLATED!=='1'},async()=>{
 const name='right-qq-route-readonly-'+crypto.randomBytes(6).toString('hex');
 const docker=(args,input)=>{const r=spawnSync('docker',args,{encoding:'utf8',input,timeout:30000,maxBuffer:1048576});assert.equal(r.status,0,r.stderr);return r.stdout;};
 docker(['run','--rm','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']);
 try{
  let ready=false;for(let i=0;i<40;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{encoding:'utf8',timeout:3000});if(r.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}assert(ready);
  const schema=fs.readFileSync(new URL('../../apps/qq-channel/src/schema.sql',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../../apps/qq-channel/src/control-schema.sql',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../../apps/qq-channel/src/agent-schema.sql',import.meta.url),'utf8');
  docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],schema+`
CREATE TABLE agent_channel_participants(agent_user_id uuid,channel text,actor_ref text,can_invoke boolean,status text,revision int,updated_at timestamptz);
CREATE TABLE agent_runs(id uuid,status text,error_code text);
CREATE TABLE agent_interactions(id uuid,parent_id uuid,kind text,actor_ref text,event_ref text,state text,error_code text,created_at timestamptz,updated_at timestamptz,attempts int,next_attempt_at timestamptz,run_id uuid,channel text,agent_user_id uuid);
INSERT INTO mooyu_qq.settings(channel_id,policy_hash) VALUES('3922489710:905757031','fixture');
INSERT INTO mooyu_qq.control_settings(channel_id,bootstrap_hash,policy) VALUES('3922489710:905757031','fixture','{"enabled":true,"groupId":"905757031","allowedUsers":["495469022"]}');
INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,origin_group_id,created_at) VALUES('3922489710:905757031','123','495469022','PRIVATE_FIXTURE_TEXT','x','905757031','2026-11-25T05:05:00Z');`);
  for(const [kind,queries]of Object.entries({qq:QQ_ROUTE_SQL,api:API_ROUTE_SQL}))for(const [key,sql]of Object.entries(queries)){
   const result=docker(['exec','-i',name,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],`BEGIN READ ONLY;\n${sql};\nROLLBACK;`);
   assert(!result.includes('PRIVATE_FIXTURE_TEXT'));
   if(kind==='qq'&&key==='incident')assert.match(result,/123\|9022/);
  }
  assert.equal(docker(['exec',name,'psql','-U','postgres','-At','-c','SELECT count(*) FROM mooyu_qq.messages']).trim(),'1');
 }finally{assert.match(name,/^right-qq-route-readonly-[a-f0-9]{12}$/);docker(['rm','-f',name]);}
});
