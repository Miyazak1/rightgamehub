import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NapCatControl,QQ_OBSERVATION_TTL_MS} from '../../apps/qq-channel/src/napcat-control.mjs';
import {startQQControlServer} from '../../apps/qq-channel/src/control-server.mjs';
import {qqSignature} from '../../apps/api/src/qq-admin-protocol.mjs';
import {createQQChannelRuntime} from '../../apps/qq-channel/src/plugins/qq/runtime.mjs';
import {createQQAgentClient,QQAgentBridge} from '../../apps/qq-channel/src/agent-bridge.mjs';
import {qqRuntimeView,qqRuntimeReadFailure} from '../../packages/platform-client/src/qq-admin-settings.mjs';
import {decideQQRecovery,executeQQRecovery,resumeQQStart} from '../../apps/qq-channel/src/recovery-policy.mjs';
import {withQQReleaseGuard} from '../../scripts/qq-plugin-release-guard.mjs';
import {addQQApplicationGate} from '../../scripts/integrate-qq-release-guard.mjs';
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
import {qqIdentityHash,assertGuardianIdentity,assertGuardianSnapshot} from '../../scripts/qq-plugin-guardian.mjs';
const config={botId:'3922489710',groupId:'905757031'},later=()=>new Promise(r=>setImmediate(r));
function fixture(options={}){
 let now=1e6,status={isLogin:true,coreReady:true,loginPhase:'ready'},mode='ok',writes=0;
 const n=new NapCatControl({token:'a'.repeat(64),accessToken:'synthetic',now:()=>now,...options});
 let clients=[{name:'mooyu-admin-managed',enable:true,url:n.workerUrl,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:n.accessToken,debug:false}];
 const calls=[];n.post=async(p,b)=>{calls.push(p);if(mode==='timeout')throw Error('synthetic private timeout');
  if(p.endsWith('CheckLoginStatus'))return status;
  if(p.endsWith('GetQQLoginInfo'))return {uin:mode==='wrong-account'?'123':config.botId};
  if(p==='/Debug/call'){if(mode==='group-unavailable')throw Object.assign(Error(),{code:'QQ_GATEWAY_UNAVAILABLE'});return b.action==='get_group_info'?{group_id:config.groupId}:b.action==='get_group_list'?[]:{user_id:mode==='removed'?'123':config.botId};}
  if(p.endsWith('GetConfig'))return {unknownSetting:'keep',network:{websocketClients:clients}};
  if(p.endsWith('SetConfig')){writes++;clients=JSON.parse(b.config).network.websocketClients;return {};}
  if(p.endsWith('GetQQLoginQrcode'))return {qrcode:'https://ssl.ptlogin2.qq.com/synthetic'};
  if(p.endsWith('RefreshQRcode'))return {restarting:true};
  assert.fail(p);
 };
 return {n,calls,time:()=>now,advance:ms=>now+=ms,mode:v=>mode=v,status:v=>status=v,clients:v=>clients=v,writes:()=>writes};
}
test('a status-read timeout preserves the known session for a bounded window, without claiming it is fresh',async()=>{
 const f=fixture();await f.n.inspect(config);f.mode('timeout');const s=await f.n.inspect(config);
 assert.equal(s.loggedIn,true);assert.equal(s.phase,'ready');assert.equal(s.available,false);assert.equal(s.observation,'unavailable');assert(f.n.isReady(config));
 assert.equal(qqRuntimeView(s).label,'登录状态待确认');f.advance(QQ_OBSERVATION_TTL_MS+1);assert.equal(f.n.isReady(config),false);assert.equal(f.n.snapshot(config).observation,'stale');
});
test('explicit logout, wrong account and removed group immediately revoke readiness; an unknown group read preserves only login',async()=>{
 for(const mode of ['wrong-account','removed','group-unavailable','offline']){const f=fixture();await f.n.inspect(config);if(mode==='offline')f.status({isLogin:true,isOffline:true,coreReady:true,loginPhase:'offline'});else f.mode(mode);const s=await f.n.inspect(config);assert(!f.n.isReady(config));if(mode==='group-unavailable'){assert(s.loggedIn);assert.equal(s.groupState,'unknown');assert.equal(qqRuntimeView(s).label,'群状态待确认');}}
});
test('identity lookup failure pauses business as unknown, without claiming that the logged-in account is wrong',async()=>{
 const f=fixture(),post=f.n.post;f.n.post=async(...args)=>{if(args[0].endsWith('GetQQLoginInfo'))throw Error('temporary identity lookup error');return post(...args);};
 const s=await f.n.inspect(config);assert(s.loggedIn);assert.equal(s.accountState,'unknown');assert.equal(s.ready,false);assert.equal(qqRuntimeView(s).label,'账号状态待确认');
});
test('parallel same-policy inspections coalesce; browser-style snapshot floods make zero native calls',async()=>{
 const f=fixture(),post=f.n.post;f.n.post=async(...a)=>{await later();return post(...a);};
 await Promise.all(Array.from({length:30},()=>f.n.inspect(config)));assert.equal(f.calls.filter(p=>p.endsWith('CheckLoginStatus')).length,1);
 const count=f.calls.length;for(let i=0;i<100;i++)assert(f.n.snapshot(config).ready);assert.equal(f.calls.length,count);
});
test('a delayed failure for a previous group cannot overwrite newer healthy state or authorize the previous group',async()=>{
 const f=fixture(),post=f.n.post;let rejectOld,first=true;
 f.n.post=async(...a)=>{if(first){first=false;return new Promise((_,r)=>rejectOld=r);}return post(...a);};
 const old=f.n.inspect({...config,groupId:'999999999'});await f.n.inspect(config);rejectOld(Error('late synthetic failure'));await old;
 assert(f.n.isReady(config));assert.equal(f.n.isReady({...config,groupId:'999999999'}),false);assert.equal(f.n.snapshot(config).observation,'fresh');
});
test('a native probe ignoring cancellation cannot hold the sampler or overwrite a later observation after its total deadline',async()=>{
 const f=fixture({sampleTimeoutMs:25}),post=f.n.post;let resolveOld;
 f.n.post=()=>new Promise(r=>resolveOld=r);const keep=setTimeout(()=>{},1000);
 try{const failed=await f.n.inspect(config);assert(!failed.available);f.n.post=post;await f.n.inspect(config);resolveOld({isLogin:false,loginPhase:'offline'});await later();assert(f.n.isReady(config));}finally{clearTimeout(keep);}
});
test('worker reconnection gets grace; an identical managed socket configuration is never rewritten',async()=>{
 const f=fixture();await f.n.maintain(config,false);assert(!f.calls.includes('/OB11Config/GetConfig'));f.advance(16000);await f.n.maintain(config,false);
 assert(f.calls.includes('/OB11Config/GetConfig'));assert.equal(f.writes(),0);f.advance(31000);await f.n.maintain(config,false);assert.equal(f.writes(),0);assert.equal(f.n.transport.state,'waiting-native-reconnect');
});
test('only a changed managed socket is configured once, unknown fields survive, and manual enabled sockets are left alone',async()=>{
 const f=fixture();f.clients([{name:'mooyu-admin-managed',enable:true,url:'ws://old',custom:'preserve'}]);await f.n.maintain(config,false);f.advance(16000);await f.n.maintain(config,false);assert.equal(f.writes(),1);
 f.advance(61000);await f.n.maintain(config,false);assert.equal(f.writes(),1);
 const manual=fixture();manual.clients([{name:'human-custom',enable:true,url:'ws://operator'}]);await manual.n.maintain(config,false);manual.advance(16000);await manual.n.maintain(config,false);assert.equal(manual.writes(),0);assert.equal(manual.n.transport.state,'manual-config');
});
test('uncertain socket config writes back off without destroying the native login observation',async()=>{
 const f=fixture(),post=f.n.post;f.clients([]);let attempts=0;f.n.post=async(...a)=>{if(a[0].endsWith('SetConfig')){attempts++;throw Error('uncertain');}return post(...a);};
 await f.n.maintain(config,false);f.advance(16000);await f.n.maintain(config,false);for(let i=0;i<5;i++){f.advance(5000);await f.n.maintain(config,false);}assert.equal(attempts,1);assert(f.n.snapshot(config).loggedIn);
});
test('signed status HTTP reads never invoke native inspect; QR still works without a fresh snapshot and refuses a live login',async t=>{
 const f=fixture(),secret='b'.repeat(64),agent=randomUUID(),actor=randomUUID();let inspections=0;const inspect=f.n.inspect.bind(f.n);f.n.inspect=(...a)=>{inspections++;return inspect(...a);};
 const store={view:async()=>({loginRevision:1,settings:{groupId:config.groupId}}),repository:{check:async()=>config,pool:{connect:async()=>({release(){}})},transaction:async(_c,fn)=>fn({}),event:async()=>{}}};
 const server=await startQQControlServer({secret,agentUserId:agent,store,napcat:f.n,gateway:{connected:()=>true},host:'127.0.0.1',port:0});t.after(()=>server.close());
 const request=async operation=>{const id=randomUUID(),at=String(Date.now()),body=JSON.stringify({operation,actorId:actor,agentUserId:agent,args:{}});return fetch('http://127.0.0.1:'+server.address.port+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':at,'x-qq-request':id,'x-qq-signature':qqSignature(secret,at,id,body)},body});};
 for(let i=0;i<5;i++)assert.equal((await request('status')).status,200);assert.equal(inspections,0);assert.equal(f.calls.length,0);
 f.status({isLogin:false,loginPhase:'waiting_qrcode'});assert.equal((await request('qr')).status,200);
 f.status({isLogin:true,coreReady:true,loginPhase:'ready'});const response=await request('qr');assert.equal(response.status,409);assert.equal((await response.json()).error.code,'QQ_ALREADY_LOGGED_IN');assert.equal(inspections,0);
});
test('API outage keeps a queued QQ task and request identity; API recovery submits once using the same durable request',async()=>{
 let online=false,submitted=0,deferred=0,ready=0;const bodies=[];
 const client=createQQAgentClient({url:'http://api:3090',secret:'a'.repeat(64),agentId:randomUUID(),fetchImpl:async(_u,o)=>{bodies.push(JSON.parse(o.body));if(!online)throw Error('maintenance');submitted++;return Response.json({data:{id:randomUUID(),state:'completed',reply:'synthetic result'}});}});
 const row={message_id:'42',user_id:'495469022',origin_group_id:config.groupId,input_text:'synthetic task'};
 const bridge=new QQAgentBridge({client,repository:{agentLink:async()=>({request_id:'stable-request'}),agentLinked:async()=>{},agentDefer:async()=>deferred++,agentReady:async()=>ready++}});
 assert.deepEqual(await bridge.queued({},row,config),{agentWaiting:true});assert.equal(ready,0);online=true;assert.deepEqual(await bridge.queued({},row,config),{generated:true});assert.equal(submitted,1);assert.equal(deferred,1);assert.equal(bodies[0].input.requestId,bodies[1].input.requestId);
});
test('native sampling starts independently from a slow platform task and stops without mutating a login',async()=>{
 let sample=0,release,stops=0;const cfg={...config,enabled:true,allowedUsers:[]};
 const repository={enableControl:async()=>{},enableAgentBridge:async()=>{},check:async()=>cfg,locked:async fn=>fn({}),recover:async()=>{},agentPending:async()=>new Promise(r=>release=()=>r(null)),next:async()=>null};
 const runtime=createQQChannelRuntime({config:cfg,pool:{},repository,managed:true,useAgent:true,channelSecret:'b'.repeat(64),env:{QQ_ADMIN_AGENT_USER_ID:randomUUID()},client:async()=>{},gatewayFactory:()=>({start:async()=>({port:1}),stop:async()=>{},connected:()=>true}),napcatFactory:()=>({isReady:()=>true,maintain:async()=>sample++,stop:()=>stops++}),controlFactory:async()=>({address:{port:2},close:async()=>{}})});
 try{await runtime.start();await later();assert.equal(sample,1);const task=runtime.tick();await later();assert(release);runtime.stop();release();await task;assert.equal(stops,1);}finally{await runtime.close();}
});
const good=now=>({runtime:{snapshotVersion:2,available:true,loggedIn:true,coreReady:true,accountMatches:true,groupReady:true,connected:true,phase:'ready',checkedAt:new Date(now).toISOString(),verifiedAt:new Date(now).toISOString()}});
const broken=now=>({runtime:{...good(now).runtime,loggedIn:false,coreReady:false,connected:false,restartRequired:true,phase:'offline'}});
test('recovery ignores API/management errors, group-only faults and ordinary waiting-for-QR; repeated native failure is required',()=>{
 let now=1e6,state;
 for(const s of [{runtime:{}},good(now),{runtime:{...good(now).runtime,groupReady:false}},{runtime:{...broken(now).runtime,restartRequired:false,phase:'waiting_qrcode'}}])assert.equal(decideQQRecovery(null,s,now).action,'wait');
 let d=decideQQRecovery(state,broken(now),now);state=d.state;for(let i=0;i<10;i++)state=decideQQRecovery(state,broken(now),now).state;assert.equal(state.incident.samples,1);
 now+=30000;state=decideQQRecovery(state,broken(now),now).state;now+=30000;d=decideQQRecovery(state,broken(now),now);assert.equal(d.action,'restart-same-gateway');
});
test('restart transaction records its budget before side effects and always starts after a stopped backup validation failure',async()=>{
 const events=[],saved=[];const io={save:async s=>{events.push('save');saved.push(structuredClone(s));},guard:async()=>events.push('guard'),backup:async cold=>{events.push(cold?'cold':'warm');if(cold)throw Error('cold-backup-failed');},probe:async()=>broken(1e6),assertNoSending:async()=>events.push('no-sending'),stop:async()=>events.push('stop'),guardStopped:async()=>events.push('stopped-identity'),start:async()=>events.push('start'),verify:async()=>events.push('verify')};
 await assert.rejects(executeQQRecovery({state:decideQQRecovery(null,broken(1e6),1e6).state,now:1e6,io}),/cold-backup-failed/);
 assert.equal(events[0],'save');assert(events.indexOf('start')>events.indexOf('cold'));assert.equal(events.filter(e=>e==='stop').length,1);assert.equal(events.filter(e=>e==='start').length,1);assert.equal(saved.at(-1).manualRequired,true);assert.equal(saved[0].attempts.length,1);
});
test('in-flight delivery or recovered login aborts before stop; reservation survives and prevents automatic repeats',async()=>{
 for(const reason of ['sending','recovered']){let stops=0,last;const io={save:async s=>last=s,guard:async()=>{},backup:async()=>{},probe:async()=>reason==='recovered'?good(1e6):broken(1e6),assertNoSending:async()=>{if(reason==='sending')throw Error('sending');},stop:async()=>stops++};await assert.rejects(executeQQRecovery({state:decideQQRecovery(null,broken(1e6),1e6).state,now:1e6,io}));assert.equal(stops,0);assert.equal(decideQQRecovery(last,broken(1e6),1e6).reason,'manual-review-required');}
});
test('an interrupted stop has a start-only compensation, guarded by a verified warm backup, and cannot repeat after another crash',async()=>{
 let saved,start=0;const prior={version:1,attempts:[1e6],manualRequired:true,lastOutcome:'stop-requested'},io={save:async s=>saved=s,guardStopped:async()=>{},verifyWarmBackup:async()=>{},start:async()=>start++,verify:async()=>{}};
 await resumeQQStart({state:prior,io});assert.equal(start,1);assert.equal(saved.manualRequired,false);
 await assert.rejects(resumeQQStart({state:{...prior,compensationReserved:true},io}),/REFUSED/);assert.equal(start,1);
});
test('restart budget has per-incident, daily, cooldown and backwards-clock circuit breakers',()=>{
 let now=1e6,state={version:1,attempts:[],manualRequired:false,incidentHandled:true};assert.equal(decideQQRecovery(state,broken(now),now).reason,'incident-already-handled');
 for(const [attempts,reason]of [[[now-1000,now-2000],'daily-restart-limit'],[[now-1000],'restart-cooldown']]){state={version:1,attempts,manualRequired:false,incident:{firstAt:now-61000,samples:3,lastSample:null}};assert.equal(decideQQRecovery(state,broken(now),now).reason,reason);}
 state={version:1,attempts:[],manualRequired:false,lastAt:now+1};assert.equal(decideQQRecovery(state,broken(now),now).reason,'clock-changed');
});
test('restart completion leads to a fresh scannable QR and restored readiness without password or login data deletion',async()=>{
 const f=fixture();f.status({isLogin:false,loginPhase:'offline',loginError:'登录服务重启失败: 重启功能未初始化'});let s=await f.n.inspect(config);assert.equal(s.restartRequired,true);
 const io={save:async()=>{},guard:async()=>{},backup:async()=>{},probe:async()=>({runtime:s}),assertNoSending:async()=>{},stop:async()=>{},guardStopped:async()=>{},start:async()=>f.status({isLogin:false,loginPhase:'waiting_qrcode',qrcodeurl:'https://ssl.ptlogin2.qq.com/synthetic'}),verify:async()=>{}};
 await executeQQRecovery({state:decideQQRecovery(null,{runtime:s},f.time()).state,now:f.time(),io});s=await f.n.inspect(config);assert(s.qrAvailable);assert.equal(qqRuntimeView(s).label,'待扫码登录');assert((await f.n.qr()).qrText);
 f.status({isLogin:true,coreReady:true,loginPhase:'ready'});assert((await f.n.inspect(config)).ready);assert(f.calls.every(p=>!p.includes('PasswordLogin')&&!p.includes('RefreshQRcode')));
});
test('guardian only accepts a pinned same gateway/container/volume/multiprocess mode and its bound worker snapshot',()=>{
 const c={Id:'a'.repeat(64),Name:'/mooyu-qq-napcat-1',Image:'sha256:'+'b'.repeat(64),State:{Running:true,Restarting:false},Config:{Env:['NAPCAT_DISABLE_MULTI_PROCESS=0']},HostConfig:{},Mounts:[{Type:'volume',Name:'preserved_login',Destination:'/data'}],NetworkSettings:{Networks:{}}};
 const cfg={version:1,enabled:false,gateway:'mooyu-qq-napcat-1',worker:'mooyu-qq-worker-1',image:c.Image,identityHash:qqIdentityHash(c),loginVolume:'preserved_login',...config};
 assertGuardianIdentity(c,cfg);for(const change of [{Image:'sha256:'+'c'.repeat(64)},{Id:'d'.repeat(64)},{Mounts:[{Type:'volume',Name:'different',Destination:'/data'}]}])assert.throws(()=>assertGuardianIdentity({...c,...change},cfg));
 assertGuardianSnapshot({binding:{botId:config.botId},groupId:config.groupId,paperEnabled:false,runtime:{checkedAt:'now',snapshotVersion:2}},cfg);assert.throws(()=>assertGuardianSnapshot({binding:{botId:'wrong'}},cfg));
});
test('feature release scope and fresh QQ application baseline gate the update; post-update stable window checks new observations',async()=>{
 let now=1e6,applied=0;const args={roles:['gamehub-production-api-1','gamehub-production-agent-interactions-1'],captureProtected:async()=>({gateway:'same',worker:'same',login:'same',papers:false}),readQQ:async()=>good(now),apply:async()=>++applied,pause:async ms=>now+=ms,now:()=>now};
 const result=await withQQReleaseGuard(args);assert.equal(applied,1);assert.equal(result.stableWindowMs,40000);
 await assert.rejects(withQQReleaseGuard({...args,roles:['mooyu-qq-worker-1']}),/SCOPE_REFUSED/);assert.equal(applied,1);
 await assert.rejects(withQQReleaseGuard({...args,readQQ:async()=>({runtime:{...good(now).runtime,groupReady:false}})}),/BASELINE_NOT_READY/);assert.equal(applied,1);
 let changed=false;await assert.rejects(withQQReleaseGuard({...args,apply:async()=>changed=true,captureProtected:async()=>({changed})}),/PROTECTED_STATE_CHANGED/);
});
test('platform status failure never fabricates native logout; both UI views use the same group state',()=>{
 const value={...good(1e6).runtime,groupReady:false,groupState:'unknown'},failed=qqRuntimeReadFailure(value);assert.equal(failed.loggedIn,true);assert.equal(failed.connected,true);assert.equal(qqRuntimeView(failed).label,'状态查询中断');assert.equal(qqRuntimeView(value).label,'群状态待确认');
});
test('new GitHub updater can enforce a pre-update native snapshot and post-update stable window without altering frozen artifacts',()=>{
 const original=fs.readFileSync(new URL('../../scripts/update-github-search-online.mjs',import.meta.url),'utf8'),generated=addQQApplicationGate(original);
 assert.equal(spawnSync(process.execPath,['--input-type=module','--check'],{input:generated,encoding:'utf8'}).status,0);
 assert(generated.indexOf('assertQQApplicationHealthy(qqApplicationSnapshot())')<generated.indexOf("record:async()=>"));assert(generated.includes('qqApplicationVerified:true,qqStableWindowMs:40000'));
 assert.equal(fs.readFileSync(new URL('../../scripts/update-github-search-online.mjs',import.meta.url),'utf8'),original);assert.throws(()=>addQQApplicationGate(generated),/ANCHOR_REQUIRED/);
});
