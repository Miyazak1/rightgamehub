const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),file=path.resolve(process.argv[2]??''),operation=process.argv[3],s=JSON.parse(fs.readFileSync(file,'utf8'));
if(s.schemaVersion!=='agent-interaction-lab-v1')throw Error('ISOLATION_REQUIRED');
function docker(args){const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1000000});if(r.status!==0)throw Error('LAB_DOCKER_FAILED');return r.stdout.trim();}
async function main(){
 if(operation==='--reserve-recheck-budget'){
  const location=new URL(s.databaseUrl);if(location.hostname!=='127.0.0.1'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(location.pathname)||location.username!=='qa_ledger_test')throw Error('ISOLATED_DATABASE_REQUIRED');
  const {Pool}=require('node:module').createRequire(path.join(root,'apps/api/package.json'))('pg'),pool=new Pool({connectionString:s.databaseUrl}),client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.id+':lab-budget']);
   const current=(await client.query(`SELECT profile.version,profile.policy_json FROM agent_accounts account JOIN agent_policy_profile_assignments assignment ON assignment.agent_user_id=account.user_id JOIN agent_policy_profiles profile ON profile.id=assignment.active_policy_profile_id WHERE account.user_id=$1 AND account.operator_user_id=$2 FOR UPDATE OF assignment`,[s.agentId,s.operatorId])).rows[0];if(!current||s.providerCallLimit!==20)throw Error('LAB_BUDGET_IDENTITY_REQUIRED');
   const before=current.policy_json.budgets.agentMonthly,after={...before,costMicrousd:2000000};if(before.providerCalls!==20||before.costMicrousd>after.costMicrousd)throw Error('LAB_BUDGET_LIMIT_MISMATCH');
   if(before.costMicrousd!==after.costMicrousd){const policy={...current.policy_json,budgets:{...current.policy_json.budgets,agentMonthly:after}},id=crypto.randomUUID(),{stableHash}=await import(pathToFileURL(path.join(root,'apps/api/src/researcher-qa-protocol/stable-json.mjs')).href);
    await client.query(`INSERT INTO agent_policy_profiles(id,agent_user_id,version,schema_version,policy_json,policy_sha256,created_by_user_id) VALUES($1,$2,$3,'agent-policy-v1',$4,$5,$6)`,[id,s.agentId,current.version+1,JSON.stringify(policy),stableHash(policy),s.operatorId]);await client.query('UPDATE agent_policy_profile_assignments SET active_policy_profile_id=$2,updated_by_user_id=$3 WHERE agent_user_id=$1',[s.agentId,id,s.operatorId]);}
   const used=(await client.query('SELECT sum(charged_provider_calls)::int AS calls,sum(charged_cost_microusd)::bigint AS reserved_cost FROM agent_budget_reservations WHERE agent_user_id=$1',[s.agentId])).rows[0];await client.query('COMMIT');s.costMicrousdLimit=after.costMicrousd;fs.writeFileSync(file,JSON.stringify(s,null,2));
   const report={at:new Date().toISOString(),reason:'one-bounded-live-composition-recheck',before,after,used,countersReset:false,productionConnected:false};fs.writeFileSync(path.join(s.evidence,'budget-recheck.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();await pool.end();}return;
 }
 if(operation==='--result-delivery'){
  if(!['hold','release'].includes(process.argv[4]))throw Error('DELIVERY_GATE_ACTION_REQUIRED');
  const marker=path.join(s.privateRoot,'activation/hold-task-delivery');if(process.argv[4]==='hold')fs.writeFileSync(marker,'explicit-local-restart-acceptance');else try{fs.unlinkSync(marker);}catch(e){if(e.code!=='ENOENT')throw e;}
  console.log(JSON.stringify({taskDeliveryHeld:fs.existsSync(marker),agentExecutionPaused:false}));return;
 }
 if(operation==='--route-status'){
  const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),n=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:s.gatewayOrigin}),v=await n.post('/OB11Config/GetConfig');
  console.log(JSON.stringify({networkKeys:Object.keys(v.network??{}),clients:(v.network?.websocketClients??[]).map(c=>({name:c.name,url:c.url,enable:c.enable,messagePostFormat:c.messagePostFormat,reportSelfMessage:c.reportSelfMessage,otherFields:Object.keys(c).filter(k=>!['token','secret','access_token'].includes(k))})),globalKeys:Object.keys(v)}));return;
 }
 if(operation==='--recent-message-shapes'){
  const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),n=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:s.gatewayOrigin});
  const data=n.unwrap(await n.post('/Debug/call',{action:'get_group_msg_history',params:{group_id:Number(s.oldStack.groupId),count:12}}));
  const messages=(data?.messages??[]).filter(m=>String(m.user_id)===s.oldStack.caller).slice(-3).map(m=>({messageId:m.message_id,time:m.time,messageType:m.message_type,segments:Array.isArray(m.message)?m.message.map(p=>p.type):typeof m.message,mentionsExpectedBot:Array.isArray(m.message)&&m.message.some(p=>p.type==='at'&&String(p.data?.qq)===s.oldStack.botId),textBytes:Array.isArray(m.message)?Buffer.byteLength(m.message.filter(p=>p.type==='text').map(p=>p.data.text).join('')):null}));console.log(JSON.stringify({expectedCallerMessages:messages}));return;
 }
 if(operation==='--qq-status'){
  const health=await (await fetch('http://127.0.0.1:'+s.qqHealthPort+'/health',{signal:AbortSignal.timeout(5000)})).json(),{qqSignature}=await import(pathToFileURL(path.join(root,'apps/api/src/qq-admin-protocol.mjs')).href),body=JSON.stringify({operation:'status',actorId:s.operatorId,agentUserId:s.agentId,args:{}}),at=String(Date.now()),id=crypto.randomUUID();
  const response=await fetch('http://127.0.0.1:'+s.qqControlPort+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':at,'x-qq-request':id,'x-qq-signature':qqSignature(s.sharedSecret,at,id,body)},body,signal:AbortSignal.timeout(12000)}),value=await response.json();
  console.log(JSON.stringify({connected:health.connected,httpStatus:response.status,runtime:value.data?.runtime,binding:value.data?.binding,states:value.data?.status?.states,review:value.data?.status?.review,ingress:value.data?.ingress,code:value.error?.code,paperEnabled:value.data?.paperEnabled}));return;
 }
 if(operation==='--recover-test-gateway'){
  const state=await (await fetch('http://127.0.0.1:'+s.apiPort+'/lab/qq/login-status',{headers:{authorization:'Bearer '+s.browserToken}})).json();if(state.data?.loggedIn!==false||state.data?.ready!==false)throw Error('OFFLINE_GATEWAY_REQUIRED');
  const inspect=name=>JSON.parse(docker(['inspect',name]))[0],before=inspect(s.oldStack.gateway),worker=inspect(s.oldStack.worker),db=inspect(s.oldStack.db);
  if(before.Config.Labels['mooyu.qq-login-lab']!==s.oldStack.id||worker.Config.Labels['mooyu.qq-compat']!==s.oldStack.id||db.Config.Labels['mooyu.qq-compat']!==s.oldStack.id)throw Error('INDEPENDENT_GATEWAY_IDENTITY_REQUIRED');
  const history=()=>docker(['exec',s.oldStack.db,'psql','-U','mooyu_qq','-d','mooyu_qq_local_compat','-At','-c',"SELECT json_build_object('pending',count(*) FILTER(WHERE status IN ('queued','generating','ready','sending')),'delivered',count(*) FILTER(WHERE status='delivered')) FROM mooyu_qq.messages"]),oldHistory=history();if(JSON.parse(oldHistory).pending!==0)throw Error('ORIGINAL_WORKER_BUSY');
  const stamp=new Date().toISOString().replace(/[^0-9]/g,''),snapshot=path.join(s.privateRoot,'gateway-recovery-'+stamp+'.private.json');fs.writeFileSync(snapshot,JSON.stringify(before,null,2),{flag:'wx',mode:0o600});
  docker(['restart','--timeout','30',s.oldStack.gateway]);
  const after=inspect(s.oldStack.gateway),binding=after.NetworkSettings.Ports['6099/tcp']?.[0];if(binding?.HostIp!=='127.0.0.1')throw Error('GATEWAY_PORT_MUST_REMAIN_LOCAL');
  const sameMounts=JSON.stringify(before.Mounts)===JSON.stringify(after.Mounts),sameImage=before.Image===after.Image,workerRetained=inspect(s.oldStack.worker).State.StartedAt===worker.State.StartedAt,dbRetained=inspect(s.oldStack.db).State.StartedAt===db.State.StartedAt,historyRetained=history()===oldHistory;
  s.gatewayOrigin='http://127.0.0.1:'+binding.HostPort;fs.writeFileSync(file,JSON.stringify(s,null,2));
  const report={at:new Date().toISOString(),gateway:s.oldStack.gateway,reason:'QR_REFRESH_REQUIRES_LOGIN_SERVICE_RESTART',sameMounts,sameImage,workerRetained,dbRetained,historyRetained,localPort:Number(binding.HostPort),paperEnabled:false};fs.writeFileSync(path.join(s.evidence,'gateway-recovery-'+stamp+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(![sameMounts,sameImage,workerRetained,dbRetained,historyRetained].every(Boolean))throw Error('PRESERVATION_CHECK_FAILED');return;
 }
 if(['--restart-qq-waiting','--restart-qq-transport'].includes(operation)){
  if(!s.qqWorker||(operation==='--restart-qq-waiting'&&fs.existsSync(path.join(s.privateRoot,'activation/ready'))))throw Error('LAB_WAITING_WORKER_REQUIRED');
  const info=JSON.parse(docker(['inspect',s.qqWorker]))[0];if(info.Config.Labels['mooyu.agent-lab']!==s.id)throw Error('LAB_WORKER_IDENTITY_MISMATCH');
  const pending=docker(['exec',s.name+'-db','psql','-U','qa_ledger_test','-d',s.qqDatabase,'-At','-c',"SELECT count(*) FROM mooyu_qq.messages WHERE status IN ('queued','generating','ready','sending')"]);if(pending!=='0')throw Error('LAB_WORKER_BUSY');
  docker(['restart','--timeout','5',s.qqWorker]);
  s.qqControlPort=Number(docker(['port',s.qqWorker,'6780/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);s.qqHealthPort=Number(docker(['port',s.qqWorker,'6700/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);fs.writeFileSync(file,JSON.stringify(s,null,2));
  console.log(JSON.stringify({restarted:s.qqWorker,pending:0,gatewayRestarted:false}));return;
 }
 if(operation==='--permission'){
  if(!['allow','deny'].includes(process.argv[4]))throw Error('PERMISSION_ACTION_REQUIRED');
  const url='http://127.0.0.1:'+s.apiPort+'/v1/admin/agents/'+s.agentId+'/channel-participants',headers={authorization:'Bearer '+s.browserToken,'content-type':'application/json'},prior=await (await fetch(url,{headers})).json(),entry=prior.data?.find(v=>v.channel==='qq'&&v.actor_ref===s.oldStack.caller);
  const response=await fetch(url,{method:'PUT',headers,body:JSON.stringify({channel:'qq',actorRef:s.oldStack.caller,canInvoke:process.argv[4]==='allow',expectedRevision:entry?.revision??0})}),result=await response.json();if(!response.ok)throw Error(result.error?.code??'LAB_PERMISSION_FAILED');console.log(JSON.stringify(result));return;
 }
 if(operation==='--stop-core'){const r=await fetch('http://127.0.0.1:'+s.apiPort+'/lab/stop',{method:'POST',headers:{authorization:'Bearer '+s.browserToken}});console.log(JSON.stringify(await r.json()));return;}
 if(operation==='--search-response'){
  const {githubRequestHeaders}=await import(pathToFileURL(path.join(root,'apps/api/src/agent-github-research-runtime.mjs')).href);
  const query=process.argv[4]??'css selector generator',url='https://api.github.com/search/repositories?'+new URLSearchParams({q:query+' archived:false fork:false stars:>=10',sort:'stars',order:'desc',per_page:'20'}),r=await fetch(url,{headers:githubRequestHeaders({accept:'application/vnd.github+json',userAgent:'Mooyu-Local-Acceptance/1.0',token:s.githubToken}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const reader=r.body.getReader(),chunks=[];let bytes=0,capped=false;while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1048576){capped=true;await reader.cancel();break;}chunks.push(Buffer.from(value));}
  let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
  const report={at:new Date().toISOString(),query,status:r.status,declaredBytes:r.headers.get('content-length'),decodedBytes:bytes,capped,jsonValid:!!json,items:Array.isArray(json?.items)?json.items.length:null,keys:json?Object.keys(json):[],originalAdapterLimit:262144};fs.writeFileSync(path.join(s.evidence,'search-response-diagnostic-'+crypto.createHash('sha256').update(query).digest('hex').slice(0,8)+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return;
 }
 if(operation==='--proxy-test'){
  const name=s.name+'-proxy',prior=cp.spawnSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true});
  if(prior.status!==0){const proxy="require('node:net').createServer(a=>{const b=require('node:net').connect("+s.apiPort+",'host.docker.internal');a.on('error',()=>b.destroy());b.on('error',()=>a.destroy());a.pipe(b).pipe(a);}).listen(3090,'0.0.0.0')";
   docker(['run','-d','--name',name,'--label','mooyu.agent-lab='+s.id,'--network',s.network,'--network-alias','api','--read-only','--cap-drop','ALL','--memory','96m','mooyu-qq-admin-worker:20261119','node','-e',proxy]);}
  const status=docker(['exec',name,'node','-e',"fetch('http://127.0.0.1:3090/v1/internal/agent/qq',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))"]);console.log(JSON.stringify({reachable:status==='401',status}));return;
 }
 if(operation==='--gateway-status'){
  const info=JSON.parse(docker(['inspect',s.oldStack.gateway]))[0],binding=info.NetworkSettings.Ports['6099/tcp']?.[0],env=Object.fromEntries(info.Config.Env.map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
  const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),n=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:'http://127.0.0.1:'+binding.HostPort});
  let status;try{const v=await n.post('/QQLogin/CheckLoginStatus');status={isLogin:v.isLogin,coreReady:v.coreReady,isOffline:v.isOffline,loginPhase:v.loginPhase};}catch(e){status={code:e.code};}
  console.log(JSON.stringify({running:info.State.Running,localPort:binding.HostPort,storedTokenMatchesEnvironment:env.QQ_WEBUI_TOKEN===s.gatewayToken,status,inspect:await n.inspect({botId:s.oldStack.botId,groupId:s.oldStack.groupId})}));return;
 }
 if(operation==='--status'){const r=await fetch('http://127.0.0.1:'+s.apiPort+'/lab/status',{headers:{authorization:'Bearer '+s.browserToken}});console.log(JSON.stringify(await r.json()));return;}
 if(operation==='--native'){
  const requestId=crypto.randomUUID(),conversationId=s.nativeConversationId??crypto.randomUUID();s.nativeConversationId=conversationId;fs.writeFileSync(file,JSON.stringify(s,null,2));
  const response=await fetch('http://127.0.0.1:'+s.apiPort+'/v1/me/assistant/messages',{method:'POST',headers:{authorization:'Bearer '+s.browserToken,'content-type':'application/json'},body:JSON.stringify({requestId,conversationId,message:process.argv[4]})});const value=await response.json();if(!response.ok)throw Error(value.error?.code??'NATIVE_SUBMIT_FAILED');fs.appendFileSync(path.join(s.evidence,'native-requests.jsonl'),JSON.stringify({requestId,conversationId,message:process.argv[4],response:value})+'\n');console.log(JSON.stringify(value));return;
 }
 if(['--wire-qq','--prepare-qq'].includes(operation)){
  if(!s.agentId||!s.apiPort)throw Error('LAB_API_REQUIRED');
  const gatewayInfo=JSON.parse(docker(['inspect',s.oldStack.gateway]))[0],binding=gatewayInfo.NetworkSettings.Ports['6099/tcp']?.[0];if(binding?.HostIp!=='127.0.0.1')throw Error('TEST_GATEWAY_MUST_BE_LOCAL');s.gatewayOrigin='http://127.0.0.1:'+binding.HostPort;fs.writeFileSync(file,JSON.stringify(s,null,2));
  const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),napcat=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:s.gatewayOrigin});
  const health=await napcat.inspect({botId:s.oldStack.botId,groupId:s.oldStack.groupId});if(operation==='--wire-qq'&&(!health.accountMatches||!health.groupReady))throw Error('TEST_QQ_NOT_READY');
  const activation=path.join(s.privateRoot,'activation');fs.mkdirSync(activation,{recursive:true});
  const snapshot=path.join(s.privateRoot,'gateway-before.private.json');if(!fs.existsSync(snapshot)&&health.accountMatches&&health.groupReady)fs.writeFileSync(snapshot,JSON.stringify(await napcat.post('/OB11Config/GetConfig'),null,2),{flag:'wx',mode:0o600});
  if(s.qqWorker){
   s.qqControlPort=Number(docker(['port',s.qqWorker,'6780/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);s.qqHealthPort=Number(docker(['port',s.qqWorker,'6700/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);fs.writeFileSync(file,JSON.stringify(s,null,2));
   if(operation==='--wire-qq'){if(!fs.existsSync(snapshot))throw Error('GATEWAY_SNAPSHOT_REQUIRED');fs.writeFileSync(path.join(activation,'ready'),'ready');}console.log(JSON.stringify({prepared:true,active:fs.existsSync(path.join(activation,'ready')),qqWorker:s.qqWorker,qqHealthPort:s.qqHealthPort}));return;}
  const dbUrl=new URL(s.databaseUrl);dbUrl.hostname='qq-postgres';dbUrl.port='5432';dbUrl.pathname='/'+s.qqDatabase;
  const workerSettings={lab:true,agentId:s.agentId,secret:s.sharedSecret,gatewayToken:s.gatewayToken,config:{deployment:'server',enabled:true,botId:s.oldStack.botId,groupId:s.oldStack.groupId,allowedUsers:[s.oldStack.caller],dailyCalls:20,dailyTokens:500000,userDailyCalls:20,userMinuteMessages:3,groupMinuteMessages:5,maxReplyTokens:1200,maxAttempts:1},env:{QQ_DATABASE_URL:dbUrl.href,QQ_ACCESS_TOKEN:s.accessToken,PAPER_STUDY_ENABLED:'false',PAPER_STUDY_WORKER_ENABLED:'false',PAPER_STUDY_MODELS_ENABLED:'false',PAPER_STUDY_PUBLISH_ENABLED:'false'}};
  fs.writeFileSync(path.join(s.privateRoot,'worker.private.json'),JSON.stringify(workerSettings,null,2),{mode:0o600});
  const proxy="require('node:net').createServer(a=>{const b=require('node:net').connect("+s.apiPort+",'host.docker.internal');a.on('error',()=>b.destroy());b.on('error',()=>a.destroy());a.pipe(b).pipe(a);}).listen(3090,'0.0.0.0')";
  const priorProxy=cp.spawnSync('docker',['inspect',s.name+'-proxy'],{encoding:'utf8',windowsHide:true});
  if(priorProxy.status!==0)docker(['run','-d','--name',s.name+'-proxy','--label','mooyu.agent-lab='+s.id,'--network',s.network,'--network-alias','api','--read-only','--cap-drop','ALL','--memory','96m','mooyu-qq-admin-worker:20261119','node','-e',proxy]);
  const reachable=docker(['exec',s.name+'-proxy','node','-e',"fetch('http://127.0.0.1:3090/v1/internal/agent/qq',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>console.log(r.status)).catch(()=>process.exit(2))"]);if(reachable!=='401')throw Error('LAB_PROXY_NOT_READY');
  docker(['network','connect','--alias','napcat',s.network,s.oldStack.gateway]);
  const worker=s.name+'-qq';
  docker(['run','-d','--name',worker,'--label','mooyu.agent-lab='+s.id,'--network',s.network,'--network-alias','interaction-worker','--publish','127.0.0.1::6780','--publish','127.0.0.1::6700','--read-only','--init','--cap-drop','ALL','--memory','384m','--mount',`type=bind,source=${path.join(root,'apps/qq-channel/src')},target=/app/apps/qq-channel/src,readonly`,'--mount',`type=bind,source=${path.join(root,'apps/api/src')},target=/app/apps/api/src,readonly`,'--mount',`type=bind,source=${path.join(root,'scripts/agent-interaction-lab-worker.mjs')},target=/app/scripts/agent-interaction-lab-worker.mjs,readonly`,'--mount',`type=bind,source=${path.join(s.privateRoot,'worker.private.json')},target=/config/worker.private.json,readonly`,'--mount',`type=bind,source=${activation},target=/config/activation,readonly`,'mooyu-qq-admin-worker:20261119','node','scripts/agent-interaction-lab-worker.mjs']);
  s.qqWorker=worker;s.qqControlPort=Number(docker(['port',worker,'6780/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);s.qqHealthPort=Number(docker(['port',worker,'6700/tcp']).match(/127\.0\.0\.1:(\d+)/)[1]);fs.writeFileSync(file,JSON.stringify(s,null,2));
  if(operation==='--wire-qq')fs.writeFileSync(path.join(activation,'ready'),'ready');
  console.log(JSON.stringify({prepared:true,active:fs.existsSync(path.join(activation,'ready')),qqWorker:worker,qqControlPort:s.qqControlPort,qqHealthPort:s.qqHealthPort,originalWorkerRetained:true,paperEnabled:false}));return;
 }
 throw Error('UNKNOWN_LAB_OPERATION');
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'LAB_CONTROL_FAILED'}));process.exitCode=1;});
