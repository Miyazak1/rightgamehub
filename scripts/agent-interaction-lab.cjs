// Local integration lab only. All persistent credentials stay in session.private.json.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),requireApi=createRequire(path.join(root,'apps/api/package.json')),{Pool}=requireApi('pg'),load=f=>import(pathToFileURL(path.join(root,'apps/api/src',f)).href);
let application,execution,pool,timer;
async function main(){
 const file=path.resolve(process.argv[2]??''),s=JSON.parse(fs.readFileSync(file,'utf8'));if(s.schemaVersion!=='agent-interaction-lab-v1'||!s.privateRoot.includes('private-deployments')||!s.databaseUrl.includes('/qa_ledger_test_'))throw Error('ISOLATION_REQUIRED');
 process.env.QA_LEDGER_TEST_ISOLATED='1';process.env.QA_LEDGER_TEST_URL=s.databaseUrl;
 const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});
 if(!s.agentId){
  const cleanups=[];
  await require('../tests/platform/agent-blog-public-pipeline-db.test.cjs').publicPipelineFixture({after:fn=>cleanups.push(fn)},{agentCallLimit:s.providerCallLimit,live:{modelId:s.modelId,apiKey:s.modelKey,masterKey:s.masterKey,githubAuthenticated:true},interactionExercise:async f=>{
   s.agentId=f.agentId;s.operatorId=f.operatorId;
   const policy={schemaVersion:'agent-policy-v1',mode:'compatibility',autoPublish:false,requiresVerifiedEvidence:true,budgets:{agentMonthly:{providerCalls:s.providerCallLimit,inputTokens:1200000,outputTokens:100000,costMicrousd:s.costMicrousdLimit}}},id=crypto.randomUUID();
   await f.pool.query(`INSERT INTO agent_policy_profiles(id,agent_user_id,version,schema_version,policy_json,policy_sha256,created_by_user_id) VALUES($1,$2,2,'agent-policy-v1',$3,$4,$5)`,[id,s.agentId,JSON.stringify(policy),(await load('researcher-qa-protocol/stable-json.mjs')).stableHash(policy),s.operatorId]);
   await f.pool.query('UPDATE agent_policy_profile_assignments SET active_policy_profile_id=$2,updated_by_user_id=$3 WHERE agent_user_id=$1',[s.agentId,id,s.operatorId]);
   const repository=new (await load('agent-interaction-repository.mjs')).PostgresAgentInteractionRepository(f.pool);
   await (await load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository:f.runtimeRepository,agentId:s.agentId});
   await repository.configureParticipant({userId:s.operatorId,profile:{role:'admin'}},s.agentId,{channel:'qq',actorRef:s.oldStack.caller,canInvoke:true,expectedRevision:0});
   const schedule=new (await load('agent-blog-public-schedule.mjs')).PostgresAgentBlogPublicScheduleRepository(f.pool);await schedule.ensureDaily({agentUserId:s.agentId,enabled:false});
   await f.pool.query('CREATE DATABASE '+s.qqDatabase);save();
  }});
  for(const close of cleanups.reverse())await close();
 }
 pool=new Pool({connectionString:s.databaseUrl,max:10});
 const repository=new (await load('agent-interaction-repository.mjs')).PostgresAgentInteractionRepository(pool);
 await (await load('agent-interaction-bootstrap.mjs')).bootstrapAgentInteractions({repository,runtimeRepository:new (await load('agent-runtime-repository.mjs')).PostgresAgentRuntimeRepository(pool),agentId:s.agentId});
 const {qqSignature}=await load('qq-admin-protocol.mjs');
 const readQQPolicy=async()=>{
  const current=JSON.parse(fs.readFileSync(file,'utf8'));if(!current.qqControlPort)throw Object.assign(Error(),{code:'AGENT_INTERACTION_QQ_UNAVAILABLE'});
  const command={operation:'status',actorId:s.operatorId,agentUserId:s.agentId,args:{}},body=JSON.stringify(command),at=String(Date.now()),id=crypto.randomUUID();
  const response=await fetch('http://127.0.0.1:'+current.qqControlPort+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':at,'x-qq-request':id,'x-qq-signature':qqSignature(s.sharedSecret,at,id,body)},body,signal:AbortSignal.timeout(12000)}),value=await response.json();
  if(!response.ok||value.data?.binding?.executionMode!=='agent')throw Object.assign(Error(),{code:'AGENT_INTERACTION_QQ_UNAVAILABLE'});
  return {agentId:s.agentId,botId:value.data.binding.botId,...value.data.settings};
 };
 const service=(await load('agent-interaction-service.mjs')).createAgentInteractionService({repository,agentId:s.agentId,readQQPolicy});
 const env={AGENT_INTERACTIONS_ENABLED:'true',AGENT_INTERACTIONS_AGENT_USER_ID:s.agentId,AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:s.agentId,AGENT_BLOG_PUBLIC_RUNTIME_MODEL_ID:s.modelId,AGENT_BLOG_PUBLIC_RUNTIME_MONTHLY_PROVIDER_CALL_LIMIT:String(s.providerCallLimit),AGENT_BLOG_PUBLIC_RUNTIME_MONTHLY_COST_MICROUSD_LIMIT:String(s.costMicrousdLimit),AGENT_GITHUB_RESEARCH_TOKEN:s.githubToken,AGENT_SECRET_ENCRYPTION_KEY:s.masterKey,PAPER_STUDY_ENABLED:'false',PAPER_STUDY_WORKER_ENABLED:'false',PAPER_STUDY_MODELS_ENABLED:'false',PAPER_STUDY_PUBLISH_ENABLED:'false'};
 const log=value=>{fs.appendFileSync(path.join(s.evidence,'worker.jsonl'),JSON.stringify({at:new Date().toISOString(),...value})+'\n');console.log(JSON.stringify(value));};
 execution=(await load('agent-interaction-runtime.mjs')).createAgentInteractionRuntime({env,pool,service,practiceService:{},platformTools:null,log});
 const {PostgresAgentBlogPublicScheduleRepository,createAgentBlogPublicScheduleController}=await load('agent-blog-public-schedule.mjs'),schedule=new PostgresAgentBlogPublicScheduleRepository(pool),controller=createAgentBlogPublicScheduleController({repository:schedule,preflightRepository:execution.runtime.interactionPorts.preflightRepository,runtimeConfig:execution.runtime.config,runner:execution.runtime.runner});
 const cycle=()=>requireAsyncCycle();let cycling=false;async function requireAsyncCycle(){if(cycling)return;cycling=true;try{await (await load('agent-blog-public-schedule-cycle.mjs')).runAgentBlogPublicScheduleCycle({controller,agentUserId:s.agentId,instanceId:instance});}catch(e){log({event:'lab-schedule-error',code:e.code??'LAB_SCHEDULER_ERROR'});}finally{cycling=false;}}const instance=crypto.randomUUID();await cycle();timer=setInterval(cycle,10000);
 application=requireApi('fastify')({logger:false});
 const auth=async req=>{if(req.headers.authorization!=='Bearer '+s.browserToken&&!String(req.headers.cookie??'').split('; ').includes('mooyu_lab='+s.browserToken))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',statusCode:401});req.actor={userId:s.operatorId,profile:{role:'admin'}};};
 application.setErrorHandler((e,_r,reply)=>reply.code(e.statusCode??503).send({error:{code:e.code??'LAB_UNAVAILABLE',message:'本地验收请求未完成。'}}));
 (await load('platform-assistant.mjs')).registerPlatformAssistantRoutes(application,{service:(await load('agent-interaction-routes.mjs')).createAgentWebAssistantAdapter(service),requireAuth:auth});
 (await load('agent-interaction-routes.mjs')).registerAgentInteractionRoutes(application,{service,requireAuth:auth,channelSecret:s.sharedSecret});
 application.get('/lab/status',{preHandler:auth},async()=>({data:{agentId:s.agentId,interactions:(await pool.query('SELECT id,kind,channel,state,error_code,run_id FROM agent_interactions ORDER BY created_at')).rows,budget:(await pool.query('SELECT sum(charged_provider_calls)::int AS calls,sum(charged_cost_microusd)::bigint AS cost FROM agent_budget_reservations')).rows[0],paperEnabled:false}}));
 let gatewayClient,gatewayClientOrigin;
 const napcat=async()=>{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(!gatewayClient||gatewayClientOrigin!==current.gatewayOrigin){gatewayClientOrigin=current.gatewayOrigin;gatewayClient=new (await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href)).NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:gatewayClientOrigin});}return gatewayClient;};
 application.get('/lab/qq/login-status',{preHandler:auth},async()=>{const v=await (await napcat()).post('/QQLogin/CheckLoginStatus');return {data:{loggedIn:v.isLogin===true,ready:v.coreReady===true,phase:v.loginPhase}};});
 application.post('/lab/qq/qrcode',{preHandler:auth},async()=>{const n=await napcat();await n.refresh();return {data:await n.qr()};});
 application.post('/lab/stop',{preHandler:auth},async()=>{setTimeout(()=>execution.worker.stop(),100);return {data:{stopping:true}};});
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{PlatformAssistantProvider,AssistantWorkspace,AssistantToggle}from'./packages/platform-client/src/PlatformAssistant.jsx';import{I18nProvider}from'./packages/platform-client/src/I18n.jsx';import{createPracticeApiClient}from'./packages/platform-api-client/src/practice.mjs';const api=createPracticeApiClient();createRoot(document.getElementById('root')).render(<I18nProvider initialLocale='zh-CN'><PlatformAssistantProvider api={api} owner='${s.operatorId}' capabilities={{host:'browser'}} route='/'><AssistantWorkspace><h1>小墨鱼独立联合验收</h1><p>仅测试群 ${s.oldStack.groupId}，论文关闭。写作只保存本地草稿。</p><AssistantToggle/></AssistantWorkspace></PlatformAssistantProvider></I18nProvider>);`;
 const js=(await require('../tests/browser-build.cjs').build({stdin:{contents:entry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'})).outputFiles[0].text;
 const css=await fsp.readFile(path.join(root,'packages/platform-client/src/styles.css'),'utf8');application.get('/fixture.js',async(_r,r)=>r.type('text/javascript').send(js));
 const qrEntry=`import React from 'react';import{createRoot}from'react-dom/client';import Login from './scripts/agent-interaction-lab-login.jsx';createRoot(document.getElementById('root')).render(<Login botId='${s.oldStack.botId}'/>);`;
 const qrJs=(await require('../tests/browser-build.cjs').build({stdin:{contents:qrEntry,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'})).outputFiles[0].text;
 application.get('/qq-login.js',async(_r,r)=>r.type('text/javascript').send(qrJs));application.get('/qq-login',async(_r,r)=>r.header('set-cookie','mooyu_lab='+s.browserToken+'; HttpOnly; SameSite=Strict; Path=/').type('text/html').send('<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script src="/qq-login.js"></script></html>'));
 application.get('/',async(_r,r)=>r.header('set-cookie','mooyu_lab='+s.browserToken+'; HttpOnly; SameSite=Strict; Path=/').type('text/html').send('<html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body class="app"><div id="root"></div><script src="/fixture.js"></script></body></html>'));
 await application.listen({host:'127.0.0.1',port:s.apiPort??0});s.apiPort=application.server.address().port;s.serverPid=process.pid;save();
 fs.writeFileSync(path.join(s.evidence,'ready.json'),JSON.stringify({id:s.id,agentId:s.agentId,url:'http://127.0.0.1:'+s.apiPort,providerCallLimit:s.providerCallLimit,paperEnabled:false,productionConnected:false},null,2));
 log({event:'lab-ready',url:'http://127.0.0.1:'+s.apiPort,paperEnabled:false});
 process.once('SIGINT',()=>execution.worker.stop());process.once('SIGTERM',()=>execution.worker.stop());await execution.worker.run();
}
main().catch(e=>{console.error(JSON.stringify({event:'lab-failed',code:e.code??'LAB_FAILED',message:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:undefined}));process.exitCode=1;}).finally(async()=>{clearInterval(timer);await execution?.close();await application?.close();await pool?.end();});
