const test=require('node:test'),assert=require('node:assert/strict');
const load=name=>import('../../apps/api/src/'+name);

test('prompt boundary matrix preserves frozen evidence and stays within shared input budgets',async()=>{
 const {buildBlogModelRequest}=await load('agent-blog-prompt.mjs');
 const {compileAgentProviderRequest}=await load('agent-provider-request.mjs');
 const {defaultAgentBehaviorProfile}=await load('agent-behavior-profile.mjs');
 const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
 let cases=0;
 for(const count of [1,3,5])for(const materials of [1,6])for(const text of ['document '.repeat(2000),'中文证据'.repeat(2000),'😀测试'.repeat(2000),'"\\\n'.repeat(2000)])for(const repair of [false,true])for(const kind of ['selection','composition']){
  const sources=Array.from({length:kind==='composition'?Math.min(3,count):count},(_,i)=>({sourceIndex:i+1,
   repositoryUrl:`https://github.com/owner/tool${i}`,revision:'a'.repeat(40),title:'tool'+i,
   description:'A concrete verified tool',excerpt:text,
   materials:Array.from({length:materials},(_,j)=>({type:j?'documentation':'readme',path:`docs/${j}.md`,
    canonicalUri:`https://github.com/owner/tool${i}/blob/${'a'.repeat(40)}/docs/${j}.md`,sourceRevision:'a'.repeat(40),excerpt:text}))}));
  const payload={topicScope:'研究有用的开放工具',agentBehavior:defaultAgentBehaviorProfile(),
   allowedInterestSignals:['可以快速体验'],[kind==='selection'?'candidates':'verifiedSources']:sources,
   ...(repair?{correction:{previousOutput:{mode:'single',selectedIndexes:[1]},instruction:'修复 JSON'}}:{})};
  const before=stableHash(payload),budget=kind==='selection'?18000:24000;
  const request=buildBlogModelRequest({system:'Only use verified evidence. '+kind,payload,inputBudget:budget,kind});
  const compiled=compileAgentProviderRequest({request,modelPolicy:{maxInputTokens:60000,maxOutputTokens:7000},tokenCeiling:kind==='selection'?1800:7000,timeoutSeconds:120});
  assert.ok(compiled.inputTokens<=budget);assert.equal(stableHash(payload),before);
  const view=JSON.parse(request.messages[1].content);assert.equal(view.projection.originalPayloadSha256,before);
  const projected=view.candidates??view.verifiedSources;assert.equal(projected.length,sources.length);
  projected.forEach((source,i)=>{assert.equal(source.sourceIndex,i+1);assert.equal(source.revision,sources[i].revision);assert.equal(source.repositoryUrl,sources[i].repositoryUrl);});
  cases++;
 }
 assert.equal(cases,96);
 assert.ok(2*18000+2*24000<=90000,'both repairs fit the unchanged public input-token ceiling');
});

test('compiler includes system messages and refuses malformed or over-budget inputs before any action',async()=>{
 const {compileAgentProviderRequest}=await load('agent-provider-request.mjs');
 const options={modelPolicy:{maxInputTokens:1000,maxOutputTokens:100},tokenCeiling:100,timeoutSeconds:30};
 for(const size of [1,100,872]){
  const result=compileAgentProviderRequest({...options,request:{messages:[{role:'system',content:'s'},{role:'user',content:'中'.repeat(Math.floor(size/3))||'x'}]}});
  assert.ok(result.inputTokens<=1000);
 }
 assert.throws(()=>compileAgentProviderRequest({...options,request:{messages:[{role:'system',content:'x'.repeat(1000)},{role:'user',content:'tiny'}]}}),e=>e.code==='AGENT_PROVIDER_INPUT_BUDGET_EXCEEDED');
 assert.throws(()=>compileAgentProviderRequest({...options,request:{messages:[{role:'user',content:'x'.repeat(262145)}]}}),e=>e.code==='AGENT_PROVIDER_MESSAGE_TOO_LARGE');
 assert.throws(()=>compileAgentProviderRequest({...options,tokenCeiling:101,request:{value:'ok'}}),e=>e.code==='AGENT_PROVIDER_OUTPUT_BUDGET_EXCEEDED');
 assert.throws(()=>compileAgentProviderRequest({...options,request:{messages:[{role:'user',content:'\ud83d'}]}}),e=>e.code==='AGENT_PROVIDER_TEXT_INVALID');
 assert.throws(()=>compileAgentProviderRequest({...options,request:{messages:[{role:'user',content:'zero\0byte'}]}}),e=>e.code==='AGENT_PROVIDER_TEXT_INVALID');
 const {unicodePrefix,isDatabaseJson}=await load('text-boundaries.mjs');
 assert.equal(unicodePrefix('a😀',2),'a');assert.equal(unicodePrefix('a😀',3),'a😀');
 assert.equal(isDatabaseJson({text:'\ud83d'}),false);assert.equal(isDatabaseJson({text:'😀'}),true);
 const cyclic={};cyclic.self=cyclic;
 assert.throws(()=>compileAgentProviderRequest({...options,request:cyclic}),e=>e.code==='AGENT_PROVIDER_REQUEST_INVALID');
 assert.equal(compileAgentProviderRequest({...options,request:{messages:[{role:'user',content:'x'.repeat(936)}]}}).inputTokens,1000);
 assert.throws(()=>compileAgentProviderRequest({...options,request:{messages:[{role:'user',content:'x'.repeat(937)}]}}),e=>e.code==='AGENT_PROVIDER_INPUT_BUDGET_EXCEEDED');
});

test('maximum profile, history and correction are bounded without mutating frozen evidence',async()=>{
 const {buildBlogModelRequest}=await load('agent-blog-prompt.mjs');
 const {defaultAgentBehaviorProfile,normalizeAgentBehaviorProfile}=await load('agent-behavior-profile.mjs');
 const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
 const profile=defaultAgentBehaviorProfile();
 Object.assign(profile.core,{mission:'a'.repeat(1200),personality:'b'.repeat(1200),voice:'c'.repeat(800),audience:'d'.repeat(500)});
 profile.modules.editorial.persona='e'.repeat(1600);
 profile.modules.editorial.interestSignals=Array.from({length:12},(_,i)=>String(i).padEnd(80,'x'));
 const payload={agentBehavior:normalizeAgentBehaviorProfile(profile),recentTitles:Array(100).fill('中文标题'.repeat(100)),
  activeEditorialCooldowns:Array.from({length:100},()=>({label:'历史线索'.repeat(100)})),
  candidates:[{sourceIndex:1,revision:'a'.repeat(40),repositoryUrl:'https://github.com/owner/tool',excerpt:'可验证证据'.repeat(2000)}],
  correction:{previousOutput:{body:'旧输出'.repeat(10000)},instruction:'重新生成完整 JSON'}};
 const hash=stableHash(payload),request=buildBlogModelRequest({system:'Use frozen evidence.',payload});
 const view=JSON.parse(request.messages[1].content);
 assert.equal(stableHash(payload),hash);assert.equal(view.projection.originalPayloadSha256,hash);
 assert.equal(view.projection.omittedRecentTitles,90);assert.equal(view.projection.omittedCooldownHints,88);
 assert.equal(view.correction.previousOutputTruncated,true);
 assert.ok(request.messages.reduce((sum,item)=>sum+Buffer.byteLength(item.content)+64,0)<=18000);
 assert.throws(()=>buildBlogModelRequest({system:'x'.repeat(18000),payload}),e=>e.code==='AGENT_BLOG_PROMPT_BUDGET_EXCEEDED');
});

test('shared immediate admission rejects paused, stale, future and non-running workers consistently',async()=>{
 const {publicImmediateAdmission}=await load('agent-blog-public-admission.mjs');
 const now=new Date('2026-11-17T02:00:00Z');
 const base={enabled:true,mode:'foundation-public',worker:{state:'idle',heartbeatAt:now.toISOString()}};
 assert.equal(publicImmediateAdmission({schedule:base,now}).ready,true);
 for(const change of [{enabled:false},{worker:{state:'stopped',heartbeatAt:now.toISOString()}},
  {worker:{state:'idle',heartbeatAt:'2026-11-17T02:01:00Z'}},{worker:{state:'idle',heartbeatAt:'2026-11-17T01:55:00Z'}}]){
  assert.equal(publicImmediateAdmission({schedule:{...base,...change},now}).ready,false);
 }
 assert.equal(publicImmediateAdmission({schedule:base,now,activeFire:true}).ready,false);
});

test('long composition repair keeps an auditable bounded previous draft within the same input budget',async()=>{
 const {buildBlogModelRequest}=await load('agent-blog-prompt.mjs');
 const {stableHash}=await load('researcher-qa-protocol/stable-json.mjs');
 const draft={title:'实际标题 CSS',blocks:Array.from({length:20},()=>({type:'paragraph',text:'公开项目资料'.repeat(500)}))};
 const payload={verifiedSources:[{sourceIndex:1,repositoryUrl:'https://github.com/owner/tool',revision:'a'.repeat(40),excerpt:'证据'.repeat(5000)}],
  correction:{previousDraft:draft,instruction:'返回完整修正文章。'}};
 const before=stableHash(payload),request=buildBlogModelRequest({system:'Only verified evidence.',payload,kind:'composition',inputBudget:24000});
 const view=JSON.parse(request.messages[1].content);
 assert.equal(view.correction.previousDraftTruncated,true);
 assert.equal(view.correction.previousDraftSha256,stableHash(draft));assert.equal(stableHash(payload),before);
 assert.ok(request.messages.reduce((sum,item)=>sum+Buffer.byteLength(item.content)+64,0)<=24000);
});

test('execution cancellation reaches adapters while pre-dispatch cancellation performs no network call',async()=>{
 const {withAgentExecution}=await load('agent-execution-context.mjs');
 const {createAgentDeepSeekProviderAdapter}=await load('agent-deepseek-provider-adapter.mjs');
 let calls=0,started;
 const entered=new Promise(resolve=>started=resolve),outer=new AbortController();
 const adapter=createAgentDeepSeekProviderAdapter({fetchImpl:async(_url,{signal})=>{
  calls++;started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }});
 const input={apiKey:'synthetic',modelId:'fixture',request:{messages:[{role:'user',content:'hello'}]},tokenCeiling:10,timeoutSeconds:30,idempotencyKey:'audit-cancel'};
 const pending=withAgentExecution({signal:outer.signal},()=>adapter(input));await entered;outer.abort();
 await assert.rejects(pending,error=>error.code==='AGENT_PROVIDER_CANCELLED'&&error.notDispatched===false);
 await assert.rejects(withAgentExecution({signal:outer.signal},()=>adapter(input)),error=>error.notDispatched===true);
 assert.equal(calls,1);
});
