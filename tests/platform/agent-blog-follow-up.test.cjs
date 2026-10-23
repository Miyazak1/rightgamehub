const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const api=file=>pathToFileURL(path.join(root,'apps/api/src',file));
const uuid=()=>crypto.randomUUID();

test('article answerer accepts only server supplied article evidence and maps citation indexes',async()=>{
  const {createDeepSeekAgentBlogWriter}=await import(api('agent-blog-writer.mjs'));
  const citationId=uuid();let sent;
  const fetchImpl=async(_url,options)=>{sent=JSON.parse(options.body);return{ok:true,status:200,headers:{get:()=> 'answer-request-1'},json:async()=>({choices:[{message:{content:JSON.stringify({answer:'根据本文保存的原文片段，这个项目的核心价值在于提供可核对的开放实现。',citationIndexes:[1]})}}],usage:{prompt_tokens:20,completion_tokens:12,total_tokens:32}})};};
  const writer=createDeepSeekAgentBlogWriter({fetchImpl,timeoutMs:1000,researcher:async()=>{throw new Error('unused');}});
  const output=await writer.answerArticle({apiKey:'sk-test-value-long-enough',model:'deepseek-flash',question:'它最核心的价值是什么？',article:{id:uuid(),revisionId:uuid(),title:'测试文章',summary:'这是一篇用于验证站内追问证据绑定的文章摘要。',blocks:[{type:'paragraph',text:'项目公开实现并提供可复核资料。',citationIds:[citationId]}],citations:[{id:citationId,title:'项目说明',publisher:'owner/repo',url:'https://github.com/owner/repo',excerpt:'这是服务器已经保存并验证过的项目原文片段。',locator:'README'}]}});
  assert.deepEqual(output.citationIds,[citationId]);assert.equal(output.requestId,'answer-request-1');
  const prompt=JSON.parse(sent.messages[1].content);assert.equal(prompt.verifiedSources[0].sourceIndex,1);assert.equal(prompt.publishedArticle.blocks[0].citationIndexes[0],1);assert.equal('apiKey' in prompt,false);
});

test('article answerer retries one completed empty JSON response and accepts one fenced JSON object',async()=>{
  const {createDeepSeekAgentBlogWriter}=await import(api('agent-blog-writer.mjs'));
  const citationId=uuid(),requests=[];let calls=0;
  const fetchImpl=async(_url,options)=>{requests.push(JSON.parse(options.body));calls++;const content=calls===1?'':`\`\`\`json\n${JSON.stringify({answer:'文章保存的证据表明，这个项目提供了可以公开核对的实现和说明。',citationIndexes:[1]})}\n\`\`\``;return{ok:true,status:200,headers:{get:name=>name==='x-ds-request-id'?`answer-request-${calls}`:null},json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})};};
  const writer=createDeepSeekAgentBlogWriter({fetchImpl,timeoutMs:1000});
  const output=await writer.answerArticle({apiKey:'sk-test-value-long-enough',model:'deepseek-flash',question:'这个项目有什么价值？',article:{id:uuid(),revisionId:uuid(),title:'测试文章',summary:'测试文章摘要',blocks:[{type:'paragraph',text:'项目提供了公开实现。',citationIds:[citationId]}],citations:[{id:citationId,title:'项目说明',publisher:'owner/repo',url:'https://github.com/owner/repo',repositoryUrl:'https://github.com/owner/repo',excerpt:'这是服务器保存且在文章发布前读取的公开仓库原文片段，用来验证追问回答只使用文章绑定的来源。',locator:'README'}]}});
  assert.equal(calls,2);assert.deepEqual(output.citationIds,[citationId]);assert.equal(output.requestId,'answer-request-2');assert.deepEqual(output.usage,{promptTokens:20,completionTokens:10,totalTokens:30,requests:2});
  assert.equal(requests[0].max_tokens,2400);assert.equal(requests[1].max_tokens,3240);assert.equal(requests[1].temperature,.2);assert.match(requests[1].messages[0].content,/上一次响应为空/);
});

test('article answerer rejects model citations outside the published revision',async()=>{
  const {createDeepSeekAgentBlogWriter}=await import(api('agent-blog-writer.mjs'));
  const writer=createDeepSeekAgentBlogWriter({fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify({answer:'这是一段长度足够但引用编号并不属于当前文章的回答。',citationIndexes:[2]})}}]})}),timeoutMs:1000});
  await assert.rejects(()=>writer.answerArticle({apiKey:'sk-test-value-long-enough',model:'deepseek-flash',question:'请解释',article:{id:uuid(),revisionId:uuid(),title:'文章',summary:'摘要',blocks:[{type:'paragraph',text:'正文'}],citations:[{id:uuid(),title:'来源',publisher:'作者',url:'https://example.test/source',excerpt:'原文片段'}]}}),error=>error.code==='AGENT_BLOG_ANSWER_INVALID');
});

test('follow-up service replays completed idempotent results without decrypting or charging again',async()=>{
  const {createAgentBlogFollowUpService}=await import(api('agent-blog-follow-up.mjs'));let decrypted=0,answered=0;
  const replay={id:uuid(),question:'原问题',answer:'原回答',citationIds:[],status:'completed'};
  const service=createAgentBlogFollowUpService({repository:{begin:async()=>({replay:true,result:replay})},vault:{decrypt:()=>{decrypted++;}},writer:{answerArticle:async()=>{answered++;}}});
  assert.equal(await service.ask({userId:uuid()},'article-slug',{question:'原问题'},'idempotency-key-123'),replay);assert.equal(decrypted,0);assert.equal(answered,0);
});

test('follow-up service records possibly dispatched timeouts as unknown and never retries',async()=>{
  const {createAgentBlogFollowUpService}=await import(api('agent-blog-follow-up.mjs'));
  const {AgentBlogAutomationError}=await import(api('agent-blog-writer.mjs'));
  const states=[],questionId=uuid();let calls=0;
  const repository={begin:async()=>({replay:false,row:{id:questionId},article:{id:uuid(),revisionId:uuid(),title:'文章',summary:'摘要',blocks:[],citations:[]},parent:null}),authorizeDispatch:async()=>({agentUserId:uuid(),model:'deepseek-flash',secret:{}}),finishFailure:async(...args)=>states.push(args),complete:async()=>{throw new Error('must not complete');}};
  const service=createAgentBlogFollowUpService({repository,vault:{decrypt:()=> 'sk-test-value-long-enough'},writer:{answerArticle:async()=>{calls++;throw new AgentBlogAutomationError('AGENT_PROVIDER_TIMEOUT',504,'timeout',{retryable:true});}}});
  await assert.rejects(()=>service.ask({userId:uuid()},'article-slug',{question:'请解释文章结论'},'idempotency-key-456'),error=>error.code==='BLOG_FOLLOW_UP_RESULT_UNKNOWN');
  assert.equal(calls,1);assert.deepEqual(states,[[questionId,'unknown','AGENT_PROVIDER_TIMEOUT',null,null]]);
});

test('article answerer never retries a provider content-filter result',async()=>{
  const {createDeepSeekAgentBlogWriter}=await import(api('agent-blog-writer.mjs'));let calls=0;
  const writer=createDeepSeekAgentBlogWriter({fetchImpl:async()=>{calls++;return{ok:true,status:200,headers:{get:()=>`filtered-${calls}`},json:async()=>({choices:[{finish_reason:'content_filter',message:{content:''}}],usage:{prompt_tokens:9,completion_tokens:0,total_tokens:9}})};},timeoutMs:1000});
  await assert.rejects(()=>writer.answerArticle({apiKey:'sk-test-value-long-enough',model:'deepseek-flash',question:'请解释',article:{id:uuid(),revisionId:uuid(),title:'文章',summary:'摘要',blocks:[{type:'paragraph',text:'正文'}],citations:[]}}),error=>error.code==='AGENT_BLOG_PROVIDER_OUTPUT_INVALID'&&error.retryable===false&&error.providerUsage.requests===1);
  assert.equal(calls,1);
});

test('follow-up service rechecks Agent and key immediately before provider dispatch',async()=>{
  const {createAgentBlogFollowUpService,AgentBlogFollowUpError}=await import(api('agent-blog-follow-up.mjs'));const states=[];let modelCalls=0,questionId=uuid();
  const repository={begin:async()=>({replay:false,row:{id:questionId},article:{id:uuid(),revisionId:uuid(),title:'文章',summary:'摘要',blocks:[],citations:[]},parent:null}),authorizeDispatch:async()=>{throw new AgentBlogFollowUpError('BLOG_FOLLOW_UP_UNAVAILABLE',409,'suspended');},finishFailure:async(...args)=>states.push(args)};
  const service=createAgentBlogFollowUpService({repository,vault:{decrypt:()=>{throw new Error('must not decrypt');}},writer:{answerArticle:async()=>{modelCalls++;}}});
  await assert.rejects(()=>service.ask({userId:uuid()},'article-slug',{question:'请解释文章结论'},'idempotency-key-guard'),error=>error.code==='BLOG_FOLLOW_UP_UNAVAILABLE');
  assert.equal(modelCalls,0);assert.deepEqual(states,[[questionId,'failed','BLOG_FOLLOW_UP_UNAVAILABLE']]);
});

test('follow-up service retries only persistence with the original model receipt',async()=>{
  const {createAgentBlogFollowUpService}=await import(api('agent-blog-follow-up.mjs'));const states=[];let modelCalls=0,saveCalls=0;
  const repository={begin:async()=>({replay:false,row:{id:uuid()},article:{id:uuid(),revisionId:uuid(),title:'文章',summary:'摘要',blocks:[],citations:[]},parent:null}),authorizeDispatch:async()=>({agentUserId:uuid(),model:'deepseek-flash',secret:{}}),complete:async()=>{saveCalls++;if(saveCalls<3)throw new Error('temporary database failure');return{id:uuid(),question:'问题',answer:'回答',citationIds:[],status:'completed'};},finishFailure:async(...args)=>states.push(args)};
  const service=createAgentBlogFollowUpService({repository,vault:{decrypt:()=> 'sk-test-value-long-enough'},writer:{answerArticle:async()=>{modelCalls++;return{answer:'这是同一份已经生成的回答。',citationIds:[],usage:{totalTokens:20},requestId:'req-1'};}}});
  const result=await service.ask({userId:uuid()},'article-slug',{question:'请解释文章结论'},'idempotency-key-789');
  assert.equal(result.status,'completed');assert.equal(modelCalls,1);assert.equal(saveCalls,3);assert.deepEqual(states,[]);
});

test('browser article follow-up is direct authenticated Q&A, not a clipboard handoff',()=>{
  const page=fs.readFileSync(path.join(root,'packages/platform-client/src/BlogPages.jsx'),'utf8');
  const client=fs.readFileSync(path.join(root,'packages/platform-api-client/src/index.mjs'),'utf8');
  const migration=fs.readFileSync(path.join(root,'apps/api/migrations/0119_agent_blog_follow_up.sql'),'utf8');
  assert.match(page,/api\.askBlogQuestion/);assert.match(page,/仅依据本文正文/);assert.match(page,/访问仓库/);assert.match(page,/GITHUB REPOSITORY/);assert.doesNotMatch(page,/clipboard|复制问题|复制到已添加/u);
  assert.match(client,/askBlogQuestion/);assert.match(migration,/evidence_snapshot_hash/);assert.match(migration,/status IN \('processing','completed','failed','unknown'\)/);
});
