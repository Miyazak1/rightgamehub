const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),s=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),{Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg');
async function main(){
 if(s.schemaVersion!=='agent-interaction-lab-v1')throw Error('ISOLATION_REQUIRED');
 const pool=new Pool({connectionString:s.databaseUrl});try{
  const report={at:new Date().toISOString(),productionConnected:false,paperEnabled:false,agentId:s.agentId};
  report.interactions=(await pool.query('SELECT id,parent_id,kind,channel,actor_ref,conversation_ref,state,result_json,error_code,run_id FROM agent_interactions ORDER BY created_at')).rows;
  report.runs=(await pool.query('SELECT id,agent_user_id,workflow_key,status,output_type,output_id,error_code FROM agent_runs ORDER BY created_at')).rows;
  report.stages=(await pool.query('SELECT run_id,stage_key,status,error_code,error_message FROM agent_run_stages ORDER BY created_at,ordinal')).rows;
  report.modelOutputs=(await pool.query('SELECT schema_key,content_json FROM agent_provider_output_artifacts ORDER BY created_at')).rows;
  report.providerFailures=(await pool.query("SELECT call.id,call.error_code,call.error_message,call.response_ref_json->>'finishReason' AS finish_reason FROM agent_provider_calls call WHERE call.status IN ('failed','uncertain') ORDER BY call.created_at")).rows;
  report.toolCalls=(await pool.query('SELECT call.tool_key,call.status,call.error_code,action.request_json FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id ORDER BY call.created_at')).rows;
  report.budget=(await pool.query('SELECT status,sum(charged_provider_calls)::int AS calls,sum(charged_input_tokens)::bigint AS input_tokens,sum(charged_output_tokens)::bigint AS output_tokens,sum(charged_cost_microusd)::bigint AS cost FROM agent_budget_reservations GROUP BY status')).rows;
  report.evidence=(await pool.query('SELECT artifact_key,schema_key,source_tool_artifact_ids,content_sha256 FROM agent_runtime_stage_artifacts ORDER BY created_at')).rows;
  report.articles=(await pool.query('SELECT id,publication_state FROM blog_articles WHERE author_user_id=$1',[s.agentId])).rows;
  report.drafts=(await pool.query('SELECT article.id,article.publication_state,revision.title,revision.summary,revision.blocks,revision.citations FROM blog_articles article JOIN blog_article_revisions revision ON revision.id=article.working_revision_id WHERE article.author_user_id=$1',[s.agentId])).rows;
  const qqUrl=new URL(s.databaseUrl);qqUrl.pathname='/'+s.qqDatabase;const qqPool=new Pool({connectionString:qqUrl.href});try{
   report.qqMessages=(await qqPool.query('SELECT message_id,user_id,origin_group_id,status,error_code,remote_message_id FROM mooyu_qq.messages ORDER BY created_at')).rows;
   report.qqLinks=(await qqPool.query('SELECT message_id,interaction_id,task_id,task_settled FROM mooyu_qq.agent_links ORDER BY message_id')).rows;
   if(process.argv.includes('--replay-qq')){
    const original=(await pool.query("SELECT id,input_json,origin_json FROM agent_interactions WHERE channel='qq' AND kind='message' AND id IN (SELECT parent_id FROM agent_interactions WHERE kind='github-article' AND state='completed') ORDER BY created_at DESC LIMIT 1")).rows[0];
    if(!original)throw Error('COMPLETED_REAL_QQ_REQUEST_REQUIRED');
    const counts=async()=>({calls:Number((await pool.query('SELECT sum(charged_provider_calls) AS n FROM agent_budget_reservations')).rows[0].n),articles:Number((await pool.query('SELECT count(*) AS n FROM blog_articles WHERE author_user_id=$1',[s.agentId])).rows[0].n),messages:Number((await qqPool.query('SELECT count(*) AS n FROM mooyu_qq.messages')).rows[0].n)});
    const before=await counts(),{createQQAgentClient}=await import(pathToFileURL(path.join(root,'apps/qq-channel/src/agent-bridge.mjs')).href),client=createQQAgentClient({url:'http://127.0.0.1:'+s.apiPort,secret:s.sharedSecret,agentId:s.agentId});
    const value=await client({operation:'submit',origin:original.origin_json,input:original.input_json}),after=await counts();
    report.qqAdmissionReplay={source:'stored-authentic-QQ-request',sameInteraction:value.id===original.id,taskId:value.task?.id,before,after,unchanged:JSON.stringify(before)===JSON.stringify(after)};
    if(!report.qqAdmissionReplay.sameInteraction||!report.qqAdmissionReplay.unchanged)throw Error('QQ_REPLAY_DEDUPLICATION_FAILED');
    fs.writeFileSync(path.join(s.evidence,'qq-admission-replay.json'),JSON.stringify(report.qqAdmissionReplay,null,2));
   }
  }finally{await qqPool.end();}
  const messages=report.interactions.filter(v=>v.channel==='web'&&v.kind==='message');if(messages.length){
   const row=messages[0],before=report.budget.reduce((n,r)=>n+r.calls,0),headers={authorization:'Bearer '+s.browserToken,'content-type':'application/json'},stored=(await pool.query('SELECT input_json,origin_json FROM agent_interactions WHERE id=$1',[row.id])).rows[0];
   const response=await fetch('http://127.0.0.1:'+s.apiPort+'/v1/me/assistant/messages',{method:'POST',headers,body:JSON.stringify({...stored.input_json,conversationId:stored.origin_json.conversationRef})});const replay=await response.json();
   report.restartReplay={sameInteraction:replay.data?.interaction?.id===row.id,state:replay.data?.interaction?.state,providerCallsBefore:before,providerCallsAfter:Number((await pool.query('SELECT sum(charged_provider_calls) AS n FROM agent_budget_reservations')).rows[0].n)};
  }
  fs.writeFileSync(path.join(s.evidence,'audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({interactions:report.interactions.map(r=>({id:r.id,kind:r.kind,channel:r.channel,state:r.state,errorCode:r.error_code,reply:r.result_json?.reply?.slice(0,200)})),failedStages:report.stages.filter(v=>['failed','uncertain'].includes(v.status)),providerFailures:report.providerFailures,budget:report.budget,articles:report.articles,drafts:report.drafts.map(d=>({id:d.id,title:d.title,blocks:d.blocks.length,citations:d.citations.length,publicationState:d.publication_state})),qqMessages:report.qqMessages,qqLinks:report.qqLinks,restartReplay:report.restartReplay,qqAdmissionReplay:report.qqAdmissionReplay,evidence:s.evidence,paperEnabled:false}));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'LAB_AUDIT_FAILED'}));process.exitCode=1;});
