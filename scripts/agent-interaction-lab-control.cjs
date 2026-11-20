const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),file=path.resolve(process.argv[2]??''),operation=process.argv[3],s=JSON.parse(fs.readFileSync(file,'utf8'));
if(s.schemaVersion!=='agent-interaction-lab-v1')throw Error('ISOLATION_REQUIRED');
function docker(args){const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1000000});if(r.status!==0)throw Error('LAB_DOCKER_FAILED');return r.stdout.trim();}
async function main(){
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
  if(s.qqWorker){if(operation==='--wire-qq'){if(!fs.existsSync(snapshot))throw Error('GATEWAY_SNAPSHOT_REQUIRED');fs.writeFileSync(path.join(activation,'ready'),'ready');}console.log(JSON.stringify({prepared:true,active:fs.existsSync(path.join(activation,'ready')),qqWorker:s.qqWorker}));return;}
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
