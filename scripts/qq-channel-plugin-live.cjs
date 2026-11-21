// Real isolated QQ channel acceptance, read-only except writing local evidence.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),load=f=>import(pathToFileURL(path.join(root,'apps/api/src',f)).href);
async function main(){
 const file=path.resolve(process.argv[2]??''),op=process.argv[3]??'--status',s=JSON.parse(fs.readFileSync(file,'utf8')),u=new URL(s.databaseUrl);
 if(!s.channelPluginAcceptance||u.hostname!=='127.0.0.1'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(u.pathname)||!['--status','--verify'].includes(op))throw Error('LOCAL_CHANNEL_PLUGIN_TEST_REQUIRED');
 const base=cp.spawnSync(process.execPath,[path.join(root,'scripts/qq-article-images-live.cjs'),file,op==='--verify'?'--verify':'--status'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4000000,timeout:120000});if(base.status!==0)throw Error('CHANNEL_BASE_VERIFICATION_FAILED');const report=JSON.parse(base.stdout);
 const {qqSignature}=await load('qq-admin-protocol.mjs'),at=String(Date.now()),id=crypto.randomUUID(),body=JSON.stringify({operation:'status',actorId:s.operatorId,agentUserId:s.agentId,args:{}});
 const response=await fetch('http://127.0.0.1:'+s.qqControlPort+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':at,'x-qq-request':id,'x-qq-signature':qqSignature(s.sharedSecret,at,id,body)},body,signal:AbortSignal.timeout(15000)}),value=await response.json();
 report.channelPlugins=value.data?.plugins;report.channelRuntime=value.data?.channelRuntime;report.login=value.data?.runtime;
 if(!response.ok||!report.channelPlugins?.some(p=>p.id==='mooyu.qq'&&p.version==='1.0.0'&&p.enabled)||report.channelRuntime?.executionMode!=='agent'||report.channelRuntime?.started!==true)throw Error('REAL_CHANNEL_PLUGIN_NOT_READY');
 const {Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg'),pool=new Pool({connectionString:u.href});u.pathname='/'+s.qqDatabase;const qq=new Pool({connectionString:u.href});
 try{
  const before=JSON.parse(fs.readFileSync(path.join(s.privateRoot,'baseline.private.json'),'utf8'));
  const rows=(await pool.query('SELECT id,parent_id,kind,state,input_json,result_json,origin_json,run_id FROM agent_interactions WHERE NOT(id=ANY($1::uuid[])) ORDER BY created_at',[before.interactions.map(r=>r.id)])).rows;
  const chat=rows.find(r=>r.kind==='message'&&r.state==='completed'&&!rows.some(t=>t.parent_id===r.id)&&r.result_json?.reply?.includes('渠道已连接'));
  report.chat=chat?{id:chat.id,reply:chat.result_json.reply,state:chat.state}:null;
  const questions=rows.filter(r=>r.kind==='github-question');report.sourceTasks=[];
  for(const task of questions){
   const artifacts=(await pool.query('SELECT artifact_key,content_json,source_tool_artifact_ids FROM agent_runtime_stage_artifacts WHERE run_id=$1 ORDER BY created_at',[task.run_id])).rows;
   const calls=(await pool.query('SELECT action.action_key,call.tool_key,call.status,action.request_json FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id WHERE action.run_id=$1 ORDER BY call.created_at',[task.run_id])).rows;
   const parent=rows.find(r=>r.id===task.parent_id);
   const deliveries=(await qq.query('SELECT m.message_id,m.status,m.remote_message_id FROM mooyu_qq.agent_links l JOIN mooyu_qq.agent_deliveries d ON d.channel_id=l.channel_id AND d.source_message_id=l.message_id JOIN mooyu_qq.messages m ON m.channel_id=d.channel_id AND m.message_id=d.message_id WHERE l.task_id=$1',[task.id])).rows;
   report.sourceTasks.push({id:task.id,parentId:task.parent_id,state:task.state,plugin:task.input_json.plugin,repository:task.input_json.repositoryUrl,inputRevision:task.input_json.revision,request:parent?.input_json.message,runId:task.run_id,reply:task.result_json?.reply,revision:task.result_json?.repository?.revision,toolCalls:calls,deliveries,refine:artifacts.find(a=>a.artifact_key==='agent.github.question-refine')?.content_json,extended:artifacts.find(a=>a.artifact_key==='agent.github.question-extended')?.content_json?.sources?.map(({path,fromLine,toLine})=>({path,fromLine,toLine})),extendedToolArtifactIds:artifacts.find(a=>a.artifact_key==='agent.github.question-extended')?.source_tool_artifact_ids});
  }
  if(op==='--verify'){
   if(!chat||!report.sourceTasks.some(t=>t.state==='completed'&&t.plugin?.id==='mooyu.github'&&t.refine?.files?.length&&t.extendedToolArtifactIds?.length&&t.toolCalls.some(c=>c.action_key.startsWith('extend-file-')&&c.status==='succeeded'))||rows.some(r=>r.state!=='completed'))throw Error('REAL_CHANNEL_PLUGIN_FEATURES_INCOMPLETE');
   const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),napcat=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:s.gatewayOrigin});
   const proveText=async(remoteId,reply)=>{const msg=napcat.unwrap(await napcat.post('/Debug/call',{action:'get_msg',params:{message_id:Number(remoteId)}})),text=(msg?.message??[]).filter(p=>p.type==='text').map(p=>p.data?.text??'').join('').replace(/\r\n/gu,'\n');if(String(msg.group_id)!==s.oldStack.groupId||String(msg.user_id)!==s.oldStack.botId||!text.includes(reply.replace(/\r\n/gu,'\n')))throw Error('REAL_CHANNEL_TEXT_DELIVERY_MISMATCH');return {remoteMessageId:remoteId,fullTextPresent:true};};
   const chatMessage=report.newMessages.find(m=>m.messageId===chat.origin_json.eventRef);if(!chatMessage||chatMessage.status!=='delivered')throw Error('REAL_CHAT_DELIVERY_INCOMPLETE');report.chat.remote=await proveText(chatMessage.remoteId,chat.result_json.reply);
   for(const task of report.sourceTasks){if(task.deliveries.length!==1||task.deliveries[0].status!=='delivered')throw Error('REAL_SOURCE_DELIVERY_INCOMPLETE');task.remote=await proveText(task.deliveries[0].remote_message_id,task.reply);}
   report.result='PASSED';fs.writeFileSync(path.join(s.evidence,'channel-plugin-live-acceptance.json'),JSON.stringify(report,null,2));
  }
  fs.writeFileSync(path.join(s.evidence,'channel-plugin-live-status.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await pool.end();await qq.end();}
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'CHANNEL_PLUGIN_LIVE_FAILED'}));process.exitCode=1;});
