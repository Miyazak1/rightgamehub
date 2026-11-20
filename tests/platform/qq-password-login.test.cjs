const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const agentId=crypto.randomUUID(),actorId=crypto.randomUUID();
const password='synthetic-QQ-password-private',uin='100000001';
const makeCommand=()=>({operation:'password',actorId,agentUserId:agentId,args:{expectedLoginRevision:1,uin,password}});

test('password commands validate bounded inputs and reject extra settings or credentials',async()=>{
 const {validateQQCommand}=await import('../../apps/api/src/qq-admin-protocol.mjs');
 assert.equal(validateQQCommand(makeCommand(),crypto.randomUUID(),agentId).operation,'password');
 for(const args of [{password:''},{password:'密'.repeat(100)},{uin:'not-qq'},{expectedLoginRevision:0},{passwordMd5:'a'.repeat(32)},{PAPER_STUDY_ENABLED:true}]){
  const command=makeCommand();Object.assign(command.args,args);assert.throws(()=>validateQQCommand(command,crypto.randomUUID(),agentId),{code:'QQ_CONTROL_INPUT'});
 }
});

test('NapCat password login uses existing endpoint, never retains credentials, and sanitizes challenge/rejection replies',async()=>{
 const {NapCatControl}=await import('../../apps/qq-channel/src/napcat-control.mjs');
 for(const [reply,expected]of [[null,{outcome:'submitted'}],[{needCaptcha:true,proofWaterUrl:password},{outcome:'verification_required',verification:'captcha'}],[{needNewDevice:true,jumpUrl:password,newDevicePullQrCodeSig:password},{outcome:'verification_required',verification:'new_device'}]]){
  let submissions=0;const control=new NapCatControl({token:'a'.repeat(64),accessToken:'synthetic-only',fetchImpl:async(url,options)=>{
   let data={};if(url.endsWith('/auth/login'))data={Credential:'synthetic-credential'};
   else if(url.endsWith('/CheckLoginStatus'))data={isLogin:false};
   else {assert(url.endsWith('/QQLogin/PasswordLogin'));const body=JSON.parse(options.body);assert.deepEqual(body,{uin,passwordMd5:crypto.createHash('md5').update(password).digest('hex')});assert(!options.body.includes(password));submissions++;data=reply;}
   return new Response(JSON.stringify({code:0,data}));
  }});
  assert.deepEqual(await control.passwordLogin(uin,password),expected);assert.equal(submissions,1);assert(!JSON.stringify(control).includes(password));assert(!JSON.stringify(control).includes(crypto.createHash('md5').update(password).digest('hex')));
 }
 for(const timeout of [false,true]){
  let calls=0;const control=new NapCatControl({token:'a'.repeat(64),accessToken:'synthetic-only',fetchImpl:async url=>{
   if(url.endsWith('/auth/login'))return new Response(JSON.stringify({code:0,data:{Credential:'test'}}));
   if(url.endsWith('/CheckLoginStatus'))return new Response(JSON.stringify({code:0,data:{isLogin:false}}));
   calls++;if(timeout)throw Error(password);return new Response(JSON.stringify({code:-1,message:password}));
  }});
  await assert.rejects(control.passwordLogin(uin,password),error=>{assert.equal(error.code,timeout?'QQ_ACTION_UNCERTAIN':'QQ_PASSWORD_LOGIN_FAILED');assert(!JSON.stringify(error).includes(password));return true;});assert.equal(calls,1);
 }
});

test('password HTTP route rechecks authorization, clears request bodies and emits no credential logs or error excerpts',async t=>{
 const fastify=require('../../apps/api/node_modules/fastify'),logs=[];let called=0,deny=false;
 const app=fastify({logger:{level:'trace',stream:{write:line=>logs.push(line)}}});t.after(()=>app.close());
 const {registerAgentQQAdminRoutes}=await import('../../apps/api/src/agent-qq-admin-routes.mjs'),{qqAdminError}=await import('../../apps/api/src/qq-admin-protocol.mjs');
 app.addHook('onResponse',async request=>{if(request.body)assert.equal(request.body.password,undefined);});
 registerAgentQQAdminRoutes(app,{requireAuth:async request=>{if(request.headers.authorization!=='owner')throw qqAdminError('QQ_ADMIN_REQUIRED',403);request.actor={userId:actorId};},service:{authorize:async()=>{if(deny)throw qqAdminError('QQ_AGENT_NOT_FOUND',404);},execute:async(_actor,_id,operation,args)=>{assert.equal(operation,'password');assert.equal(args.password,password);called++;return {outcome:'submitted',loginRevision:2};}}});
 const url=`/v1/admin/agents/${agentId}/qq/login/password`,payload={requestId:crypto.randomUUID(),...makeCommand().args};
 let response=await app.inject({method:'POST',url,headers:{authorization:'owner'},payload});assert.equal(response.statusCode,200);assert.equal(called,1);assert.match(response.headers['cache-control'],/no-store/);
 response=await app.inject({method:'POST',url,payload});assert.equal(response.statusCode,403);
 deny=true;response=await app.inject({method:'POST',url,headers:{authorization:'owner'},payload});assert.equal(response.statusCode,404);assert.equal(called,1);deny=false;
 for(const input of [JSON.stringify({...payload,unexpected:password}),`{"password":"${password}","broken":`]){
  response=await app.inject({method:'POST',url,headers:{authorization:'owner','content-type':'application/json'},payload:input});assert.equal(response.statusCode,400);assert(!response.body.includes(password));assert.match(response.headers['cache-control'],/no-store/);
 }
 assert(!logs.join('').includes(password));assert(!logs.join('').includes('passwordMd5'));
});

test('browser API never automatically replays a password after an expired website session',async()=>{
 const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');let calls=0;
 const api=createApiClient({getAccessToken:()=> 'expired',getRefreshToken:()=> 'refresh',fetchImpl:async(url,options)=>{assert(url.endsWith('/qq/login/password'));assert.equal(JSON.parse(options.body).password,password);calls++;return new Response(JSON.stringify({error:{code:'AUTH_REQUIRED'}}),{status:401});}});
 await assert.rejects(api.loginAdminAgentQQPassword(agentId,{requestId:crypto.randomUUID(),...makeCommand().args}));assert.equal(calls,1);
});
