import {createAgentAccountService} from './agent-account-service.mjs';
import {PostgresAgentAccountRepository} from './agent-account-repository.mjs';
import {createPaperStudyDurableRuntime} from './paper-study-durable-runtime.mjs';

const operator='d7b00000-0000-4000-8000-0000000000f0';
const provisionKey='desktop-paper-study-execution-v1';
export async function assertDesktopPaperDatabase(pool){
  const identity=(await pool.query('SELECT current_database() AS db,current_user AS username')).rows[0];
  if(identity.db!=='desktop_business_test'||identity.username!=='desktop_business_test')throw Error('DESKTOP_PAPER_DATABASE_REJECTED');
  if(!(await pool.query('SELECT version FROM desktop_business_fixture_state LIMIT 1')).rows.length)throw Error('DESKTOP_PAPER_FIXTURE_REQUIRED');
}
export async function prepareDesktopPaperStudy(pool){
  await assertDesktopPaperDatabase(pool);
  await pool.query("INSERT INTO users(id,display_name,role) VALUES($1,'Isolated paper operator','admin') ON CONFLICT(id) DO NOTHING",[operator]);
  const service=createAgentAccountService({repository:new PostgresAgentAccountRepository(pool),authorizeOperator:async actor=>actor.userId===operator});
  const agent=await service.provision({userId:operator},{provisionKey,displayName:'隔离论文执行器',handle:'desktop-paper-execution',badgeLabel:'AI 助手',operatorLabel:'隔离测试',capabilities:[],metadata:{isolatedPaperStudy:true}});
  return {prepared:true,agentUserId:agent.agentUserId,modelCallsEnabled:false,publishingEnabled:false};
}
export async function desktopPaperAgent(pool){
  await assertDesktopPaperDatabase(pool);
  const row=(await pool.query("SELECT a.user_id FROM agent_accounts a JOIN users u ON u.id=a.user_id WHERE a.provision_key=$1 AND a.operator_user_id=$2 AND a.status='active' AND u.status='active' AND a.metadata @> '{\"isolatedPaperStudy\":true}'::jsonb",[provisionKey,operator])).rows[0];
  if(!row)throw Error('DESKTOP_PAPER_PREPARATION_REQUIRED');return row.user_id;
}
export async function desktopPaperWorkerReady(pool,instanceId=null){
  return !!(await pool.query("SELECT worker_id FROM agent_runtime_workers WHERE worker_id='desktop-paper-study-worker' AND ($1::uuid IS NULL OR instance_id=$1) AND status IN ('idle','busy') AND metadata_json->>'role'='paper-study' AND last_seen_at>now()-interval '90 seconds'",[instanceId])).rows.length;
}
export function createDesktopPaperStudyService({pool,redisUrl}){
  let pending;
  const get=()=>pending??=(async()=>createPaperStudyDurableRuntime({pool,redisUrl,executionAgentUserId:await desktopPaperAgent(pool),workerId:'desktop-paper-api-unused'}))().catch(error=>{pending=null;throw error;});
  const service=Object.fromEntries(['list','read','source','import','analyze','draft'].map(method=>[method,async(...args)=>(await get()).service[method](...args)]));
  service.ready=async()=>{try{return await (await get()).service.ready()&&await desktopPaperWorkerReady(pool);}catch{return false;}};
  return {service,async close(){if(pending)await (await pending).close();}};
}
