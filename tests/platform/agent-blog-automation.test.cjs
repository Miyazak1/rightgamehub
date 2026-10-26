const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const url=file=>pathToFileURL(path.resolve(__dirname,'../../apps/api/src',file));

test('Agent provider keys are encrypted with authenticated per-agent binding and never returned',async()=>{
 const {createAgentSecretVault}=await import(url('agent-secret-vault.mjs')),master=crypto.randomBytes(32).toString('hex'),vault=createAgentSecretVault({masterKey:master}),a=crypto.randomUUID(),b=crypto.randomUUID(),encrypted=vault.encrypt(a,'deepseek','sk-secret-value-that-is-long-enough');
 assert.equal(vault.decrypt(a,'deepseek',encrypted),'sk-secret-value-that-is-long-enough');
 assert.equal(encrypted.lastFour,'ough');assert.match(encrypted.fingerprint,/^[a-f0-9]{64}$/);assert.doesNotMatch(encrypted.ciphertext.toString('utf8'),/secret-value/);
 assert.throws(()=>vault.decrypt(b,'deepseek',encrypted),error=>error.code==='AGENT_PROVIDER_KEY_DECRYPT_FAILED');
});

test('Agent behavior profiles are general, strict, and safe to extend through modules',async()=>{
 const {defaultAgentBehaviorProfile,normalizeAgentBehaviorProfile}=await import(url('agent-behavior-profile.mjs')),profile=defaultAgentBehaviorProfile(),normalized=normalizeAgentBehaviorProfile(profile);
 assert.equal(normalized.schemaVersion,'agent-behavior-v1');assert.match(normalized.core.mission,/开放项目/);assert.equal(normalized.modules.editorial.comparisonEnabled,true);assert.ok(normalized.modules.editorial.interestSignals.includes('实现方式有创意'));
 assert.throws(()=>normalizeAgentBehaviorProfile({...profile,permissions:{publish:true}}),/Invalid Agent behavior profile/);
 assert.throws(()=>normalizeAgentBehaviorProfile({...profile,modules:{editorial:{...profile.modules.editorial,interestSignals:['重复信号','重复信号']}}}),/Invalid Agent behavior profile size/);
});

test('Agent writer performs generation and an independent automatic publication review',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let calls=0;
 const generated={title:'为什么地图会改变我们理解世界的方式',summary:'地图不只是地点的缩影，也是一套选择信息、组织空间并帮助人们形成共同理解的方法。',blocks:[{type:'heading',level:2,text:'地图从来不是简单复制'},{type:'paragraph',text:'地图会主动选择比例、方向和符号。'.repeat(90),citationIndexes:[1]},{type:'heading',level:2,text:'比例决定看见什么'},{type:'paragraph',text:'当观察尺度改变，重要的信息也会随之改变。'.repeat(70),citationIndexes:[1]},{type:'list',ordered:false,items:['先确认地图服务的目的','再理解符号和比例','最后比较不同地图的取舍'],citationIndexes:[1]},{type:'paragraph',text:'理解这些选择，可以帮助我们更清楚地阅读空间信息，也能提醒我们保持必要的判断。'.repeat(35),citationIndexes:[1]}],followUpQuestions:['地图项目如何选择投影方式？','开源地图工具怎样验证数据来源？','普通用户应当怎样比较两张地图？']};
 const requests=[],fetchImpl=async(url,options)=>{if(String(url).endsWith('/models'))return{ok:true,status:200,json:async()=>({data:[{id:'deepseek-v4-pro',name:'DeepSeek-V4.1-Pro'},{id:'deepseek-flash',name:'DeepSeek-V4.1-Flash-1017',context_window:128000,max_output_tokens:8192}]})};requests.push(JSON.parse(options.body));calls++;const content=calls===1?JSON.stringify({mode:'single',selectedIndexes:[1],angle:'从普通用户可以理解的地图协作价值切入',rationale:'这个项目资料完整、用途明确，并且能够让普通读者理解开放地图如何通过协作持续改进。',interestSignals:['适合学习和探索'],comparisonAxes:[]}):calls===2?`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``:JSON.stringify({approved:true,qualityScore:.91,sensitiveRisk:'low',factualRisk:'low',reasonCodes:[]});return{ok:true,status:200,headers:{get:()=>`req-${calls}`},json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}})};};
 const researcher=async()=>({sources:[{sourceIndex:1,title:'OpenStreetMap',url:'https://github.com/openstreetmap/openstreetmap-website',repositoryUrl:'https://github.com/openstreetmap/openstreetmap-website',publisher:'openstreetmap/openstreetmap-website',excerpt:'这是从项目 README 中提取并经过服务器验证的原文片段，用于测试自动文章的证据绑定和来源展示。'.repeat(3),locator:'仓库 README',accessedAt:'2026-10-23T00:00:00.000Z',contentHash:'a'.repeat(64)}],usage:{searchQueries:1,documentsFetched:1}});
 const writer=createDeepSeekAgentBlogWriter({fetchImpl,timeoutMs:1000,researcher}),validation=await writer.testKey('sk-valid-key-for-test');assert.deepEqual(validation.models.map(model=>model.id),['deepseek-flash','deepseek-v4-pro']);const result=await writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'人文历史地理科学中的大众知识'});
 assert.equal(result.review.approved,true);assert.equal(result.selection.mode,'single');assert.deepEqual(result.selection.repositories,['openstreetmap/openstreetmap-website']);assert.equal(result.content.locale,'zh-CN');assert.match(result.content.slug,/^agent-/);assert.equal(result.content.citations[0].repositoryUrl,'https://github.com/openstreetmap/openstreetmap-website');assert.equal(result.content.blocks.at(-2).text,'继续追问');assert.deepEqual(result.providerRequestIds,['req-1','req-2','req-3']);assert.ok(requests.every(request=>request.thinking?.type==='disabled'&&request.reasoning_effort==='none'));assert.equal(calls,3);
});

test('Agent editorial competition may reuse a previously published repository only inside a sourced comparison',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let call=0;
 const sources=['owner/alpha','owner/beta'].map((publisher,index)=>({sourceIndex:index+1,title:publisher,url:`https://github.com/${publisher}`,repositoryUrl:`https://github.com/${publisher}`,publisher,excerpt:`${publisher} 的公开说明包含安装、使用示例和可以核对的项目能力，足以支持对比文章中的具体判断。`.repeat(3),locator:'仓库 README',accessedAt:'2026-10-23T00:00:00.000Z',contentHash:String(index+1).repeat(64)}));
 const generated={title:'两个创作工具应该怎样选择',summary:'两个项目面向相近的创作任务，但上手方式和适用对象不同，可以依据公开资料作出有边界的比较。',blocks:[{type:'heading',level:2,text:'为什么值得放在一起比较'},{type:'paragraph',text:'甲项目提供了清楚的使用入口。'.repeat(40),citationIndexes:[1]},{type:'heading',level:2,text:'另一个项目的取舍'},{type:'paragraph',text:'乙项目采用了不同的体验方式。'.repeat(40),citationIndexes:[2]},{type:'list',ordered:false,items:['先确认自己的使用目的','再比较上手方式'],citationIndexes:[1,2]},{type:'paragraph',text:'选择应该依据实际需求和公开说明。'.repeat(40),citationIndexes:[1,2]}],followUpQuestions:['哪个更适合第一次尝试？','两者的上手方式有什么不同？','应该怎样核对项目最新状态？']};
 const fetchImpl=async()=>{call++;const content=call===1?JSON.stringify({mode:'comparison',selectedIndexes:[1,2],angle:'比较两个同类创作工具的上手路径',rationale:'两个项目解决相近任务，资料都足以支持对上手方式和适用对象进行直接比较。',interestSignals:['可以快速体验'],comparisonAxes:['上手方式','适用对象']}):call===2?JSON.stringify(generated):JSON.stringify({approved:true,qualityScore:.9,sensitiveRisk:'low',factualRisk:'low',reasonCodes:[]});return{ok:true,status:200,headers:{get:()=>`compare-${call}`},json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage:{}})};};
 const writer=createDeepSeekAgentBlogWriter({fetchImpl,researcher:async()=>({sources,usage:{}})}),result=await writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'有趣的开源创作工具',previousRepositoryUrls:['https://github.com/OWNER/ALPHA']});
 assert.equal(result.selection.mode,'comparison');assert.deepEqual(result.selection.repositories,['owner/alpha','owner/beta']);assert.deepEqual(result.selection.reusedRepositories,['owner/alpha']);assert.equal(result.content.citations.length,2);assert.ok(result.content.citations.every(citation=>result.content.blocks.some(block=>block.citationIds?.includes(citation.id))));
});

test('Agent writer hard-rejects a previously published repository as a single-project topic',async()=>{
 const {createDeepSeekAgentBlogWriter}=await import(url('agent-blog-writer.mjs'));let providerCalls=0;
 const source={sourceIndex:1,title:'Alpha',url:'https://github.com/owner/alpha',repositoryUrl:'https://github.com/owner/alpha',publisher:'owner/alpha',excerpt:'这个仓库的公开说明包含安装、使用示例和可以核对的项目能力，足以支持文章中的具体判断。'.repeat(4),locator:'仓库 README',accessedAt:'2026-10-23T00:00:00.000Z',contentHash:'a'.repeat(64)};
 const fetchImpl=async()=>{providerCalls++;return{ok:true,status:200,headers:{get:()=>`single-repeat-${providerCalls}`},json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({mode:'single',selectedIndexes:[1],angle:'再次单独介绍这个已经发布过的项目',rationale:'模型即使再次选择旧项目，服务端也必须在生成文章以前拒绝，不能依赖模型自己遵守去重规则。',interestSignals:['适合学习和探索'],comparisonAxes:[]})}}],usage:{}})}};
 const writer=createDeepSeekAgentBlogWriter({fetchImpl,researcher:async()=>({sources:[source],usage:{}})});
 await assert.rejects(()=>writer.generate({apiKey:'sk-valid-key-for-test',model:'deepseek-flash',topicScope:'有趣的开源工具',previousRepositoryUrls:['https://github.com/OWNER/ALPHA']}),error=>error.code==='AGENT_BLOG_SELECTION_INVALID'&&/不能再次作为单项目/.test(error.message));
 assert.equal(providerCalls,1);
});

test('Repository history includes published and withdrawn article citations without an arbitrary recency limit',async()=>{
 const {PostgresAgentBlogAutomationRepository}=await import(url('agent-blog-automation.mjs'));let sql='';
 const repository=new PostgresAgentBlogAutomationRepository({query:async statement=>{sql=statement;return{rows:[{repository_url:'https://github.com/owner/alpha',source_url:'https://github.com/owner/alpha'},{repository_url:null,source_url:'https://github.com/owner/beta'}]};}});
 assert.deepEqual(await repository.previousRepositoryUrls(crypto.randomUUID()),['https://github.com/owner/alpha','https://github.com/owner/beta']);
 assert.match(sql,/publication_state IN \('published','withdrawn'\)/);assert.doesNotMatch(sql,/LIMIT\s+\d+/i);
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

test('Production secret root is scoped to the API and explicit private canary executors only',()=>{
 const fs=require('node:fs'),root=path.resolve(__dirname,'../..');
 const compose=fs.readFileSync(path.join(root,'deploy/compose.prod.yml'),'utf8'),routes=fs.readFileSync(path.join(root,'apps/api/src/agent-account-routes.mjs'),'utf8'),admin=fs.readFileSync(path.join(root,'packages/platform-client/src/AgentAdmin.jsx'),'utf8');
 assert.equal(compose.split(/\r?\n/).filter(line=>/^\s+AGENT_SECRET_ENCRYPTION_KEY:/.test(line)).length,3);
 assert.match(compose,/agent-blog-canary-run:[\s\S]*?restart: "no"[\s\S]*?AGENT_SECRET_ENCRYPTION_KEY:/u);
 assert.match(compose,/agent-blog-private-scheduler:[\s\S]*?profiles: \["agent-blog-private-scheduler"\][\s\S]*?AGENT_BLOG_PRIVATE_CANARY_PUBLISH_ENABLED: "false"/u);
 assert.match(routes,/blog-runs\/:runId\/withdraw/);
 assert.match(routes,/behavior-profile/);
 assert.match(admin,/新基座先生成私有草稿并完成影子验收/);
 assert.match(admin,/新基座影子运行/);
 assert.match(admin,/旧自动发布记录/);
 assert.match(admin,/listAdminAgentRuntimeRuns/);
 assert.match(admin,/getAdminAgentRuntimeTimeline/);
 assert.match(admin,/查看草稿/);
 assert.match(admin,/getAdminAgentFoundationDraft/);
 assert.match(admin,/openFoundationDraft\(draft\.articleId\)/);
 assert.match(admin,/PRIVATE DRAFT · READ ONLY/);
 assert.match(admin,/aria-modal="true"/);
 assert.match(admin,/cleanSourceExcerpt/);
 assert.match(admin,/BlogReadingContent/);
 const blogPages=fs.readFileSync(path.join(root,'packages/platform-client/src/BlogPages.jsx'),'utf8');
 assert.match(blogPages,/export function BlogReadingContent/);
 assert.match(blogPages,/访问仓库/);
 assert.match(blogPages,/查看引用的原文片段/);
 const accountRoutes=fs.readFileSync(path.join(root,'apps/api/src/agent-account-routes.mjs'),'utf8');
 assert.match(accountRoutes,/foundation-drafts\/:articleId/);
 assert.match(admin,/人格与行为/);
 assert.match(admin,/选题编辑人格/);
 assert.match(admin,/每月运行上限/);
 assert.match(admin,/每天 10:00（北京时间）/);
 assert.match(admin,/每天运行需将上限设为 31/);
 assert.match(admin,/timeZone:'Asia\/Shanghai'/);
 assert.match(admin,/listAdminAgentProviderModels/);
 assert.match(admin,/deepseek-flash/);
 assert.match(admin,/displayName:'小墨鱼'/);
 assert.doesNotMatch(admin,/博客编辑器|人工审核/);
 const styles=fs.readFileSync(path.join(root,'packages/platform-client/src/styles.css'),'utf8');
 assert.match(styles,/agent-control-card[^\n]*var\(--gh-border\)/);
 assert.match(styles,/agent-switch input\[type="checkbox"\][^\n]*width:16px/);
 assert.match(styles,/agent-state[^\n]*white-space:nowrap/);
 assert.match(styles,/agent-draft-preview__close[^\n]*min-width:72px[^\n]*white-space:nowrap/);
 const blog=fs.readFileSync(path.join(root,'packages/platform-client/src/BlogPages.jsx'),'utf8'),avatar=fs.readFileSync(path.join(root,'packages/platform-client/src/AvatarView.jsx'),'utf8');
 assert.match(blog,/blog-author-identity/);assert.match(blog,/article\.author\.avatar/);assert.match(avatar,/xiaomoyu-avatar-v1\.webp/);
 assert.match(blog,/initialArticleId/);assert.match(blog,/articles\.find\(item => item\.id === initialArticleId\)/);
 const app=fs.readFileSync(path.join(root,'packages/platform-client/src/App.jsx'),'utf8');
 assert.match(app,/readAdminArticle/);assert.match(app,/initialArticleId=\{readAdminArticle\(\)\}/);
 const migration=fs.readFileSync(path.join(root,'apps/api/migrations/0122_agent_blog_daily_ten.sql'),'utf8');
 assert.match(migration,/next_agent_blog_run_at/);assert.match(migration,/Asia\/Shanghai/);assert.match(migration,/time '10:00'/);
 const automation=fs.readFileSync(path.join(root,'apps/api/src/agent-blog-automation.mjs'),'utf8');
 assert.match(automation,/DUPLICATE_SINGLE_REPOSITORY/);assert.match(automation,/previousRepositoryUrls/);
});
