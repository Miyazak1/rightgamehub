const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const workerUrl=pathToFileURL(path.join(root,'apps/api/src/researcher-worker.mjs'));
const topicId='11111111-1111-4111-8111-111111111111';
const gapId='22222222-2222-4222-8222-222222222222';
const jobId='33333333-3333-4333-8333-333333333333';
const attemptId='44444444-4444-4444-8444-444444444444';
const sourceId='55555555-5555-4555-8555-555555555555';
const versionId='66666666-6666-4666-8666-666666666666';
const evidenceId='77777777-7777-4777-8777-777777777777';
const hash='a'.repeat(64);

const request=()=>({
  protocol:'research-job-v1',jobId,topicId,contractVersion:2,trigger:'manual',requestedAt:'2026-10-21T00:00:00.000Z',
  gap:{gapId,question:'价格是否变化？',reason:'需要核验。',priority:'important'},
  contract:{questions:['价格是否变化？'],budget:{maxSearchQueriesPerRun:0,maxDocumentsPerRun:1,maxDeepResearchJobsPerRun:1}},
  methodTemplates:[{id:attemptId,methodVersion:'direct-observation-v1',label:'直接观察',description:'只使用直接证据',methodKind:'direct-observation',rules:{evidenceKinds:['direct-quote'],authorityTiers:['official-primary'],requiredDimensions:[],missingValuePolicy:'unknown',comparisonPolicy:'same-method-unit',aggregation:'none',instructions:'只记录直接值。'}}],
  metricDefinitions:[{metricKey:'plan.price',label:'套餐价格',valueType:'number',canonicalUnit:'CNY',methodVersion:'direct-observation-v1'}],
  knownSourceVersions:[{sourceId,sourceVersionId:versionId,url:'https://example.com/release',contentHash:hash,fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],
  evidence:[{evidenceId,sourceId,sourceVersionId:versionId,url:'https://example.com/release',contentHash:hash,quoteHash:'b'.repeat(64),locator:{type:'text',start:0,end:12},quote:'套餐价格调整为 12 元。',kind:'direct-quote',authorityTier:'official-primary'}],
});
const modelFinding=()=>({status:'completed',findings:[{findingId:'price-2026-10',kind:'metric',title:'套餐价格为 12 元',summary:'冻结证据直接记录了套餐价格。',importance:'important',confidence:0.96,evidenceIds:[evidenceId],metric:{metricKey:'plan.price',label:'套餐价格',valueType:'number',value:12,unit:'CNY',observedAt:'2026-10-20T00:00:00.000Z',dimensions:{},methodVersion:'direct-observation-v1'}}],unresolvedQuestions:[]});
const modelFactFinding=()=>({status:'completed',findings:[{findingId:'price-cut-2026-10',kind:'fact',title:'套餐价格下降',summary:'冻结证据直接记录了新的套餐价格。',importance:'important',confidence:0.95,evidenceIds:[evidenceId],fact:{subject:'示例套餐',dimensionKey:'pricing',dimensionLabel:'价格',predicateKey:'monthly-price',predicateLabel:'月价',valueType:'number',value:12,unit:'CNY/month',occurredAt:null,direction:'decreased',scope:{plan:'pro'}}}],unresolvedQuestions:[]});
const response=(status,body)=>({ok:status>=200&&status<300,status,async json(){return body;}});

test('Researcher worker config separates model credentials and rejects an unsafe heartbeat',async()=>{
  const {loadResearcherWorkerConfig}=await import(workerUrl);
  const config=loadResearcherWorkerConfig({RESEARCHER_PLATFORM_URL:'http://api:3090',RESEARCHER_WORKER_TOKEN:'w'.repeat(32),RESEARCHER_DEEPSEEK_API_KEY:'secret-provider-key'});
  assert.equal(config.platformUrl,'http://api:3090');
  assert.equal(config.platformTimeoutMs,15000);
  assert.equal(config.apiKey,'secret-provider-key');
  assert.equal(config.providerId,'deepseek-researcher');
  assert.throws(()=>loadResearcherWorkerConfig({RESEARCHER_PLATFORM_URL:'http://api:3090',RESEARCHER_WORKER_TOKEN:'w'.repeat(32),RESEARCHER_DEEPSEEK_API_KEY:'key',RESEARCHER_WORKER_LEASE_SECONDS:'60',RESEARCHER_WORKER_HEARTBEAT_SECONDS:'60'}),/must be lower/u);
});

test('Researcher worker health probe is read-only, instance-specific and fails closed',async()=>{
  const {checkResearcherWorkerHealth}=await import(workerUrl),calls=[];
  const config={platformUrl:'http://api:3090',platformTimeoutMs:15000,workerToken:'w'.repeat(32),workerId:'researcher-worker-1',providerId:'deepseek-researcher',model:'deepseek-chat',heartbeatSeconds:60};
  const healthy=await checkResearcherWorkerHealth(config,{fetchImpl:async(url,options)=>{calls.push({url,options});return response(200,{data:{healthy:true,status:'online',state:'polling',lastSeenAt:'2026-10-21T00:00:00.000Z',staleAfterSeconds:180}});}});
  assert.equal(healthy.status,'online');
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/v1\/internal\/researcher\/workers\/health$/u);
  assert.deepEqual(JSON.parse(calls[0].options.body),{workerId:'researcher-worker-1',provider:'deepseek-researcher',model:'deepseek-chat',staleAfterSeconds:180});
  await assert.rejects(()=>checkResearcherWorkerHealth(config,{fetchImpl:async()=>response(503,{data:{healthy:false,status:'stale',state:'polling',lastSeenAt:'2026-10-20T23:50:00.000Z',staleAfterSeconds:180}})}),error=>error.code==='RESEARCHER_WORKER_UNHEALTHY');
});

test('production Researcher container has a stable identity and an authenticated healthcheck',async()=>{
  const [compose,cli]=await Promise.all([fs.readFile(path.join(root,'deploy/compose.prod.yml'),'utf8'),fs.readFile(path.join(root,'apps/api/src/researcher-worker-cli.mjs'),'utf8')]);
  assert.match(compose,/RESEARCHER_WORKER_ID: \$\{RESEARCHER_WORKER_ID:-researcher-worker-1\}/u);
  assert.match(compose,/researcher-worker-cli\.mjs", "--health"/u);
  assert.match(compose,/start_period: 60s/u);
  assert.match(cli,/checkResearcherWorkerHealth/u);
  assert.match(cli,/process\.argv\.includes\('--health'\)/u);
});

test('Researcher prompt treats frozen content as untrusted data and never embeds provider secrets',async()=>{
  const {buildResearcherMessages}=await import(workerUrl);
  const messages=buildResearcherMessages(request()),serialized=JSON.stringify(messages);
  assert.match(messages[0].content,/不可信数据/u);
  assert.match(messages[0].content,/不得联网/u);
  assert.match(messages[0].content,/evidenceId/u);
  assert.doesNotMatch(serialized,/secret-provider-key/u);
  assert.match(messages[1].content,/套餐价格调整为 12 元/u);
});

test('Researcher host materializes exact frozen provenance instead of trusting model hashes',async()=>{
  const {materializeResearchResult}=await import(workerUrl);
  const result=materializeResearchResult(request(),modelFinding(),{now:()=>new Date('2026-10-21T10:00:00.000Z')});
  assert.deepEqual(result.sources,[{sourceId,url:'https://example.com/release',contentHash:hash,fetchedAt:'2026-10-20T00:00:00.000Z',publishedAt:undefined,authorityTier:'official-primary'}]);
  assert.deepEqual(result.findings[0].evidence,[{sourceId,locator:'{"type":"text","start":0,"end":12}',quoteHash:'b'.repeat(64)}]);
  assert.deepEqual(result.usage,{searchQueries:0,documentsRead:0,deepResearchJobs:1});
});

test('Researcher host preserves an atomic fact separately from the news source record',async()=>{
  const {materializeResearchResult}=await import(workerUrl);
  const input=request();
  input.knownSourceVersions[0].publishedAt='2026-10-19T08:00:00.000Z';
  const result=materializeResearchResult(input,modelFactFinding(),{now:()=>new Date('2026-10-21T10:00:00.000Z')});
  assert.equal(result.findings[0].kind,'fact');
  assert.deepEqual(result.findings[0].fact,{subject:'示例套餐',dimensionKey:'pricing',dimensionLabel:'价格',predicateKey:'monthly-price',predicateLabel:'月价',valueType:'number',value:12,unit:'CNY/month',occurredAt:null,direction:'decreased',scope:{plan:'pro'}});
  assert.equal(result.sources[0].publishedAt,'2026-10-19T08:00:00.000Z');
  assert.equal(result.findings[0].fact.occurredAt,null,'news publication time must not become the fact occurrence time');
});

test('Researcher host rejects unknown evidence and metric definition drift',async()=>{
  const {materializeResearchResult}=await import(workerUrl);
  const unknown=modelFinding();unknown.findings[0].evidenceIds=['99999999-9999-4999-8999-999999999999'];
  assert.throws(()=>materializeResearchResult(request(),unknown),error=>error.code==='RESEARCHER_MODEL_EVIDENCE_UNKNOWN');
  const drift=modelFinding();drift.findings[0].metric.unit='USD';
  assert.throws(()=>materializeResearchResult(request(),drift),error=>error.code==='RESEARCHER_MODEL_OUTPUT_INVALID');
});

test('DeepSeek Researcher uses JSON mode, fixed endpoint and never retries a failed call',async()=>{
  const {createDeepSeekResearcher}=await import(workerUrl);let calls=0,captured=null;
  const provider=createDeepSeekResearcher({apiKey:'secret-provider-key',fetchImpl:async(url,options)=>{calls+=1;captured={url,options};return response(503,{error:{message:'busy'}});}});
  await assert.rejects(()=>provider.analyze(request()),error=>error.code==='RESEARCHER_PROVIDER_HTTP_503'&&error.retryable===true);
  assert.equal(calls,1);
  assert.equal(captured.url,'https://api.deepseek.com/chat/completions');
  assert.equal(captured.options.headers.authorization,'Bearer secret-provider-key');
  const body=JSON.parse(captured.options.body);
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.equal(body.stream,false);
});

test('DeepSeek Researcher returns a bounded token receipt separately from model output',async()=>{
  const {createDeepSeekResearcher}=await import(workerUrl);
  const provider=createDeepSeekResearcher({apiKey:'secret-provider-key',fetchImpl:async()=>response(200,{model:'deepseek-chat',choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelFinding())}}],usage:{prompt_tokens:120,completion_tokens:80,total_tokens:200}})});
  const analyzed=await provider.analyze(request());
  assert.equal(analyzed.output.status,'completed');
  assert.deepEqual(analyzed.receipt,{model:'deepseek-chat',promptTokens:120,completionTokens:80,totalTokens:200,finishReason:'stop'});
});

test('DeepSeek Researcher rejects a success response without a trustworthy usage receipt',async()=>{
  const {createDeepSeekResearcher}=await import(workerUrl);
  const provider=createDeepSeekResearcher({apiKey:'secret-provider-key',fetchImpl:async()=>response(200,{model:'deepseek-chat',choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelFinding())}}]})});
  await assert.rejects(()=>provider.analyze(request()),error=>error.code==='RESEARCHER_PROVIDER_RESPONSE_INVALID'&&error.retryable===true);
});

test('Researcher worker claims once and posts a host-built result to the platform',async()=>{
  const {createResearcherWorker}=await import(workerUrl);const calls=[];
  const job={id:jobId,attemptId,request:request(),providerCall:{provider:'deepseek-researcher',model:'deepseek-chat',status:'reserved',estimatedUsage:{billableRequests:1,costUsdMicros:20000}}};
  const fetchImpl=async(url,options)=>{calls.push({url,options});if(url.endsWith('/claim'))return response(200,{data:job});if(url.endsWith('/sent'))return response(200,{data:{status:'leased'}});if(url.endsWith('/complete'))return response(200,{data:{status:'completed'}});throw new Error(`unexpected ${url}`);};
  const provider={analyze:async()=>({output:modelFinding(),receipt:{model:'deepseek-chat',promptTokens:120,completionTokens:80,totalTokens:200,finishReason:'stop'}})};
  const config={platformUrl:'http://api:3090',workerToken:'w'.repeat(32),workerId:'worker-1',providerId:'deepseek-researcher',model:'deepseek-chat',leaseSeconds:300,heartbeatSeconds:60};
  const result=await createResearcherWorker({config,fetchImpl,provider,now:()=>new Date('2026-10-21T10:00:00.000Z')}).runOnce();
  assert.equal(result.status,'completed');
  assert.equal(calls.length,3);
  assert.match(calls[1].url,/\/sent$/u);
  const complete=JSON.parse(calls[2].options.body);
  assert.equal(complete.attemptId,attemptId);
  assert.equal(complete.result.findings[0].evidence[0].quoteHash,'b'.repeat(64));
  assert.equal(complete.providerReceipt.totalTokens,200);
  assert.equal(calls[0].options.headers.authorization,`Bearer ${'w'.repeat(32)}`);
});

test('Researcher worker records a terminal failure without retrying the provider',async()=>{
  const {createResearcherWorker,ResearcherWorkerError}=await import(workerUrl);const calls=[];let providerCalls=0;
  const job={id:jobId,attemptId,request:request(),providerCall:{provider:'deepseek-researcher',model:'deepseek-chat',status:'reserved',estimatedUsage:{billableRequests:1,costUsdMicros:20000}}};
  const fetchImpl=async(url,options)=>{calls.push({url,options});if(url.endsWith('/claim'))return response(200,{data:job});if(url.endsWith('/sent'))return response(200,{data:{status:'leased'}});if(url.endsWith('/fail'))return response(200,{data:{status:'failed'}});throw new Error(`unexpected ${url}`);};
  const provider={analyze:async()=>{providerCalls+=1;throw new ResearcherWorkerError('RESEARCHER_PROVIDER_UNCERTAIN','状态未知；未自动重试。',{retryable:true,statusCode:504});}};
  const config={platformUrl:'http://api:3090',workerToken:'w'.repeat(32),workerId:'worker-1',providerId:'deepseek-researcher',model:'deepseek-chat',leaseSeconds:300,heartbeatSeconds:60};
  const result=await createResearcherWorker({config,fetchImpl,provider}).runOnce();
  assert.equal(result.status,'failed');
  assert.equal(providerCalls,1);
  assert.equal(calls.length,3);
  const failure=JSON.parse(calls[2].options.body);
  assert.equal(failure.code,'RESEARCHER_PROVIDER_UNCERTAIN');
  assert.equal(failure.retryable,true);
});

test('Researcher worker never marks sent or calls the provider when the reservation does not match',async()=>{
  const {createResearcherWorker}=await import(workerUrl);const calls=[];let providerCalls=0;
  const job={id:jobId,attemptId,request:request(),providerCall:{provider:'deepseek-researcher',model:'different-model',status:'reserved',estimatedUsage:{billableRequests:1,costUsdMicros:20000}}};
  const fetchImpl=async(url,options)=>{calls.push({url,options});if(url.endsWith('/claim'))return response(200,{data:job});if(url.endsWith('/fail'))return response(200,{data:{status:'failed'}});throw new Error(`unexpected ${url}`);};
  const provider={analyze:async()=>{providerCalls+=1;return{output:modelFinding(),receipt:{model:'deepseek-chat',promptTokens:120,completionTokens:80,totalTokens:200,finishReason:'stop'}};}};
  const config={platformUrl:'http://api:3090',workerToken:'w'.repeat(32),workerId:'worker-1',providerId:'deepseek-researcher',model:'deepseek-chat',leaseSeconds:300,heartbeatSeconds:60};
  const result=await createResearcherWorker({config,fetchImpl,provider}).runOnce();
  assert.equal(result.status,'failed');
  assert.equal(result.error.code,'RESEARCHER_PROVIDER_RESERVATION_INVALID');
  assert.equal(providerCalls,0);
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/\/fail$/u);
  assert.equal(JSON.parse(calls[1].options.body).retryable,false);
  assert.doesNotMatch(calls.map(item=>item.url).join('\n'),/\/sent$/u);
});
