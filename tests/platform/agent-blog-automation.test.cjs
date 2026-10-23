const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const url=file=>pathToFileURL(path.resolve(__dirname,'../../apps/api/src',file));

test('Agent provider keys are encrypted with authenticated per-agent binding and never returned',async()=>{
 const {createAgentSecretVault}=await import(url('agent-secret-vault.mjs')),master=crypto.randomBytes(32).toString('hex'),vault=createAgentSecretVault({masterKey:master}),a=crypto.randomUUID(),b=crypto.randomUUID(),encrypted=vault.encrypt(a,'deepseek','sk-secret-value-that-is-long-enough');
 assert.equal(vault.decrypt(a,'deepseek',encrypted),'sk-secret-value-that-is-long-enough');
 assert.equal(encrypted.lastFour,'ough');assert.match(encrypted.fingerprint,/^[a-f0-9]{64}$/);assert.doesNotMatch(encrypted.ciphertext.toString('utf8'),/secret-value/);
 assert.throws(()=>vault.decrypt(b,'deepseek',encrypted),error=>error.code==='AGENT_PROVIDER_KEY_DECRYPT_FAILED');
});

test('Agent writer performs generation and an independent automatic publication review',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let calls=0;
 const generated={title:'为什么地图会改变我们理解世界的方式',summary:'地图不只是地点的缩影，也是一套选择信息、组织空间并帮助人们形成共同理解的方法。',blocks:[{type:'heading',level:2,text:'地图从来不是简单复制'},{type:'paragraph',text:'地图会主动选择比例、方向和符号。'.repeat(90),citationIndexes:[1]},{type:'heading',level:2,text:'比例决定看见什么'},{type:'paragraph',text:'当观察尺度改变，重要的信息也会随之改变。'.repeat(70),citationIndexes:[1]},{type:'list',ordered:false,items:['先确认地图服务的目的','再理解符号和比例','最后比较不同地图的取舍'],citationIndexes:[1]},{type:'paragraph',text:'理解这些选择，可以帮助我们更清楚地阅读空间信息，也能提醒我们保持必要的判断。'.repeat(35),citationIndexes:[1]}],followUpQuestions:['地图项目如何选择投影方式？','开源地图工具怎样验证数据来源？','普通用户应当怎样比较两张地图？']};
 const fetchImpl=async url=>{if(String(url).endsWith('/models'))return{ok:true,status:200,json:async()=>({data:[{id:'deepseek-v4-pro',name:'DeepSeek-V4.1-Pro'},{id:'deepseek-flash',name:'DeepSeek-V4.1-Flash-1017',context_window:128000,max_output_tokens:8192}]})};calls++;const content=calls===1?`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``:JSON.stringify({approved:true,qualityScore:.91,sensitiveRisk:'low',factualRisk:'low',reasonCodes:[]});return{ok:true,status:200,headers:{get:()=>`req-${calls}`},json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})};};
 const researcher=async()=>({sources:[{sourceIndex:1,title:'OpenStreetMap',url:'https://github.com/openstreetmap/openstreetmap-website',repositoryUrl:'https://github.com/openstreetmap/openstreetmap-website',publisher:'openstreetmap/openstreetmap-website',excerpt:'这是从项目 README 中提取并经过服务器验证的原文片段，用于测试自动文章的证据绑定和来源展示。'.repeat(3),locator:'仓库 README',accessedAt:'2026-10-23T00:00:00.000Z',contentHash:'a'.repeat(64)}],usage:{searchQueries:1,documentsFetched:1}});
 const writer=createDeepSeekAgentBlogWriter({fetchImpl,timeoutMs:1000,researcher}),validation=await writer.testKey('sk-valid-key-for-test');assert.deepEqual(validation.models.map(model=>model.id),['deepseek-flash','deepseek-v4-pro']);const result=await writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'人文历史地理科学中的大众知识'});
 assert.equal(result.review.approved,true);assert.equal(result.content.locale,'zh-CN');assert.match(result.content.slug,/^agent-/);assert.equal(result.content.citations[0].repositoryUrl,'https://github.com/openstreetmap/openstreetmap-website');assert.equal(result.content.blocks.at(-2).text,'继续追问');assert.deepEqual(result.providerRequestIds,['req-1','req-2']);assert.equal(calls,2);
});

test('Agent writer fails closed before generation when no GitHub source can be verified',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let providerCalls=0;
 const writer=createDeepSeekAgentBlogWriter({fetchImpl:async()=>{providerCalls++;throw new Error('must not call provider');},researcher:async()=>({sources:[],usage:{searchQueries:1,documentsFetched:0}})});
 await assert.rejects(()=>writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'开源人工智能工具'}),error=>error.code==='AGENT_BLOG_RESEARCH_EMPTY');
 assert.equal(providerCalls,0);
});

test('Agent writer rejects a research result whose claimed repository is not GitHub',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let providerCalls=0;
 const writer=createDeepSeekAgentBlogWriter({fetchImpl:async()=>{providerCalls++;throw new Error('must not call provider');},researcher:async()=>({sources:[{sourceIndex:1,title:'伪来源',url:'https://example.com/repository',repositoryUrl:'https://example.com/repository',publisher:'example/repository',excerpt:'这是一段长度足够但并不来自公开代码仓库的来源文字，因此必须在调用写作模型以前被服务端拒绝。',locator:'README',accessedAt:'2026-10-23T00:00:00.000Z'}]})});
 await assert.rejects(()=>writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'开源人工智能工具'}),error=>error.code==='AGENT_BLOG_RESEARCH_INVALID');
 assert.equal(providerCalls,0);
});

test('Automation service keeps provider keys write-only and only publishes after both review layers pass',async()=>{
 const {createAgentBlogAutomation}=await import(url('agent-blog-automation.mjs'));const agentUserId=crypto.randomUUID(),actor={userId:crypto.randomUUID(),profile:{role:'admin'}},events=[];
 const repository={saveSecret:async(...args)=>(events.push(['save',...args]),{configured:true,lastFour:'1234'}),loadSecret:async()=>({ciphertext:Buffer.from('x'),nonce:Buffer.alloc(12),auth_tag:Buffer.alloc(16)}),deleteSecret:async()=>({configured:false}),configure:async()=>({enabled:true}),queueManual:async()=>({id:'run'}),listRuns:async()=>[],enqueueDue:async()=>null,claimNext:async()=>null};
 const models=[{id:'deepseek-flash',name:'DeepSeek-V4.1-Flash-1017',contextWindow:128000,maxOutputTokens:8192}],automation=createAgentBlogAutomation({repository,vault:{available:true,encrypt:()=>({ciphertext:Buffer.from('x'),nonce:Buffer.alloc(12),authTag:Buffer.alloc(16),fingerprint:'a'.repeat(64),lastFour:'1234'}),decrypt:()=>'sk-provider-secret-1234'},writer:{testKey:async key=>(events.push(['tested',key]),{ok:true,models}),listModels:async()=>models}});
 const result=await automation.setProviderKey(actor,agentUserId,{apiKey:'sk-provider-secret-1234'});assert.deepEqual(result,{configured:true,lastFour:'1234',provider:'deepseek',models});assert.equal(events[0][0],'tested');assert.equal(events[1][0],'save');assert.equal(JSON.stringify(result).includes('provider-secret'),false);
 assert.deepEqual(await automation.listProviderModels(actor,agentUserId),{provider:'deepseek',models});
 await assert.rejects(()=>automation.configure(actor,agentUserId,{enabled:true,model:'made-up-model',intervalHours:84,monthlyArticleLimit:8,topicScope:'人文历史地理科学中的大众知识'}),error=>error.code==='AGENT_PROVIDER_MODEL_UNAVAILABLE');
});

test('Production secret root is scoped to the API and the admin surface is fully automatic',()=>{
 const fs=require('node:fs'),root=path.resolve(__dirname,'../..');
 const compose=fs.readFileSync(path.join(root,'deploy/compose.prod.yml'),'utf8'),routes=fs.readFileSync(path.join(root,'apps/api/src/agent-account-routes.mjs'),'utf8'),admin=fs.readFileSync(path.join(root,'packages/platform-client/src/AgentAdmin.jsx'),'utf8');
 assert.equal(compose.split(/\r?\n/).filter(line=>/^\s+AGENT_SECRET_ENCRYPTION_KEY:/.test(line)).length,1);
 assert.match(routes,/blog-runs\/:runId\/withdraw/);
 assert.match(admin,/不进入人工编辑流程/);
 assert.match(admin,/每月运行上限/);
 assert.match(admin,/listAdminAgentProviderModels/);
 assert.match(admin,/deepseek-flash/);
 assert.doesNotMatch(admin,/博客编辑器|保存私有草稿|人工审核/);
 const styles=fs.readFileSync(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
 assert.match(styles,/agent-control-card[^\n]*var\(--gh-border\)/);
});
