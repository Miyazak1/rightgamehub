import {PostgresAgentInteractionRepository} from './agent-interaction-repository.mjs';
import {GITHUB_PLUGIN_MANIFEST} from './agent-plugins/github/index.mjs';
import {interactionFail,interactionUuid} from './agent-interaction-contracts.mjs';

const safeCode=value=>/^[A-Z][A-Z0-9_]{0,79}$/u.test(value??'')?value:null;
// Read-only aggregation. Plugin presence is not an Agent capability grant and
// an API host snapshot is not proof that a separate executor is healthy.
export function createAgentPluginAdminService({pool,interactionService,qqAdminService}){
 const repository=new PostgresAgentInteractionRepository(pool);
 return {async read(actor,agentId){
  if(!interactionUuid(agentId))interactionFail('AGENT_INTERACTION_NOT_FOUND',404);
  await repository.operator(actor,agentId);
  const grants=(await pool.query(`SELECT capability_key,contract_version,status,
   status='active' AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now()) AS effective
   FROM agent_capability_grants WHERE agent_user_id=$1 AND capability_key=ANY($2::text[]) ORDER BY capability_key,contract_version`,[agentId,GITHUB_PLUGIN_MANIFEST.capabilities.map(c=>c.key)])).rows;
  const faults=(await pool.query(`SELECT id,state,error_code,updated_at FROM agent_interactions
   WHERE agent_user_id=$1 AND kind IN ('github-search','github-question','github-article')
   AND error_code IS NOT NULL ORDER BY updated_at DESC,id DESC LIMIT 5`,[agentId])).rows.map(r=>({id:r.id,state:r.state,code:safeCode(r.error_code)??'AGENT_TASK_FAILED',at:r.updated_at}));
  const host=interactionService?.agentId===agentId?interactionService.pluginHost:null;
  const github=host?.status().find(p=>p.id==='mooyu.github'&&p.activeVersion);
  let admission={state:'not-configured',reasonCode:null};
  if(host){try{const ready=await interactionService.capabilities();admission={state:ready.available?'ready':'blocked',reasonCode:safeCode(ready.reasonCode)};}catch(e){admission={state:'unavailable',reasonCode:safeCode(e.code)??'AGENT_INTERACTION_UNAVAILABLE'};}}
  let qq;
  try{
   const value=await qqAdminService.execute(actor,agentId,'status');
   const installed=value.plugins?.find(p=>p.id==='mooyu.qq'&&p.activeVersion!==false);
   const runtime=value.channelRuntime;
   qq={id:'mooyu.qq',name:'QQ 沟通渠道',kind:'channel',version:installed?.version??null,enabled:installed?.enabled??null,
    state:!installed?'upgrade-required':runtime?.stopped?'stopped':runtime?.started?'running':'unknown',
    responseEnabled:typeof value.settings?.enabled==='boolean'?value.settings.enabled:null,
    connection:Object.fromEntries(['available','loggedIn','coreReady','groupReady','connected','accountMatches','accountState','phase','groupState','observation','checkedAt','verifiedAt','restartRequired'].map(key=>[key,value.runtime?.[key]])),
    lastFault:runtime?.lastFault?{code:safeCode(runtime.lastFault.code)??'QQ_WORKER_UNAVAILABLE',at:runtime.lastFault.at}:null,
    reasonCode:!installed?'QQ_PLUGIN_STATUS_UPGRADE_REQUIRED':null};
  }catch(e){qq={id:'mooyu.qq',name:'QQ 沟通渠道',kind:'channel',version:null,enabled:null,state:'unavailable',reasonCode:safeCode(e.code)??'QQ_CONTROL_UNAVAILABLE'};}
  return {checkedAt:new Date().toISOString(),plugins:[{id:GITHUB_PLUGIN_MANIFEST.id,name:GITHUB_PLUGIN_MANIFEST.displayName,kind:'capability',version:github?.version??GITHUB_PLUGIN_MANIFEST.version,enabled:github?.enabled??null,state:host?'assembled':'not-configured',admission,executorState:'not-probed',grants:grants.map(r=>({key:r.capability_key,version:r.contract_version,status:r.status,effective:r.effective})),recentFaults:faults},qq],activationMode:'service-config',paperEnabled:false};
 }};
}

export function registerAgentPluginAdminRoutes(app,{service,requireAuth}){
 app.get('/v1/admin/agents/:agentId/plugins',{preHandler:[async(_req,reply)=>{reply.header('Cache-Control','no-store, private').header('Pragma','no-cache');},requireAuth],schema:{params:{type:'object',additionalProperties:false,required:['agentId'],properties:{agentId:{type:'string',format:'uuid'}}}}},async(req,reply)=>{
  try{return {data:await service.read(req.actor,req.params.agentId)};}catch(e){const forbidden=e.code==='AGENT_INTERACTION_OPERATOR_REQUIRED';reply.code(forbidden?403:e.statusCode===404?404:503);return {error:{code:forbidden?e.code:e.statusCode===404?'AGENT_INTERACTION_NOT_FOUND':'AGENT_PLUGIN_ADMIN_UNAVAILABLE'}};}
 });
}
