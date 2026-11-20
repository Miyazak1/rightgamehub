const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {createRequire}=require('node:module'),qqRequire=createRequire(path.resolve('apps/qq-channel/package.json')),{Pool}=qqRequire('pg');
const enabled=process.env.QA_LEDGER_TEST_ISOLATED==='1'&&Boolean(process.env.QA_LEDGER_TEST_URL);
test('QQ administrator controls use real isolated PostgreSQL, authenticated HTTP, durable CAS and scoped history',{skip:!enabled,timeout:180000},async t=>{
 const url=new URL(process.env.QA_LEDGER_TEST_URL);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/qa_ledger_test_/);
 const control=new Pool({connectionString:url.href}),name='mooyu_qq_local_admin_'+crypto.randomBytes(8).toString('hex');await control.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const pool=new Pool({connectionString:url.href,max:10});pool.on('error',()=>{});
 t.after(async()=>{await pool.end();await control.query('DROP DATABASE '+name+' WITH (FORCE)');await control.end();});
 const {parseConfig}=await import('../../apps/qq-channel/src/config.mjs'),{QQRepository}=await import('../../apps/qq-channel/src/repository.mjs'),{QQService}=await import('../../apps/qq-channel/src/service.mjs'),{QQControlStore}=await import('../../apps/qq-channel/src/control-store.mjs'),{qqPolicyView,qqSignature,qqAdminError}=await import('../../apps/api/src/qq-admin-protocol.mjs');
 const actorId=crypto.randomUUID(),agentId=crypto.randomUUID();let count=0;
 const command=(settings,expectedRevision=1)=>({operation:'configure',actorId,agentUserId:agentId,args:{expectedRevision,settings}});
 async function fixture(){
  const input={enabled:true,botId:String(100000001+(++count)*10),groupId:'200000001',allowedUsers:['300000001','300000002'],dailyCalls:50,userDailyCalls:40,userMinuteMessages:10,groupMinuteMessages:30};
  const env={QQ_DATABASE_URL:url.href,QQ_ACCESS_TOKEN:'test-only-qq-control-'.repeat(3)},config=parseConfig(input,env),repo=new QQRepository(pool,config);await repo.initialize();
  const calls=[],sends=[],provider=async request=>{calls.push(request);return {reply:'synthetic private context A',usage:{inputTokens:10,outputTokens:10}};};
  const service=new QQService({config,repository:repo,provider,gateway:{connected:()=>true,send:async row=>{sends.push({id:row.message_id,group:row.origin_group_id,reply:row.reply});return '800'+sends.length;}}});
  const event=(id,group=input.groupId,user='300000001',text='synthetic question')=>({post_type:'message',message_type:'group',self_id:Number(config.botId),group_id:Number(group),user_id:Number(user),message_id:id,message:[{type:'at',data:{qq:config.botId}},{type:'text',data:{text}}]});
  const row=async id=>(await pool.query('SELECT * FROM mooyu_qq.messages WHERE channel_id=$1 AND message_id=$2',[repo.id,String(id)])).rows[0];
  return {input,env,config,repo,service,calls,sends,event,row,store:new QQControlStore(repo),enable:()=>repo.enableControl()};
 }
 await t.test('additive control initialization preserves all legacy history, attempts and audit; legacy worker fails closed',async()=>{
  const f=await fixture();await f.service.receive(f.event(1));await f.service.tick();await f.service.tick();
  const before=await f.row(1),budget=await f.repo.status();await f.enable();await f.enable();
  const after=await f.row(1);assert.deepEqual({...after,origin_group_id:null},{...before,origin_group_id:null});assert.equal(after.origin_group_id,f.config.groupId);
  assert.equal((await f.store.view()).revision,1);assert.deepEqual((await f.repo.status()).budget,budget.budget);
  await assert.rejects(new QQRepository(pool,f.config).check(),{code:'QQ_POLICY_REINITIALIZATION_REQUIRED'});
  await assert.rejects(new QQRepository(pool,f.config).initialize(),{code:'QQ_MANAGED_INITIALIZATION_REQUIRED'});
  const second=new QQRepository(pool,f.config);await second.enableControl();assert.equal((await second.status()).budget.calls,1);
 });
 await t.test('simultaneous administrators cannot overwrite each other; stale revisions and nonce reuse reject, idempotent replay does not reset budget',async()=>{
  const f=await fixture();await f.enable();const initial=(await f.store.view()).settings;
  const results=await Promise.allSettled([f.store.mutate(crypto.randomUUID(),command({...initial,dailyCalls:40})),f.store.mutate(crypto.randomUUID(),command({...initial,dailyCalls:30}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.store.view()).revision,2);
  await assert.rejects(f.store.mutate(crypto.randomUUID(),command(initial)),{code:'QQ_SETTINGS_CONFLICT'});
  const id=crypto.randomUUID(),change=command({...initial,enabled:false},2),first=await f.store.mutate(id,change),beforeEvents=(await pool.query('SELECT count(*) FROM mooyu_qq.events WHERE channel_id=$1',[f.repo.id])).rows[0].count;
  assert.deepEqual(await f.store.mutate(id,change),first);assert.equal((await pool.query('SELECT count(*) FROM mooyu_qq.events WHERE channel_id=$1',[f.repo.id])).rows[0].count,beforeEvents);
  await assert.rejects(f.store.mutate(id,command(initial,3)),{code:'QQ_REQUEST_CONFLICT'});
  await assert.rejects(pool.query('DELETE FROM mooyu_qq.events WHERE channel_id=$1',[f.repo.id]));
 });
 await t.test('pause rejects new admission but retains queued tasks; resume completes once without resetting charged calls',async()=>{
  const f=await fixture();await f.enable();await f.service.receive(f.event(1));const initial=qqPolicyView(f.config);
  await f.store.mutate(crypto.randomUUID(),command({...initial,enabled:false}));
  assert.equal((await f.service.receive(f.event(2))).accepted,false);await f.service.tick();assert.equal((await f.row(1)).status,'queued');assert.equal(f.calls.length,0);
  await f.store.mutate(crypto.randomUUID(),command(initial,2));await f.service.tick();await f.service.tick();assert.equal(f.sends.length,1);assert.equal((await f.repo.status()).budget.calls,1);
  assert.equal((await f.service.receive(f.event(1))).duplicate,true);await f.service.tick();assert.equal(f.sends.length,1);
 });
 await t.test('group changes never redirect old queued replies or mix group context, and cannot reset the daily ledger',async()=>{
  const f=await fixture();await f.enable();await f.service.receive(f.event(1));await f.service.tick();await f.service.tick();await f.service.receive(f.event(2));
  await f.store.mutate(crypto.randomUUID(),command({...qqPolicyView(f.config),groupId:'200000002',allowedUsers:['300000001']}));
  assert.equal((await f.service.receive(f.event(3))).accepted,false);assert.equal((await f.service.receive(f.event(4,'200000002'))).accepted,true);
  await f.service.tick();assert.equal((await f.row(2)).status,'failed');await f.service.tick();await f.service.tick();
  assert.equal(f.sends.at(-1).group,'200000002');assert.equal(f.sends.length,2);assert.equal(f.calls.at(-1).messages.filter(m=>m.role==='assistant').length,0);assert.equal((await f.repo.status()).budget.calls,2);
 });
 await t.test('settings cannot change underneath an in-flight model; a newly paused ready reply stays durable',async()=>{
  const f=await fixture();await f.enable();await f.service.receive(f.event(1));let release;
  f.service.provider=()=>new Promise(resolve=>{release=resolve;});const ticking=f.service.tick();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
  await assert.rejects(f.store.mutate(crypto.randomUUID(),command({...qqPolicyView(f.config),enabled:false})),{code:'QQ_WORKER_BUSY'});
  release({reply:'synthetic saved reply',usage:{inputTokens:2,outputTokens:2}});await ticking;
  await f.store.mutate(crypto.randomUUID(),command({...qqPolicyView(f.config),enabled:false}));await f.service.tick();assert.equal((await f.row(1)).status,'ready');assert.equal(f.sends.length,0);
  await f.store.mutate(crypto.randomUUID(),command(qqPolicyView(f.config),2));await f.service.tick();assert.equal(f.sends.length,1);
 });
 await t.test('QR refresh intent is durable; unknown external outcomes never rerun on request replay',async()=>{
  const f=await fixture();await f.enable();const id=crypto.randomUUID(),op={operation:'refresh',actorId,agentUserId:agentId,args:{expectedLoginRevision:1}};let refreshes=0;
  const failure=async()=>{refreshes++;throw Error('synthetic lost response');};await assert.rejects(f.store.mutate(id,op,failure),{code:'QQ_ACTION_UNCERTAIN'});
  await assert.rejects(f.store.mutate(id,op,failure),{code:'QQ_ACTION_UNCERTAIN'});assert.equal(refreshes,1);assert.equal((await f.store.view()).loginRevision,2);
  await assert.rejects(f.store.mutate(crypto.randomUUID(),op,failure),{code:'QQ_LOGIN_CONFLICT'});
  assert(!JSON.stringify((await f.store.view()).audit).includes('synthetic lost response'));
 });
 await t.test('password operations persist only metadata, preserve history/budget and serialize against QR refresh',async()=>{
  const f=await fixture();await f.service.receive(f.event(1));await f.service.tick();await f.service.tick();await f.enable();
  const history=await f.row(1),budget=(await f.repo.status()).budget,secret='synthetic-password-never-store';
  await pool.query("ALTER TABLE mooyu_qq.control_requests DROP CONSTRAINT control_requests_operation_check; ALTER TABLE mooyu_qq.control_requests ADD CONSTRAINT control_requests_operation_check CHECK(operation IN ('configure','refresh'))");
  await f.repo.enableControl();

  const op={operation:'password',actorId,agentUserId:agentId,args:{expectedLoginRevision:1,uin:f.config.botId,password:secret}},id=crypto.randomUUID();let calls=0;
  const action=async()=>{calls++;return {outcome:'verification_required',verification:'new_device',jumpUrl:secret,passwordMd5:secret};};
  const result=await f.store.mutate(id,op,action);assert.deepEqual(result,{loginRevision:2,outcome:'verification_required',verification:'new_device'});
  assert.deepEqual(await f.store.mutate(id,{...op,args:{...op.args,password:'different-transient-password'}},action),result);assert.equal(calls,1);
  await assert.rejects(f.store.mutate(crypto.randomUUID(),{operation:'refresh',actorId,agentUserId:agentId,args:{expectedLoginRevision:1}},()=>{throw Error('must not run');}),{code:'QQ_LOGIN_CONFLICT'});
  const rows=(await pool.query('SELECT digest,operation,result FROM mooyu_qq.control_requests WHERE channel_id=$1',[f.repo.id])).rows;
  const events=(await pool.query('SELECT details FROM mooyu_qq.events WHERE channel_id=$1',[f.repo.id])).rows;
  assert(!JSON.stringify({rows,events}).includes(secret));assert(!JSON.stringify({rows,events}).includes(crypto.createHash('md5').update(secret).digest('hex')));
  const safe={...op,args:{expectedLoginRevision:1,uin:f.config.botId}};assert.equal(rows[0].digest,crypto.createHash('sha256').update(JSON.stringify(safe)).digest('hex'));
  assert.deepEqual(await f.row(1),history);assert.deepEqual((await f.repo.status()).budget,budget);assert.equal((await f.store.view()).paperEnabled,false);
  await f.repo.enableControl();assert.deepEqual(await f.row(1),history);assert.equal((await f.store.view()).loginRevision,2);
  const lost={...op,args:{...op.args,expectedLoginRevision:2}},lostId=crypto.randomUUID();
  await assert.rejects(f.store.mutate(lostId,lost,async()=>{calls++;throw Error(secret);}),{code:'QQ_ACTION_UNCERTAIN'});
  await assert.rejects(f.store.mutate(lostId,lost,action),{code:'QQ_ACTION_UNCERTAIN'});assert.equal(calls,2);
 });
 await t.test('signed password bridge restricts the bound QQ, redacts persistence and rate-limits login attempts',async()=>{
  const f=await fixture();await f.enable();const {startQQControlServer}=await import('../../apps/qq-channel/src/control-server.mjs');
  const secret=crypto.randomBytes(32).toString('hex'),password='synthetic-signed-login-password';let calls=0;
  const server=await startQQControlServer({secret,agentUserId:agentId,store:f.store,gateway:{connected:()=>false},napcat:{inspect:async()=>({loggedIn:false}),passwordLogin:async(uin,value)=>{assert.equal(uin,f.config.botId);assert.equal(value,password);calls++;return {outcome:'submitted'};}},host:'127.0.0.1',port:0});
  try{
   const send=async(command,id=crypto.randomUUID(),signature=true)=>{const body=JSON.stringify(command),timestamp=String(Date.now());return fetch('http://127.0.0.1:'+server.address.port+'/control',{method:'POST',headers:{'Content-Type':'application/json',...(signature?{'X-QQ-Time':timestamp,'X-QQ-Request':id,'X-QQ-Signature':qqSignature(secret,timestamp,id,body)}:{})},body});};
   const command={operation:'password',actorId,agentUserId:agentId,args:{expectedLoginRevision:1,uin:f.config.botId,password}},id=crypto.randomUUID();
   assert.equal((await send(command,id,false)).status,401);assert.equal(calls,0);
   assert.equal((await send({...command,args:{...command.args,uin:'999999999'}})).status,409);assert.equal(calls,0);
   let response=await send(command,id);assert.equal(response.status,200);assert.equal((await response.json()).data.outcome,'submitted');assert.equal(calls,1);
   response=await send(command,id);assert.equal(response.status,200);assert.equal(calls,1);
   response=await send({...command,args:{...command.args,expectedLoginRevision:1}});assert.equal(response.status,409);assert.equal(calls,1);
   response=await send(command,id);assert.equal(response.status,200);
   response=await send(command,id);assert.equal(response.status,429);assert.equal(calls,1);
   const rows=(await pool.query('SELECT row_to_json(r) AS value FROM mooyu_qq.control_requests r WHERE channel_id=$1',[f.repo.id])).rows;
   const events=(await pool.query('SELECT details FROM mooyu_qq.events WHERE channel_id=$1',[f.repo.id])).rows;
   assert(!JSON.stringify({rows,events}).includes(password));assert(!JSON.stringify({rows,events}).includes(crypto.createHash('md5').update(password).digest('hex')));
  }finally{await server.close();}
 });
 await t.test('real HTTP bridge rejects forged/expired signatures and website permission or ownership failures before exposing QR',async()=>{
  const f=await fixture();await f.enable();const secret=crypto.randomBytes(32).toString('hex');let qrReads=0;
  const {startQQControlServer}=await import('../../apps/qq-channel/src/control-server.mjs');
  const server=await startQQControlServer({secret,agentUserId:agentId,store:f.store,gateway:{connected:()=>false},napcat:{inspect:async()=>({available:true,loggedIn:false,phase:'waiting_qrcode'}),qr:async()=>{qrReads++;return {qrText:'https://ssl.ptlogin2.qq.com/synthetic-test',expiresAt:new Date(Date.now()+60000).toISOString()};},refresh:async()=>{}},host:'127.0.0.1',port:0});t.after(()=>server.close());
  const endpoint='http://127.0.0.1:'+server.address.port+'/control',body=JSON.stringify({operation:'qr',actorId,agentUserId:agentId,args:{}}),id=crypto.randomUUID(),old=String(Date.now()-60000);
  for(const headers of [{},{'x-qq-time':old,'x-qq-request':id,'x-qq-signature':qqSignature(secret,old,id,body)}]){const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});assert.equal(response.status,401);}
  assert.equal(qrReads,0);
  await pool.query("CREATE TABLE users(id uuid PRIMARY KEY,status text DEFAULT 'active',role text DEFAULT 'user',account_type text DEFAULT 'human');CREATE TABLE agent_accounts(user_id uuid PRIMARY KEY,operator_user_id uuid,status text DEFAULT 'active');");
  const other=crypto.randomUUID();await pool.query("INSERT INTO users(id,role) VALUES($1,'admin'),($2,'admin'),($3,'user')",[actorId,other,agentId]);await pool.query('INSERT INTO agent_accounts(user_id,operator_user_id) VALUES($1,$2)',[agentId,actorId]);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'qq-admin-test-'));t.after(async()=>{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(temp).startsWith('qq-admin-test-'));await fs.rm(temp,{recursive:true,force:true});});const file=path.join(temp,'secret');await fs.writeFile(file,secret);
  const {createAgentQQAdminService}=await import('../../apps/api/src/agent-qq-admin-service.mjs');
  const service=createAgentQQAdminService({pool,env:{QQ_ADMIN_ENABLED:'true',QQ_ADMIN_AGENT_USER_ID:agentId,QQ_ADMIN_ORIGIN:'http://qq-control:6780',QQ_ADMIN_SECRET_FILE:file},fetchImpl:(_url,options)=>fetch(endpoint,options)});
  await assert.rejects(service.execute({userId:actorId,profile:{role:'user'}},agentId,'qr'),{code:'QQ_ADMIN_REQUIRED'});
  await assert.rejects(service.execute({userId:other,profile:{role:'admin'}},agentId,'qr'),{code:'QQ_AGENT_NOT_FOUND'});assert.equal(qrReads,0);
  const operator={userId:actorId,profile:{role:'admin'}};const qr=await service.execute(operator,agentId,'qr');assert.match(qr.qrText,/qq.com/);assert.equal(qrReads,1);
  await pool.query("UPDATE users SET role='user' WHERE id=$1",[actorId]);await assert.rejects(service.execute(operator,agentId,'qr'),{code:'QQ_AGENT_NOT_FOUND'});assert.equal(qrReads,1);await pool.query("UPDATE users SET role='admin' WHERE id=$1",[actorId]);
  const apiRequire=createRequire(path.resolve('apps/api/package.json')),app=apiRequire('fastify')();t.after(()=>app.close());
  const {registerAgentQQAdminRoutes}=await import('../../apps/api/src/agent-qq-admin-routes.mjs');app.setErrorHandler((e,_req,reply)=>reply.code(e.statusCode??500).send({error:{code:e.code}}));registerAgentQQAdminRoutes(app,{service,requireAuth:async req=>{if(req.headers.authorization!=='test-owner')throw qqAdminError('QQ_ADMIN_REQUIRED',403);req.actor=operator;}});
  const denied=await app.inject({url:`/v1/admin/agents/${agentId}/qq/qrcode`});assert.equal(denied.statusCode,403);assert.match(denied.headers['cache-control'],/no-store/);assert(!denied.body.includes('qrText'));
  const invalid=await app.inject({method:'PUT',url:`/v1/admin/agents/${agentId}/qq/settings`,headers:{authorization:'test-owner'},payload:{requestId:crypto.randomUUID(),expectedRevision:1,settings:{...qqPolicyView(f.config),PAPER_STUDY_ENABLED:true}}});assert.equal(invalid.statusCode,400);
  assert.equal((await f.store.view()).revision,1);assert.equal(qrReads,1);assert(!JSON.stringify((await f.store.view()).audit).includes('ptlogin2'));
 });
});
