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
  report.toolCalls=(await pool.query('SELECT call.tool_key,call.status,call.error_code,action.request_json FROM agent_tool_calls call JOIN agent_run_actions action ON action.id=call.action_id ORDER BY call.created_at')).rows;
  report.budget=(await pool.query('SELECT status,sum(charged_provider_calls)::int AS calls,sum(charged_input_tokens)::bigint AS input_tokens,sum(charged_output_tokens)::bigint AS output_tokens,sum(charged_cost_microusd)::bigint AS cost FROM agent_budget_reservations GROUP BY status')).rows;
  report.evidence=(await pool.query('SELECT artifact_key,schema_key,source_tool_artifact_ids,content_sha256 FROM agent_runtime_stage_artifacts ORDER BY created_at')).rows;
  report.articles=(await pool.query('SELECT id,publication_state FROM blog_articles WHERE author_user_id=$1',[s.agentId])).rows;
  const messages=report.interactions.filter(v=>v.channel==='web'&&v.kind==='message');if(messages.length){
   const row=messages[0],before=report.budget.reduce((n,r)=>n+r.calls,0),headers={authorization:'Bearer '+s.browserToken,'content-type':'application/json'},stored=(await pool.query('SELECT input_json,origin_json FROM agent_interactions WHERE id=$1',[row.id])).rows[0];
   const response=await fetch('http://127.0.0.1:'+s.apiPort+'/v1/me/assistant/messages',{method:'POST',headers,body:JSON.stringify({...stored.input_json,conversationId:stored.origin_json.conversationRef})});const replay=await response.json();
   report.restartReplay={sameInteraction:replay.data?.interaction?.id===row.id,state:replay.data?.interaction?.state,providerCallsBefore:before,providerCallsAfter:Number((await pool.query('SELECT sum(charged_provider_calls) AS n FROM agent_budget_reservations')).rows[0].n)};
  }
  fs.writeFileSync(path.join(s.evidence,'audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({interactions:report.interactions.map(r=>({id:r.id,kind:r.kind,channel:r.channel,state:r.state,errorCode:r.error_code,reply:r.result_json?.reply?.slice(0,200)})),failedStages:report.stages.filter(v=>['failed','uncertain'].includes(v.status)),budget:report.budget,articles:report.articles,restartReplay:report.restartReplay,evidence:s.evidence,paperEnabled:false}));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'LAB_AUDIT_FAILED'}));process.exitCode=1;});
