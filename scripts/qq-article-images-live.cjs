// Local-only live acceptance. Persistent credentials and database dumps remain private.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),{Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg'),load=f=>import(pathToFileURL(path.join(root,'apps/api/src',f)).href);
function docker(args,options={}){const r=cp.spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4000000,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0].toUpperCase()+'_FAILED');return r.stdout?.trim();}
const inspect=name=>JSON.parse(docker(['inspect',name]))[0],plain=v=>JSON.parse(JSON.stringify(v));
async function main(){
 const file=path.resolve(process.argv[2]??''),op=process.argv[3],s=JSON.parse(fs.readFileSync(file,'utf8')),u=new URL(s.databaseUrl);
 if(!s.pluginAcceptance||u.hostname!=='127.0.0.1'||u.username!=='qa_ledger_test'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(u.pathname))throw Error('LOCAL_TEST_REQUIRED');
 const pool=new Pool({connectionString:u.href});u.pathname='/'+s.qqDatabase;const qq=new Pool({connectionString:u.href});
 const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs'),hash=v=>stableHash(plain(v));
 try{
  const interactions=(await pool.query('SELECT id,parent_id,kind,state,input_json,result_json,input_sha256,origin_json,run_id FROM agent_interactions ORDER BY id')).rows;
  const messages=(await qq.query('SELECT * FROM mooyu_qq.messages ORDER BY channel_id,message_id')).rows;
  const schedules=(await pool.query("SELECT id,workflow_key,workflow_version,enabled,timezone,schedule_spec_json,next_fire_at,last_fire_at,config_json-'worker' AS config FROM agent_schedules WHERE agent_user_id=$1 ORDER BY id",[s.agentId])).rows;
  const settings=(await pool.query('SELECT * FROM agent_blog_automation_settings WHERE agent_user_id=$1',[s.agentId])).rows;
  const participants=(await pool.query('SELECT * FROM agent_channel_participants WHERE agent_user_id=$1 ORDER BY channel,actor_ref',[s.agentId])).rows;
  const articles=(await pool.query('SELECT id,working_revision_id,published_revision_id,publication_state FROM blog_articles WHERE author_user_id=$1 ORDER BY id',[s.agentId])).rows;
  const calls=Number((await pool.query('SELECT sum(charged_provider_calls) AS n FROM agent_budget_reservations WHERE agent_user_id=$1',[s.agentId])).rows[0].n);
  const paperRuns=(await pool.query("SELECT count(*)::int AS n FROM agent_runs WHERE agent_user_id=$1 AND workflow_key LIKE 'paper.%'",[s.agentId])).rows[0].n;
  if(op==='--prepare'){
   if(interactions.some(r=>['queued','running','waiting'].includes(r.state))||messages.some(r=>!['delivered','failed','needs-review'].includes(r.status)))throw Error('LOCAL_TEST_BUSY');
   const stamp=new Date().toISOString().replace(/[^0-9]/g,''),privateRoot=path.resolve(root,'../../private-deployments/qq-article-images',stamp),evidence=path.join('E:\\CodexData\\build\\Right\\agent-plugin-github\\article-images\\live',stamp);
   fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});fs.mkdirSync(evidence,{recursive:true});
   const containers=[s.name+'-db',s.oldStack.gateway,s.qqWorker,s.oldStack.worker,s.oldStack.db].map(inspect);
   if(containers[0].Config.Labels['mooyu.agent-lab']!==s.id||containers[2].Config.Labels['mooyu.agent-lab']!==s.id)throw Error('LOCAL_IDENTITY_REQUIRED');
   const backups=[];
   for(const database of [new URL(s.databaseUrl).pathname.slice(1),s.qqDatabase]){
    const target=path.join(privateRoot,database+'.dump'),fd=fs.openSync(target,'wx',0o600);try{docker(['exec',s.name+'-db','pg_dump','-U','qa_ledger_test','-d',database,'-Fc'],{encoding:null,stdio:['ignore',fd,'pipe']});}finally{fs.closeSync(fd);}
    const bytes=fs.readFileSync(target),list=cp.spawnSync('docker',['exec','-i',s.name+'-db','pg_restore','--list'],{input:bytes,encoding:'utf8',windowsHide:true,maxBuffer:4000000});if(list.status!==0||!list.stdout.includes('TABLE'))throw Error('BACKUP_INVALID');backups.push({database,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
   }
   fs.writeFileSync(path.join(privateRoot,'baseline.private.json'),JSON.stringify({at:new Date().toISOString(),interactions,messages,schedules,settings,participants,articles,calls,paperRuns,containers}),{flag:'wx',mode:0o600});
   const next={...s,privateRoot,evidence,originalSession:file,originalQQWorker:s.qqWorker,imageAcceptance:true,runtimeCommit:cp.spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim()};
   const target=path.join(privateRoot,'session.private.json');fs.writeFileSync(target,JSON.stringify(next,null,2),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(evidence,'backup-verification.json'),JSON.stringify(backups,null,2));console.log(JSON.stringify({session:target,evidence,interactions:interactions.length,messages:messages.length,calls,backupsVerified:true,paperEnabled:false}));return;
  }
  if(!s.imageAcceptance)throw Error('IMAGE_ACCEPTANCE_SESSION_REQUIRED');
  const before=JSON.parse(fs.readFileSync(path.join(s.privateRoot,'baseline.private.json'),'utf8'));
  if(op==='--refresh-worker'){
   const name=s.originalQQWorker+'-images-'+path.basename(s.privateRoot).slice(-6),info=inspect(name);
   if(info.Config.Labels['mooyu.agent-lab']!==s.id||info.Config.Labels['mooyu.acceptance']!=='article-images')throw Error('LOCAL_WORKER_IDENTITY_REQUIRED');
   const port=key=>{const p=info.NetworkSettings.Ports[key]?.[0];if(p?.HostIp!=='127.0.0.1')throw Error('LOCAL_PORT_REQUIRED');return Number(p.HostPort);};
   s.qqWorker=name;s.qqControlPort=port('6780/tcp');s.qqHealthPort=port('6700/tcp');fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});console.log(JSON.stringify({worker:name,metadataRefreshed:true}));return;
  }
  if(op==='--startup-status'){
   const {PostgresAgentBlogPublicRequestRepository}=await load('agent-blog-public-request-repository.mjs');
   const pending=await new PostgresAgentBlogPublicRequestRepository(pool).pending(s.agentId);
   console.log(JSON.stringify({pending:pending?{requestId:pending.request_id,status:pending.status,triggerKind:pending.trigger_kind}:null,runs:(await pool.query("SELECT id,workflow_key,status FROM agent_runs WHERE status IN ('queued','running','waiting','uncertain')")).rows,calls}));return;
  }
  if(op==='--switch-worker'){
   if(s.qqWorker!==s.originalQQWorker)throw Error('IMAGE_WORKER_ALREADY_SELECTED');
   if(interactions.some(r=>['queued','running','waiting'].includes(r.state))||messages.some(r=>!['delivered','failed','needs-review'].includes(r.status)))throw Error('LOCAL_TEST_BUSY');
   const original=inspect(s.originalQQWorker);if(original.Config.Labels['mooyu.agent-lab']!==s.id)throw Error('LOCAL_WORKER_REQUIRED');
   const name=s.originalQQWorker+'-images-'+path.basename(s.privateRoot).slice(-6),args=['run','-d','--name',name,'--label','mooyu.agent-lab='+s.id,'--label','mooyu.acceptance=article-images','--network',s.network,'--network-alias','interaction-worker','--publish','127.0.0.1::6780','--publish','127.0.0.1::6700','--read-only','--init','--cap-drop','ALL','--memory','384m'];
   for(const m of original.Mounts){let source=m.Source;if(m.Destination==='/app/apps/qq-channel/src')source=path.join(root,'apps/qq-channel/src');if(m.Destination==='/app/apps/api/src')source=path.join(root,'apps/api/src');if(m.Destination==='/app/scripts/agent-interaction-lab-worker.mjs')source=path.join(root,'scripts/agent-interaction-lab-worker.mjs');if(m.Type!=='bind')throw Error('LOCAL_WORKER_BIND_REQUIRED');args.push('--mount',`type=bind,source=${source},target=${m.Destination}${m.RW?'':',readonly'}`);}
   docker(['stop','--time','10',s.originalQQWorker]);
   try{docker([...args,original.Image,...original.Config.Cmd]);}catch(e){docker(['start',s.originalQQWorker]);throw e;}
   const now=inspect(name),port=key=>{const p=now.NetworkSettings.Ports[key]?.[0];if(p?.HostIp!=='127.0.0.1')throw Error('LOCAL_PORT_REQUIRED');return Number(p.HostPort);};
   s.qqWorker=name;s.qqControlPort=port('6780/tcp');s.qqHealthPort=port('6700/tcp');fs.writeFileSync(file,JSON.stringify(s,null,2),{mode:0o600});
   console.log(JSON.stringify({worker:name,originalWorkerRetained:true,originalWorkerStopped:true,gatewayRestarted:false,qqControlPort:s.qqControlPort,qqHealthPort:s.qqHealthPort,paperEnabled:false}));return;
  }
  if(!['--status','--verify'].includes(op))throw Error('UNKNOWN_LOCAL_OPERATION');
  const added=interactions.filter(r=>!before.interactions.some(b=>b.id===r.id)),tasks=added.filter(r=>r.kind==='github-article');
  const exists=(await qq.query("SELECT to_regclass('mooyu_qq.agent_image_pages') AS name")).rows[0].name;
  const pages=exists?(await qq.query("SELECT p.task_id,p.revision_id,p.page_no,p.page_count,p.sha256,octet_length(p.image_data)::int AS bytes,m.message_id,m.status,m.remote_message_id,m.reply,(SELECT min(created_at) FROM mooyu_qq.events e WHERE e.channel_id=m.channel_id AND e.message_id=m.message_id AND e.event_type='delivered') AS delivered_at,(SELECT count(*)::int FROM mooyu_qq.events e WHERE e.channel_id=m.channel_id AND e.message_id=m.message_id AND e.event_type='send-started') AS send_attempts FROM mooyu_qq.agent_image_pages p JOIN mooyu_qq.messages m USING(channel_id,message_id) ORDER BY p.task_id,p.page_no")).rows:[];
  const gatewayBefore=before.containers.find(c=>c.Name==='/'+s.oldStack.gateway),gatewayNow=inspect(s.oldStack.gateway),mounts=c=>c.Mounts.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination));
  const report={at:new Date().toISOString(),originalInteractionsPreserved:before.interactions.every(a=>interactions.some(b=>b.id===a.id&&hash(a)===hash(b))),originalQQHistoryPreserved:before.messages.every(a=>messages.some(b=>b.channel_id===a.channel_id&&b.message_id===a.message_id&&hash(a)===hash(b))),schedulesPreserved:hash(before.schedules)===hash(schedules),settingsPreserved:hash(before.settings)===hash(settings),permissionsPreserved:hash(before.participants)===hash(participants),oldArticlesPreserved:before.articles.every(a=>articles.some(b=>b.id===a.id&&hash(a)===hash(b))),gatewayPreserved:gatewayBefore.Image===gatewayNow.Image&&gatewayBefore.State.StartedAt===gatewayNow.State.StartedAt&&hash(mounts(gatewayBefore))===hash(mounts(gatewayNow)),paperRunsUnchanged:paperRuns===before.paperRuns,callsBefore:before.calls,callsNow:calls,tasks:tasks.map(t=>({id:t.id,parentId:t.parent_id,state:t.state,plugin:t.input_json.plugin,result:t.result_json})),pages,newMessages:messages.filter(r=>!before.messages.some(b=>b.channel_id===r.channel_id&&b.message_id===r.message_id)).map(r=>({messageId:r.message_id,status:r.status,errorCode:r.error_code,remoteId:r.remote_message_id})),productionConnected:false,paperEnabled:false};
  fs.writeFileSync(path.join(s.evidence,'image-live-status.json'),JSON.stringify(report,null,2));
  if(!report.originalInteractionsPreserved||!report.originalQQHistoryPreserved||!report.schedulesPreserved||!report.settingsPreserved||!report.permissionsPreserved||!report.oldArticlesPreserved||!report.gatewayPreserved||!report.paperRunsUnchanged)throw Error('LOCAL_PRESERVATION_FAILED');
  if(op==='--verify'){
   if(tasks.length!==1||tasks[0].state!=='completed'||tasks[0].result_json?.publicationState!=='draft'||pages.length<2||pages.length!==pages[0].page_count||pages.some((p,i)=>p.task_id!==tasks[0].id||p.page_no!==i||p.page_count!==pages.length||p.revision_id!==tasks[0].result_json.articleRevisionId||p.status!=='delivered'||p.send_attempts!==1||!p.delivered_at||i>0&&Date.parse(p.delivered_at)<Date.parse(pages[i-1].delivered_at))||new Set(pages.map(p=>p.remote_message_id)).size!==pages.length||report.newMessages.length!==pages.length+1)throw Error('REAL_QQ_IMAGE_ACCEPTANCE_INCOMPLETE');
   const {NapCatControl}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/napcat-control.mjs')).href),napcat=new NapCatControl({token:s.gatewayToken,accessToken:s.accessToken,origin:s.gatewayOrigin});
   const {renderAgentArticlePage}=await load('agent-article-images.mjs');
   const article=(await pool.query('SELECT r.id AS revision_id,r.title,r.summary,r.blocks,r.citations FROM blog_article_revisions r WHERE r.id=$1',[tasks[0].result_json.articleRevisionId])).rows[0];
   const out=path.join(s.evidence,'pages');fs.mkdirSync(out,{recursive:true});report.remoteImages=[];report.exportedPages=[];
   for(const page of pages){
    const data=(await qq.query('SELECT image_data FROM mooyu_qq.agent_image_pages WHERE task_id=$1 AND page_no=$2',[page.task_id,page.page_no])).rows[0].image_data;
    const checksum=crypto.createHash('sha256').update(data).digest('hex'),expected=await renderAgentArticlePage({...article,publication_state:'draft'},page.page_no);
    if(checksum!==page.sha256||checksum!==expected.sha256||expected.pageCount!==pages.length)throw Error('REAL_QQ_IMAGE_CONTENT_MISMATCH');
    const target=path.join(out,'page-'+String(page.page_no+1).padStart(2,'0')+'.png');fs.writeFileSync(target,data);report.exportedPages.push({page:page.page_no+1,file:target,sha256:checksum,bytes:data.length});
    const msg=napcat.unwrap(await napcat.post('/Debug/call',{action:'get_msg',params:{message_id:Number(page.remote_message_id)}})),segments=msg?.message??[];
    const images=Array.isArray(segments)?segments.filter(p=>p.type==='image'):[];
    if(images.length!==1||String(msg.group_id)!==s.oldStack.groupId||String(msg.user_id)!==s.oldStack.botId)throw Error('REAL_QQ_IMAGE_REMOTE_MISMATCH');
    report.remoteImages.push({page:page.page_no+1,remoteMessageId:page.remote_message_id,imageCount:images.length,remoteTime:msg.time??null,types:segments.map(p=>p.type)});
   }
   const history=napcat.unwrap(await napcat.post('/Debug/call',{action:'get_group_msg_history',params:{group_id:Number(s.oldStack.groupId),count:30}}));
   const start=report.remoteImages[0].remoteTime;
   const remotePages=(history?.messages??[]).filter(m=>String(m.user_id)===s.oldStack.botId&&m.time>=start&&Array.isArray(m.message)&&m.message.some(p=>p.type==='image'));
   if(!start||remotePages.length!==pages.length||remotePages.some(m=>!pages.some(p=>p.remote_message_id===String(m.message_id))))throw Error('REAL_QQ_IMAGE_REMOTE_DUPLICATE');
   report.remoteHistoryImageIds=remotePages.map(m=>String(m.message_id));
   report.remoteOrderCorrect=report.remoteImages.every((m,i)=>i===0||m.remoteTime>=report.remoteImages[i-1].remoteTime);
   if(!report.remoteOrderCorrect)throw Error('REAL_QQ_IMAGE_REMOTE_ORDER_INVALID');
   report.result='PASSED';fs.writeFileSync(path.join(s.evidence,'image-live-acceptance.json'),JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report));
 }finally{await pool.end();await qq.end();}
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'IMAGE_LIVE_FAILED'}));process.exitCode=1;});
