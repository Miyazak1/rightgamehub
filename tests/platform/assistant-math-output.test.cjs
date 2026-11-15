const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');

test('math text replies recover literal set differences, LaTeX commands and code fences without changing tool JSON',async()=>{
 const {parseAssistantOutput}=await import('../../apps/api/src/assistant-output.mjs');
 const raw=String.raw`{"reply":"集合差 A\B：\(A\setminus B=\{8\}\)。\frac{1}{2}\text{示例}\right)\beta \neq 0\n下一段"}`;
 const parsed=parseAssistantOutput(raw);
 assert.equal(parsed.reply,String.raw`集合差 A\B：\(A\setminus B=\{8\}\)。\frac{1}{2}\text{示例}\right)\beta \neq 0`+'\n下一段');
 const valid={reply:String.raw`\frac{1}{2}，A\B`+'\n下一段 "引用"'};
 assert.deepEqual(parseAssistantOutput(JSON.stringify(valid)),valid);
 assert.deepEqual(parseAssistantOutput('```json\n'+JSON.stringify(valid)+'\n```'),valid);
 const tool={toolCall:{name:'search_capabilities',arguments:{query:'A\\B'}}};
 assert.deepEqual(parseAssistantOutput(JSON.stringify(tool)),tool);
 assert.throws(()=>parseAssistantOutput(String.raw`{"toolCall":{"name":"open_capability","arguments":{"capabilityId":"game:\bad\id"}}}`));
 assert.throws(()=>parseAssistantOutput('{"reply":"unfinished'));
});

test('owned graded explanations provide a labelled fallback; ungraded or foreign questions never disclose it',async()=>{
 const {createPlatformAssistantService,createPlatformAssistantProvider}=await import('../../apps/api/src/platform-assistant.mjs');
 const q={id:'sets',prompt:String.raw`求 A\B`,checked:true,explanation:String.raw`A\B 保留属于 A 且不属于 B 的元素，得到 {8}。`};
 const actor={userId:'owner'},batchId=randomUUID();let checked=true;
 const provider=createPlatformAssistantProvider({apiKey:'fixture',invoke:async()=>({output:'{"reply":"unfinished',responseRef:{finishReason:'length'}})});
 const service=createPlatformAssistantService({provider,practiceService:{get:async a=>{
   if(a.userId!=='owner')throw Object.assign(Error('missing'),{code:'PRACTICE_NOT_FOUND'});
   return {id:batchId,items:[{...q,checked}],config:{}};
 }}});
 const input=()=>({requestId:randomUUID(),message:'请解释这道题的解题过程。',context:{batchId,questionId:q.id}});
 const result=await service.send(actor,input());assert.match(result.reply,/题目自带解析/);assert.ok(result.reply.includes(q.explanation));
 checked=false;await assert.rejects(service.send(actor,input()),{code:'ASSISTANT_RESPONSE_INVALID'});
 await assert.rejects(service.send({userId:'other'},input()),{code:'PRACTICE_NOT_FOUND'});
 checked=true;await assert.rejects(service.send(actor,{...input(),message:'找个游戏'}),{code:'ASSISTANT_RESPONSE_INVALID'});
});

test('authenticated question explanation returns repaired math through the production provider and HTTP route',async t=>{
 const {createPlatformAssistantService,createPlatformAssistantProvider,registerPlatformAssistantRoutes}=await import('../../apps/api/src/platform-assistant.mjs');
 const {createAgentDeepSeekProviderAdapter}=await import('../../apps/api/src/agent-deepseek-provider-adapter.mjs');
 const content=String.raw`{"reply":"集合差 A\B 是属于 A 但不属于 B 的元素。\(A\setminus B=\{8\}\)"}`;
 const invoke=createAgentDeepSeekProviderAdapter({fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{status:200})});
 const service=createPlatformAssistantService({provider:createPlatformAssistantProvider({apiKey:'fixture',invoke}),practiceService:{get:async()=>({id:'batch',config:{},items:[{id:'sets',checked:true,correctAnswer:'D',explanation:'得到 {8}。'}]})}});
 const app=require('../../apps/api/node_modules/fastify')();t.after(()=>app.close());
 registerPlatformAssistantRoutes(app,{service,requireAuth:async r=>{r.actor={userId:'owner'};}});
 const response=await app.inject({method:'POST',url:'/v1/me/assistant/messages',payload:{requestId:randomUUID(),message:'解释这道题。',context:{batchId:randomUUID(),questionId:'sets'}}});
 assert.equal(response.statusCode,200);assert.ok(response.json().data.reply.includes(String.raw`A\setminus B`));
});
