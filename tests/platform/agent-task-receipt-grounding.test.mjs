import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {refreshTaskReceipt,checkTaskReply} from '../../apps/api/src/agent-interaction-task-receipts.mjs';
import {createPlatformAssistantService} from '../../apps/api/src/platform-assistant.mjs';
const id='ddcffa61-fae5-5b52-8d30-4f23bc46ee30';
const scope={agent_user_id:'agent',channel:'qq',actor_ref:'caller',conversation_ref:'group:caller'};
const failed={...scope,id,kind:'github-search',state:'failed',error_code:'AGENT_BLOG_PUBLIC_RUNTIME_TERMINAL_FAILURE',parent_id:'old-message'};
test('historical queued receipt is refreshed from the same caller task without rewriting stored history',async()=>{
 const stored={reply:'旧的提交回执',results:[{name:'github_search_projects',result:{status:'queued',taskId:id},task:{id,state:'queued'},reply:'任务已保存'}]};
 const previous={...scope,id:'old-message',result_json:stored},repo={get:async key=>key===previous.id?previous:key===id?failed:null};
 const receipt=await refreshTaskReceipt(repo,scope,previous.id);
 assert.equal(receipt.results[0].task.state,'failed');assert.equal(receipt.results[0].result.status,'failed');assert.match(receipt.results[0].reply,/已失败/);
 assert.equal(stored.results[0].task.state,'queued');
 for(const field of ['agent_user_id','channel','actor_ref','conversation_ref'])assert.equal(await refreshTaskReceipt(repo,{...scope,[field]:'foreign'},previous.id),null);
 const foreignChild={...failed,actor_ref:'foreign'};
 assert.equal((await refreshTaskReceipt({get:async key=>key===previous.id?previous:foreignChild},scope,previous.id)).results.length,0);
});
test('pending claims require a current scoped task and a tool receipt, not history or a stale status query',()=>{
 const reply='检索任务 '+id+' 目前仍是排队状态';
 const rejected=checkTaskReply({reply,results:[],tasks:[failed]});assert.equal(rejected.accepted,false);assert.match(rejected.fallback,/已失败/);
 const pending={...failed,state:'queued',error_code:null};
 assert.equal(checkTaskReply({reply,results:[],tasks:[pending]}).accepted,false);
 const results=[{name:'get_agent_work',result:{tasks:[pending]}}];
 assert.equal(checkTaskReply({reply,results,tasks:[pending]}).accepted,true);
 assert.equal(checkTaskReply({reply,results,tasks:[failed]}).accepted,false);
 assert.equal(checkTaskReply({reply:'已经掌握上下文，但尚未执行新搜索。',results:[],tasks:[]}).accepted,true);
});
test('a stale historical queue claim is corrected into one real tool submission for the new request',async()=>{
 let rounds=0,submissions=0;const request='重新查找浏览器DOM selector项目，优先MIT，排除资料合集';
 const newId=randomUUID();
 const tools={descriptions:[{name:'github_search_projects'}],
  checkReply:async args=>checkTaskReply({...args,tasks:[failed]}),
  execute:async(_actor,name,args)=>{submissions++;assert.equal(name,'github_search_projects');assert.equal(args.topic,request);return {name,task:{id:newId,state:'queued',kind:'github-search'},reply:'新任务已保存'};}};
 const service=createPlatformAssistantService({practiceService:{},tools,agentIdentity:{displayName:'小墨鱼',profile:{}},provider:async({messages})=>{
  rounds++;if(rounds===1)return '任务 '+id+' 目前仍是排队状态';
  assert.ok(messages.some(m=>m.content.includes('当前本人任务状态')&&m.content.includes('已失败')));
  return {toolCall:{name:'github_search_projects',arguments:{topic:request}}};
 }});
 const result=await service.send({userId:'caller'},{requestId:randomUUID(),message:request,history:[]});
 assert.equal(rounds,2);assert.equal(submissions,1);assert.equal(result.task.id,newId);assert.equal(result.reply,'新任务已保存');
});
test('persistent hallucinated queue claims end with a truthful bounded fallback and no automatic task retry',async()=>{
 let rounds=0,submissions=0;
 const tools={descriptions:[],checkReply:async args=>checkTaskReply({...args,tasks:[failed]}),execute:async()=>{submissions++;}};
 const service=createPlatformAssistantService({practiceService:{},tools,provider:async()=>{rounds++;return '任务 '+id+' 正在排队';}});
 const result=await service.send({userId:'caller'},{requestId:randomUUID(),message:'查找项目',history:[]});
 assert.equal(rounds,5);assert.equal(submissions,0);assert.match(result.reply,/没有创建新的搜索任务/);assert.match(result.reply,/已失败/);
});
test('the live scoped resolver takes precedence over an in-memory historical queued receipt',async()=>{
 let step=0,seen;
 const prior=randomUUID(),tools={descriptions:[],execute:async()=>({name:'github_search_projects',result:{taskId:id,status:'queued'},task:{id,state:'queued'},reply:'旧提交'})};
 const service=createPlatformAssistantService({practiceService:{},tools,agentIdentity:{displayName:'小墨鱼',profile:{}},receiptResolver:async()=>({results:[{task:{id,state:'failed'},currentStateRead:true}]}),provider:async r=>{step++;if(step===1)return {toolCall:{name:'github_search_projects',arguments:{}}};seen=r.messages;return '当前旧任务已经失败，未执行新搜索。';}});
 await service.send({userId:'caller'},{requestId:prior,message:'查找项目',history:[]});
 await service.send({userId:'caller'},{requestId:randomUUID(),message:'状态如何',history:[{role:'assistant',requestId:prior,content:'旧任务排队'}]});
 const data=seen.find(m=>m.content.includes('历史平台工具回执'));assert.ok(data.content.includes('"state":"failed"'));assert.ok(!data.content.includes('"state":"queued"'));
});
