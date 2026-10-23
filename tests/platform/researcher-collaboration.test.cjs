const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const moduleUrl=file=>pathToFileURL(path.join(root,'apps/api/src',file));
const topicId='11111111-1111-4111-8111-111111111111';
const gapId='22222222-2222-4222-8222-222222222222';
const jobId='33333333-3333-4333-8333-333333333333';
const attemptId='44444444-4444-4444-8444-444444444444';
const sourceId='55555555-5555-4555-8555-555555555555';
const versionId='66666666-6666-4666-8666-666666666666';
const evidenceId='77777777-7777-4777-8777-777777777777';
const claimId='88888888-8888-4888-8888-888888888888';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function repository(){
  const gap={id:gapId,topicId,question:'竞争对手的定价是否变化？',reason:'现有证据只有发布说明。',priority:'important',status:'open',origin:'user'};
  const contract={questions:['竞争对手的定价是否变化？'],budget:{maxSearchQueriesPerRun:3,maxDocumentsPerRun:10,maxDeepResearchJobsPerRun:1}};
  return{
    provider:'deepseek-researcher',providerModel:'deepseek-chat',queued:null,applied:null,benchmarkCases:[],
    topicContext:async()=>({id:topicId,current_contract_version:2,contract_json:contract}),
    ensureContractGaps:async()=>true,
    listGaps:async()=>[gap],
    createGap:async(_user,_topic,input)=>({...gap,...input}),
    getGap:async()=>gap,
    evidencePack:async()=>[{evidence_id:evidenceId,source_id:sourceId,version_id:versionId,canonical_url:'https://example.com/release',content_hash:hash('document'),fetched_at:'2026-10-20T00:00:00.000Z',quote_hash:hash('quote'),quote_text:'价格从 10 元调整为 12 元。',locator:{type:'text',start:0,end:15},evidence_kind:'direct-quote',authority_tier:'official-primary'}],
    ensureBuiltInMethod:async()=>true,
    listMethodTemplates:async()=>[{id:attemptId,topicId,methodVersion:'direct-observation-v1',label:'直接证据观察',description:'只记录冻结证据直接支持的值。',methodKind:'direct-observation',rules:{evidenceKinds:['direct-quote','structured-fact'],authorityTiers:['official-primary'],requiredDimensions:[],missingValuePolicy:'unknown',comparisonPolicy:'same-method-unit',aggregation:'none',instructions:'只记录直接证据。'},status:'active'}],
    createMethodTemplate:async function(_user,_topic,input){this.methodTemplate=input;return{...input,topicId,status:'active'};},retireMethodTemplate:async()=>({status:'retired',method:{id:attemptId,status:'retired'}}),
    metricDefinitions:async()=>[],getMetricDefinition:async()=>null,
    queueJob:async function(_user,_topic,_gap,input){this.queued=input;return{status:'queued',job:{id:input.id,status:'queued'}};},
    localNodes:[{id:attemptId,label:'test node',provider:'deepseek-researcher',model:'deepseek-chat',status:'active',firstSeenAt:null,lastSeenAt:null,createdAt:'2026-10-21T00:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z'}],
    hasActiveLocalNode:async function(){return this.localNodes.some(item=>item.status==='active');},
    listLocalNodes:async function(){return this.localNodes;},
    createLocalNode:async function(_user,input){const node={id:input.id,label:input.label,provider:input.provider,model:input.model,status:'active',firstSeenAt:null,lastSeenAt:null,createdAt:'2026-10-21T00:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z',tokenHash:input.tokenHash};this.localNodes.unshift(node);return node;},
    revokeLocalNode:async function(_user,nodeId){const node=this.localNodes.find(item=>item.id===nodeId);if(!node)return{status:'missing'};node.status='revoked';return{status:'revoked',node};},
    authenticateLocalNode:async function(tokenHash){const node=this.localNodes.find(item=>item.tokenHash===tokenHash&&item.status==='active');return node?{...node,userId:'user'}:null;},
    touchLocalNode:async function(nodeId){const node=this.localNodes.find(item=>item.id===nodeId&&item.status==='active');if(!node)return null;node.lastSeenAt='2026-10-21T00:01:00.000Z';return node;},
    assertLocalLease:async()=>true,claimNextLocalNode:async()=>null,
    cancelQueuedJob:async()=>({status:'cancelled',job:{id:jobId,status:'cancelled',providerCall:{status:'skipped'}}}),
    listJobs:async()=>[],listClaims:async()=>[],listFactRows:async()=>[],claimNext:async()=>null,heartbeat:async()=>null,failJob:async()=>null,getWorkerRuntime:async()=>({status:'online',lastSeenAt:'2026-10-21T00:00:00.000Z',staleAfterSeconds:240}),
    getClaimDetail:async()=>({id:claimId,topicId,status:'accepted',currentRevision:2,revisions:[],reviews:[]}),listClaimReviewSignals:async()=>[{id:attemptId,topicId,claimId,revision:2,type:'stale',severity:'important',reason:'超过复核周期。',claimTitle:'价格发生变化',relatedClaimId:null,relatedClaimTitle:null,detectedAt:'2026-10-21T00:00:00.000Z',resolution:null}],resolveClaimReviewSignal:async function(_user,_signal,input){this.signalResolution=input;return{status:'resolved'};},listMetricSeries:async()=>[],
    listMetricViews:async()=>[],createMetricView:async function(_user,_topic,input){this.metricView=input;return{...input,topicId,createdAt:'2026-10-21T00:00:00.000Z',updatedAt:'2026-10-21T00:00:00.000Z'};},deleteMetricView:async function(){this.metricViewDeleted=true;return true;},qualitySummary:async()=>({accepted_claims:4,evidence_backed_claims:4,accepted_critical_claims:1,primary_backed_critical_claims:1,active_metric_observations:3,traceable_metric_observations:3,tracked_sources:2,evidence_records:8,event_clusters:3,single_source_event_clusters:1,multi_source_event_clusters:2,primary_backed_event_clusters:2,event_clusters_with_opposition:1,event_cluster_attention:[{id:attemptId,title:'价格变化',occurredDay:'2026-10-20',memberCount:2,sourceCount:2,officialPrimarySourceCount:1,supportingEvidenceCount:1,opposingEvidenceCount:1,reason:'opposition-present'}],open_review_signals:1,pending_quality_samples:0,passed_quality_samples:0,failed_quality_samples:0,passed_fact_samples:0,failed_fact_samples:0,passed_coverage_samples:0,failed_coverage_samples:0,open_quality_corrections:0,corrected_quality_samples:0,dismissed_quality_samples:0}),getExternalBenchmarkSummary:async function(){const counts={total:this.benchmarkCases.length,pending:0,detected:0,missed:0,excluded:0};for(const item of this.benchmarkCases)counts[item.status]+=1;return counts;},listExternalBenchmarkCases:async function(){return this.benchmarkCases;},createExternalBenchmarkCase:async function(_user,_topic,input){const existing=this.benchmarkCases.find(item=>item.inputSha256===input.inputSha256);if(existing)return{created:false,case:existing};const item={...input,topicId,status:'pending',review:null};this.benchmarkCases.push(item);return{created:true,case:item};},reviewExternalBenchmarkCase:async function(_user,_topic,caseId,input){const item=this.benchmarkCases.find(value=>value.id===caseId);if(!item)return{status:'missing'};if(item.status!=='pending')return{status:'already_reviewed'};if(input.decision==='detected'&&input.matchedEventId!==attemptId)return{status:'event_missing'};item.status=input.decision;item.review={id:input.reviewId,decision:input.decision,matchedEventId:input.matchedEventId,note:input.note};return{status:'reviewed',case:item};},listQualityCandidates:async()=>[{targetId:claimId,targetType:'claim',targetRevision:2,target:{title:'价格变化结论'}},{targetId:evidenceId,targetType:'metric-observation',targetRevision:1,target:{title:'价格指标',evidence:{url:'https://example.com/release'}}},{targetId:versionId,targetType:'source-version-diff',targetRevision:2,target:{title:'版本变化',url:'https://example.com/release',eventCount:1,currentExcerpt:'新版本',previousExcerpt:'旧版本'}}],listQualitySamples:async function(){return this.qualitySamples||[];},createQualitySamples:async function(_user,_topic,samples){this.qualitySamples=this.qualitySamples||[];const existing=this.qualitySamples.filter(item=>item.periodKey===samples[0].periodKey&&item.sampleKind===samples[0].sampleKind);if(existing.length)return existing;const created=samples.map(sample=>({...sample,topicId,status:'pending',sampledAt:'2026-10-21T00:00:00.000Z',reviewedAt:null,review:null,correctionResolution:null}));this.qualitySamples.push(...created);return created;},reviewQualitySample:async function(_user,_topic,sampleId,input){const sample=(this.qualitySamples||[]).find(item=>item.id===sampleId);if(!sample)return{status:'missing'};if(sample.status!=='pending')return{status:'already_reviewed'};sample.status=input.decision==='pass'?'passed':'failed';sample.review={id:input.reviewId,decision:input.decision,note:input.note,correctionGapId:input.decision==='fail'?input.gapId:null};return{status:'reviewed',sample};},resolveQualityCorrection:async function(_user,_topic,sampleId,input){if(this.correctionStatus)return{status:this.correctionStatus};const sample=(this.qualitySamples||[]).find(item=>item.id===sampleId);if(!sample)return{status:'missing'};if(sample.status!=='failed')return{status:'not_failed'};if(sample.correctionResolution)return{status:'already_resolved'};sample.correctionResolution={id:input.resolutionId,decision:input.decision,note:input.note,replacementTargetId:input.decision==='corrected'?sample.targetId:null,replacementTargetRevision:input.decision==='corrected'?sample.targetRevision+1:null};return{status:'resolved',sample};},listDerivedMetrics:async function(){return this.derivedMetric?[this.derivedMetric]:[];},createDerivedMetric:async function(_user,_topic,input){this.derivedMetric={...input,topicId,left:{...input.left,id:'left-id',label:'左指标',canonicalUnit:'s'},right:{...input.right,id:'right-id',label:'右指标',canonicalUnit:'s'},createdAt:'2026-10-21T00:00:00.000Z'};return this.derivedMetric;},
    reviewClaim:async function(_user,_topic,_claim,input){this.reviewed=input;return{status:'reviewed'};},
    validationContext:async()=>({job:{id:jobId,topic_id:topicId,contract_version:2,contract_json:contract,request_json:{methodTemplates:[{id:attemptId,methodVersion:'direct-observation-v1',label:'直接证据观察',description:'只记录冻结证据直接支持的值。',methodKind:'direct-observation',rules:{evidenceKinds:['direct-quote','structured-fact'],authorityTiers:['official-primary'],requiredDimensions:[],missingValuePolicy:'unknown',comparisonPolicy:'same-method-unit',aggregation:'none',instructions:'只记录直接证据。'}}],metricDefinitions:[],knownSourceVersions:[{sourceId,sourceVersionId:versionId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],evidence:[{evidenceId,sourceId,sourceVersionId:versionId,url:'https://example.com/release',contentHash:hash('document'),quoteHash:hash('quote'),kind:'direct-quote',authorityTier:'official-primary'}] }},versions:[{source_id:sourceId,content_hash:hash('document'),canonical_url:'https://example.com/release',fetched_at:'2026-10-20T00:00:00.000Z',authority_tier:'official-primary'}],evidence:[{id:evidenceId,source_id:sourceId,quote_hash:hash('quote')}]}),
    applyResult:async function(_job,_attempt,result,_resultHash,validated){this.applied={result,validated};return{status:'completed',claimsApplied:validated.findings.length,gapsAdded:validated.unresolved.length};},
  };
}

test('Researcher remains fail-closed until a compatible worker is configured',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.localNodes=[];repo.accountCapacity=async()=>({queued:3,active:1});
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,maxActiveJobsPerAccount:2});
  const capabilities=await service.capabilities({userId:'user'},topicId);
  assert.equal(capabilities.workerAvailable,false);
  assert.deepEqual(capabilities.workerRuntime,{configured:false,status:'disabled',lastSeenAt:null,staleAfterSeconds:240});
  assert.deepEqual(capabilities.queueCapacity,{scope:'account',queued:3,active:1,maxActive:2,availableSlots:1});
  await assert.rejects(()=>service.queueJob({userId:'user'},topicId,gapId),error=>error.code==='RESEARCHER_LOCAL_NODE_REQUIRED'&&error.statusCode===409);
});

test('Researcher capability distinguishes local-node enrollment from recent runtime presence',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.accountCapacity=async()=>({queued:0,active:0});repo.localNodes[0].lastSeenAt='2020-10-20T23:50:00.000Z';
  const capabilities=await createResearcherCollaborationService({repository:repo}).capabilities({userId:'user'},topicId);
  assert.equal(capabilities.workerAvailable,true);
  assert.deepEqual(capabilities.workerRuntime,{configured:true,status:'stale',lastSeenAt:'2020-10-20T23:50:00.000Z',staleAfterSeconds:240});
  assert.match(capabilities.disclaimer,/本地节点已离线/u);
});

test('Local Researcher node reveals its secret once and authenticates by digest',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.localNodes=[];
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId});
  const created=await service.createLocalNode({userId:'user'},{label:'study PC'});
  assert.match(created.enrollmentToken,/^mrn_[A-Za-z0-9_-]{40,}$/u);
  assert.equal(repo.localNodes[0].tokenHash,crypto.createHash('sha256').update(created.enrollmentToken).digest('hex'));
  const authenticated=await service.authenticateLocalNode(`Bearer ${created.enrollmentToken}`);
  assert.equal(authenticated.userId,'user');
  assert.equal((await service.localNodeHealth(authenticated)).status,'online');
  await service.revokeLocalNode({userId:'user'},created.id);
  await assert.rejects(()=>service.authenticateLocalNode(`Bearer ${created.enrollmentToken}`),error=>error.code==='RESEARCHER_LOCAL_NODE_AUTH_REQUIRED');
});

test('Researcher instance health is read-only, provider-bound and does not refresh presence',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();let input=null;repo.getWorkerHealth=async(...args)=>{input=args;return{healthy:false,status:'stale',state:'polling',lastSeenAt:'2026-10-21T00:00:00.000Z',staleAfterSeconds:180};};
  const health=await createResearcherCollaborationService({repository:repo,workerEnabled:true}).workerHealth('worker-1',{provider:'deepseek-researcher',model:'deepseek-chat',staleAfterSeconds:180});
  assert.equal(health.status,'stale');
  assert.deepEqual(input,['worker-1',{provider:'deepseek-researcher',model:'deepseek-chat',staleAfterSeconds:180}]);
  await assert.rejects(()=>createResearcherCollaborationService({repository:repo}).workerHealth('',{provider:'deepseek-researcher',model:'deepseek-chat'}),error=>error.code==='RESEARCHER_WORKER_HEALTH_INVALID');
});

test('Researcher claims receive the configured account concurrency limit',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();let claimArguments=null;repo.claimNext=async(...args)=>{claimArguments=args;return null;};
  const service=createResearcherCollaborationService({repository:repo,ids:()=>attemptId,workerEnabled:true,maxActiveJobsPerAccount:4,maxActiveJobsGlobal:9});
  await service.claimNext('worker-a',{leaseSeconds:90});
  assert.deepEqual(claimArguments,['worker-a',attemptId,90,4,9]);
});

test('structural quality keeps empty samples unknown instead of claiming perfect coverage',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();
  repo.qualitySummary=async()=>({accepted_claims:0,evidence_backed_claims:0,accepted_critical_claims:0,primary_backed_critical_claims:0,active_metric_observations:0,traceable_metric_observations:0,tracked_sources:0,evidence_records:0,open_review_signals:0,pending_quality_samples:0,passed_quality_samples:0,failed_quality_samples:0});
  const summary=await createResearcherCollaborationService({repository:repo}).qualitySummary({userId:'user'},topicId);
  assert.equal(summary.claims.evidenceCoverageRate,null);
  assert.equal(summary.criticalClaims.primaryCoverageRate,null);
  assert.equal(summary.metrics.traceabilityRate,null);
  assert.equal(summary.structuralGate.evaluated,false);
  assert.equal(summary.structuralGate.passed,false);
});

test('structural quality separates exact event-cluster source coverage from factual truth',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const summary=await createResearcherCollaborationService({repository:repository()}).qualitySummary({userId:'user'},topicId);
  assert.deepEqual(summary.eventClusters,{total:3,singleSource:1,multiSource:2,primaryBacked:2,withOpposition:1,multiSourceRate:2/3,attention:[{id:attemptId,title:'价格变化',occurredDay:'2026-10-20',memberCount:2,sourceCount:2,officialPrimarySourceCount:1,supportingEvidenceCount:1,opposingEvidenceCount:1,reason:'opposition-present'}]});
  assert.match(summary.caveats.join('\n'),/不证明来源相互独立/u);
});

test('external benchmark stays human-curated, idempotent and cannot be presented as global recall',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,validateSourceUrl:async value=>new URL(value)});
  const input={title:'外部审计发现一次价格调整',occurredAt:'2026-10-20T10:00:00.000Z',sourceUrl:'https://audit.example/cases/price',sourceKind:'external-audit',importance:'important',provenanceNote:'由独立审计员按月整理并在平台外冻结。'};
  const first=await service.createExternalBenchmarkCase({userId:'user'},topicId,input);
  const duplicate=await service.createExternalBenchmarkCase({userId:'user'},topicId,input);
  assert.equal(first.created,true);
  assert.equal(duplicate.created,false);
  assert.equal(first.case.id,duplicate.case.id);
  let summary=await service.qualitySummary({userId:'user'},topicId);
  assert.equal(summary.externalBenchmark.detectionRate,null);
  assert.equal(summary.externalBenchmark.independenceVerified,false);
  assert.match(summary.caveats.join('\n'),/不能外推为全网召回率/u);
  await assert.rejects(()=>service.reviewExternalBenchmarkCase({userId:'user'},topicId,first.case.id,{decision:'detected',note:'没有绑定雷达事件，因此不能算作已检出。'}),error=>error.code==='RESEARCH_BENCHMARK_REVIEW_INVALID');
  await assert.rejects(()=>service.reviewExternalBenchmarkCase({userId:'user'},topicId,first.case.id,{decision:'detected',matchedEventId:claimId,note:'绑定了不属于本专题事件集合的标识。'}),error=>error.code==='RESEARCH_BENCHMARK_EVENT_NOT_FOUND');
  const reviewed=await service.reviewExternalBenchmarkCase({userId:'user'},topicId,first.case.id,{decision:'detected',matchedEventId:attemptId,note:'已核对发生时间、标题与归档证据，确认同一事件。'});
  assert.equal(reviewed.status,'detected');
  await assert.rejects(()=>service.reviewExternalBenchmarkCase({userId:'user'},topicId,first.case.id,{decision:'missed',note:'尝试覆盖已经完成的不可变审核记录。'}),error=>error.code==='RESEARCH_BENCHMARK_REVIEWED');
  summary=await service.qualitySummary({userId:'user'},topicId);
  assert.equal(summary.externalBenchmark.detectionRate,1);
  assert.equal(summary.externalBenchmark.detected,1);
});

test('quality sampling is deterministic, bounded and opens a correction gap only after a failed human review',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo});
  const samples=await service.generateQualitySamples({userId:'user'},topicId,{periodKey:'2020-01',sampleSize:2});
  assert.equal(samples.length,2);
  assert.ok(samples[0].selectionHash<samples[1].selectionHash);
  assert.equal(samples.every(item=>item.status==='pending'),true);
  assert.equal(samples.every(item=>item.sampleKind==='facts'&&item.targetType!=='source-version-diff'),true);
  const coverageSamples=await service.generateQualitySamples({userId:'user'},topicId,{periodKey:'2020-01',sampleKind:'coverage',sampleSize:2});
  assert.equal(coverageSamples.length,1);
  assert.equal(coverageSamples[0].sampleKind,'coverage');
  assert.equal(coverageSamples[0].targetType,'source-version-diff');
  assert.deepEqual((await service.generateQualitySamples({userId:'user'},topicId,{periodKey:'2020-01',sampleKind:'coverage',sampleSize:2})).map(item=>item.id),coverageSamples.map(item=>item.id));
  await assert.rejects(()=>service.generateQualitySamples({userId:'user'},topicId,{periodKey:'9999-01',sampleSize:2}),error=>error.code==='RESEARCH_QUALITY_SAMPLE_INVALID');
  await assert.rejects(()=>service.generateQualitySamples({userId:'user'},topicId,{periodKey:'2020-01',sampleSize:21}),error=>error.code==='RESEARCH_QUALITY_SAMPLE_INVALID');
  await assert.rejects(()=>service.generateQualitySamples({userId:'user'},topicId,{periodKey:'2020-01',sampleKind:'mixed',sampleSize:2}),error=>error.code==='RESEARCH_QUALITY_SAMPLE_INVALID');
  const failed=await service.reviewQualitySample({userId:'user'},topicId,samples[0].id,{decision:'fail',note:'证据与页面当前内容不一致，需要重新核验。'});
  assert.equal(failed.status,'failed');
  assert.ok(failed.review.correctionGapId);
  const passed=await service.reviewQualitySample({userId:'user'},topicId,samples[1].id,{decision:'pass',note:'已独立核对原始页面、时间和引用位置。'});
  assert.equal(passed.status,'passed');
  assert.equal(passed.review.correctionGapId,null);
  await assert.rejects(()=>service.reviewQualitySample({userId:'user'},topicId,samples[0].id,{decision:'pass',note:'尝试覆盖已经完成的审核决定。'}),error=>error.code==='RESEARCH_QUALITY_SAMPLE_REVIEWED');
  await assert.rejects(()=>service.resolveQualityCorrection({userId:'user'},topicId,samples[0].id,{decision:'corrected',note:'短'}),error=>error.code==='RESEARCH_QUALITY_CORRECTION_INVALID');
  repo.correctionStatus='not_ready';
  await assert.rejects(()=>service.resolveQualityCorrection({userId:'user'},topicId,samples[0].id,{decision:'corrected',note:'纠正研究已经开始，但还没有形成替代记录。'}),error=>error.code==='RESEARCH_QUALITY_CORRECTION_NOT_READY');
  repo.correctionStatus=null;
  const corrected=await service.resolveQualityCorrection({userId:'user'},topicId,samples[0].id,{decision:'corrected',note:'已完成复核研究并验收了更新后的替代结论。'});
  assert.equal(corrected.correctionResolution.decision,'corrected');
  assert.equal(corrected.correctionResolution.replacementTargetRevision,corrected.targetRevision+1);
  await assert.rejects(()=>service.resolveQualityCorrection({userId:'user'},topicId,samples[0].id,{decision:'dismissed',note:'尝试覆盖已经保存的纠正确认决定。'}),error=>error.code==='RESEARCH_QUALITY_CORRECTION_RESOLVED');
  await assert.rejects(()=>service.resolveQualityCorrection({userId:'user'},topicId,samples[1].id,{decision:'dismissed',note:'通过样本不能被标记为无需纠正。'}),error=>error.code==='RESEARCH_QUALITY_CORRECTION_NOT_FAILED');
});

test('Researcher job freezes the exact gap and bounded platform evidence without provider credentials',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  await service.queueJob({userId:'user'},topicId,gapId);
  assert.deepEqual(repo.queued.request.gap,{gapId,question:'竞争对手的定价是否变化？',reason:'现有证据只有发布说明。',priority:'important'});
  assert.equal(repo.queued.request.evidence.length,1);
  assert.equal(repo.queued.request.methodTemplates[0].methodVersion,'direct-observation-v1');
  assert.deepEqual(repo.queued.request.metricDefinitions,[]);
  assert.equal(repo.queued.request.knownSourceVersions[0].authorityTier,'official-primary');
  assert.equal(JSON.stringify(repo.queued.request).includes('apiKey'),false);
});

test('a completed observation run automatically queues only its frozen news evidence for analysis',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),runId=attemptId;
  repo.runAnalysisContext=async value=>{assert.equal(value,runId);return{user_id:'user',topic_id:topicId,title:'示例公司',trigger_kind:'scheduled',current_contract_version:2,contract_json:{questions:['示例公司的价格如何变化？'],budget:{maxSearchQueriesPerRun:0,maxDocumentsPerRun:5,maxDeepResearchJobsPerRun:1}}};};
  repo.evidencePackForRun=async(user,topic,run,limit)=>{assert.deepEqual([user,topic,run,limit],['user',topicId,runId,100]);return[{evidence_id:evidenceId,source_id:sourceId,version_id:versionId,canonical_url:'https://example.com/news',content_hash:hash('news-document'),fetched_at:'2026-10-20T01:00:00.000Z',published_at:'2026-10-20T00:00:00.000Z',quote_hash:hash('news-quote'),quote_text:'示例公司宣布套餐月价调整为 12 元。',locator:{kind:'news-article',url:'https://example.com/news'},evidence_kind:'direct-quote',authority_tier:'independent-reputable'}];};
  repo.createAutomaticGap=async(_user,_topic,input)=>({id:gapId,topicId,status:'open',priority:'important',origin:'system',...input});
  const result=await createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true}).queueAutomaticRunAnalysis(runId);
  assert.equal(result.status,'queued');
  assert.equal(repo.queued.request.trigger,'scheduled');
  assert.equal(repo.queued.request.evidence.length,1);
  assert.equal(repo.queued.request.evidence[0].quote,'示例公司宣布套餐月价调整为 12 元。');
  assert.equal(repo.queued.request.knownSourceVersions[0].publishedAt,'2026-10-20T00:00:00.000Z');
  assert.match(repo.queued.request.gap.question,/提取可比较的关键事实/u);
});

test('Researcher queue refuses a provider call when the atomic monthly reservation is over budget',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.queueJob=async()=>({status:'budget_exceeded',reason:'account-provider-cost',budget:{used:990000,requested:20000,limit:1000000,period:'utc-calendar-month'}});
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  await assert.rejects(()=>service.queueJob({userId:'user'},topicId,gapId),error=>error.code==='RESEARCHER_BUDGET_EXCEEDED'&&error.statusCode===409&&/未发送/u.test(error.message));
});

test('Researcher cancellation is limited to unclaimed queued jobs',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,workerEnabled:true});
  const cancelled=await service.cancelJob({userId:'user'},topicId,jobId);
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.providerCall.status,'skipped');
  repo.cancelQueuedJob=async()=>({status:'unavailable',job:{id:jobId,status:'leased'}});
  await assert.rejects(()=>service.cancelJob({userId:'user'},topicId,jobId),error=>error.code==='RESEARCHER_CANCEL_UNAVAILABLE'&&error.statusCode===409);
  repo.cancelQueuedJob=async()=>({status:'missing'});
  await assert.rejects(()=>service.cancelJob({userId:'user'},topicId,jobId),error=>error.code==='RESEARCHER_NOT_FOUND'&&error.statusCode===404);
});

test('Researcher exposes and enforces the shared provider circuit before queuing or sending',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();
  repo.accountCapacity=async()=>({queued:0,active:0});
  repo.getProviderCircuitStatus=async()=>({provider:'deepseek-researcher',state:'open',consecutiveFailures:3,retryAt:'2026-10-21T00:05:00.000Z'});
  repo.queueJob=async()=>({status:'circuit_open',circuit:await repo.getProviderCircuitStatus()});
  repo.markSent=async()=>({status:'circuit_open',circuit:await repo.getProviderCircuitStatus()});
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const capabilities=await service.capabilities({userId:'user'},topicId);
  assert.equal(capabilities.providerCircuit.state,'open');
  await assert.rejects(()=>service.queueJob({userId:'user'},topicId,gapId),error=>error.code==='RESEARCHER_PROVIDER_CIRCUIT_OPEN'&&error.statusCode===503&&/2026-10-21T00:05:00.000Z/u.test(error.message));
  await assert.rejects(()=>service.markSent(jobId,{attemptId}),error=>error.code==='RESEARCHER_PROVIDER_CIRCUIT_OPEN'&&error.statusCode===503);
});

test('Researcher result accepts only frozen sources, verified evidence and in-budget usage',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const base={protocol:'research-result-v1',jobId,topicId,contractVersion:2,status:'completed',finishedAt:'2026-10-20T01:00:00.000Z',sources:[{sourceId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],findings:[{findingId:'pricing-change',kind:'claim',title:'价格发生变化',summary:'官方页面显示价格从 10 元调整为 12 元。',importance:'important',confidence:0.9,evidence:[{sourceId,locator:'文本 0-15',quoteHash:hash('quote')}]}],unresolvedQuestions:[],usage:{searchQueries:1,documentsRead:1,deepResearchJobs:1}};
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,sources:[{...base.sources[0],url:'https://attacker.example/'}]}}),error=>error.code==='RESEARCHER_SOURCE_UNVERIFIED');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],evidence:[{sourceId,locator:'x',quoteHash:hash('invented')}]}]}}),error=>error.code==='RESEARCHER_EVIDENCE_UNVERIFIED');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,usage:{...base.usage,searchQueries:4}}}),error=>error.code==='RESEARCHER_BUDGET_EXCEEDED');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,finishedAt:'not-a-date'}}),error=>error.code==='RESEARCHER_RESULT_INVALID');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[]}}),error=>error.code==='RESEARCHER_RESULT_INVALID');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,usage:{...base.usage,deepResearchJobs:0}}}),error=>error.code==='RESEARCHER_USAGE_INVALID');
  const accepted=await service.complete(jobId,{attemptId,result:base});
  assert.equal(accepted.claimsApplied,1);
  assert.deepEqual(repo.applied.validated.findings[0].evidenceIds,[evidenceId]);
});

test('Researcher result validates and persists a structured fact independently of its article metadata',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const fact={subject:'示例套餐',dimensionKey:'pricing',dimensionLabel:'价格',predicateKey:'monthly-price',predicateLabel:'月价',valueType:'number',value:12,unit:'CNY/month',occurredAt:null,direction:'decreased',scope:{plan:'pro'}};
  const result={protocol:'research-result-v1',jobId,topicId,contractVersion:2,status:'completed',finishedAt:'2026-10-20T01:00:00.000Z',sources:[{sourceId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],findings:[{findingId:'pricing-fact',kind:'fact',title:'套餐月价下降',summary:'官方页面记录月价为 12 元。',importance:'important',confidence:0.95,fact,evidence:[{sourceId,locator:'文本 0-15',quoteHash:hash('quote')}]}],unresolvedQuestions:[],usage:{searchQueries:0,documentsRead:1,deepResearchJobs:1}};
  const accepted=await service.complete(jobId,{attemptId,result});
  assert.equal(accepted.claimsApplied,1);
  assert.deepEqual(repo.applied.validated.findings[0].fact,fact);
  const firstStableKey=repo.applied.validated.findings[0].stableKey;
  await service.complete(jobId,{attemptId,result:{...result,findings:[{...result.findings[0],findingId:'another-model-label-for-the-same-fact'}]}});
  assert.equal(repo.applied.validated.findings[0].stableKey,firstStableKey,'same atomic fact must merge even when the model chooses another findingId');
  const invalid={...result,findings:[{...result.findings[0],fact:{...fact,occurredAt:'not-a-date'}}]};
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:invalid}),error=>error.code==='RESEARCHER_FACT_INVALID');
});

test('fact timeline groups only accepted structured facts and keeps unknown time out of change math',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),fact=(value,occurredAt,direction)=>({subject:'专业版',dimensionKey:'pricing',dimensionLabel:'价格',predicateKey:'monthly-price',predicateLabel:'月价',valueType:'number',value,unit:'CNY/month',occurredAt,direction,scope:{plan:'pro'}});
  repo.listFactRows=async(_user,_topic,filters)=>{
    assert.deepEqual(filters,{subject:'专业版',dimensionKey:'pricing',predicateKey:'monthly-price',scopeKey:'plan',scopeValue:'pro',from:'2026-01-01T00:00:00.000Z',to:'2026-12-31T00:00:00.000Z',limit:50});
    return[
      {claim_id:claimId,revision:1,accepted_at:'2026-02-01T00:00:00.000Z',title:'一月价格',confidence:0.9,fact_json:fact(20,'2026-01-15T00:00:00.000Z','unknown'),evidence_url:'https://example.com/a',evidence_content_hash:hash('a'),evidence_authority_tier:'official-primary'},
      {claim_id:attemptId,revision:1,accepted_at:'2026-04-01T00:00:00.000Z',title:'三月价格',confidence:0.95,fact_json:fact(15,'2026-03-15T00:00:00.000Z','decreased'),evidence_url:'https://example.com/b',evidence_content_hash:hash('b'),evidence_authority_tier:'official-primary'},
      {claim_id:jobId,revision:1,accepted_at:'2026-05-01T00:00:00.000Z',title:'时间未知的价格',confidence:0.7,fact_json:fact(99,null,'unknown'),evidence_url:'https://example.com/c',evidence_content_hash:hash('c'),evidence_authority_tier:'community'},
    ];
  };
  const service=createResearcherCollaborationService({repository:repo}),timeline=await service.factTimeline({userId:'user'},topicId,{subject:'专业版',dimensionKey:'pricing',predicateKey:'monthly-price',scopeKey:'plan',scopeValue:'pro',from:'2026-01-01T00:00:00Z',to:'2026-12-31T00:00:00Z',limit:50});
  assert.equal(timeline.schemaVersion,'research-fact-timeline-v1');
  assert.equal(timeline.series.length,1);
  assert.deepEqual(timeline.series[0].summary,{observationCount:3,knownTimeCount:2,unknownTimeCount:1,uniqueValueCount:3,firstKnown:{claimId,revision:1,occurredAt:'2026-01-15T00:00:00.000Z',value:20,evidence:{url:'https://example.com/a',contentHash:hash('a'),authorityTier:'official-primary'}},latestKnown:{claimId:attemptId,revision:1,occurredAt:'2026-03-15T00:00:00.000Z',value:15,evidence:{url:'https://example.com/b',contentHash:hash('b'),authorityTier:'official-primary'}},absoluteChange:-5,relativeChangePercent:-25,direction:'decreased',missingIsZero:false});
  assert.equal(timeline.unknownTimeExcludedFromChange,true);
  assert.equal(timeline.publicationTimeSubstituted,false);
  await assert.rejects(()=>service.factTimeline({userId:'user'},topicId,{scopeKey:'plan'}),error=>error.code==='RESEARCH_FACT_TIMELINE_FILTER_INVALID');
  await assert.rejects(()=>service.factTimeline({userId:'user'},topicId,{from:'2026-12-31T00:00:00Z',to:'2026-01-01T00:00:00Z'}),error=>error.code==='RESEARCH_FACT_TIMELINE_FILTER_INVALID');
});

test('contradiction findings must point to another existing finding id',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const base={protocol:'research-result-v1',jobId,topicId,contractVersion:2,status:'completed',finishedAt:'2026-10-20T01:00:00.000Z',sources:[{sourceId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],findings:[{findingId:'pricing-contradiction',kind:'contradiction',title:'价格证据矛盾',summary:'新页面与既有价格结论不一致。',importance:'important',confidence:0.8,evidence:[{sourceId,locator:'文本 0-15',quoteHash:hash('quote')}]}],unresolvedQuestions:[],usage:{searchQueries:0,documentsRead:1,deepResearchJobs:1}};
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:base}),error=>error.code==='RESEARCHER_FINDING_INVALID');
  await service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],contradictsFindingId:'prior-pricing'}]}});
  assert.equal(repo.applied.validated.findings[0].contradictsFindingId,'prior-pricing');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],contradictsFindingId:'pricing-contradiction'}]}}),error=>error.code==='RESEARCHER_FINDING_INVALID');
});

test('metric findings require a typed, bounded and evidence-backed direct observation',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const base={protocol:'research-result-v1',jobId,topicId,contractVersion:2,status:'completed',finishedAt:'2026-10-20T01:00:00.000Z',sources:[{sourceId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],findings:[{findingId:'monthly-price',kind:'metric',title:'月价',summary:'官方价格为 12 元/月。',importance:'important',confidence:0.9,metric:{metricKey:'plan.price',label:'套餐月价',valueType:'number',value:12,unit:'CNY/month',observedAt:'2026-10-20T00:00:00.000Z',dimensions:{plan:'pro',region:'CN'},methodVersion:'direct-observation-v1'},evidence:[{sourceId,locator:'文本 0-15',quoteHash:hash('quote')}]}],unresolvedQuestions:[],usage:{searchQueries:0,documentsRead:1,deepResearchJobs:1}};
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],metric:undefined}]}}),error=>['RESEARCHER_FINDING_INVALID','RESEARCHER_METRIC_INVALID'].includes(error.code));
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],metric:{...base.findings[0].metric,value:'12'}}]}}),error=>error.code==='RESEARCHER_METRIC_INVALID');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...base,findings:[{...base.findings[0],metric:{...base.findings[0].metric,methodVersion:'invented-v1'}}]}}),error=>error.code==='RESEARCHER_METRIC_METHOD_UNAVAILABLE');
  await service.complete(jobId,{attemptId,result:base});
  assert.equal(repo.applied.validated.findings[0].metric.metricKey,'plan.price');
  assert.deepEqual(repo.applied.validated.findings[0].metric.dimensions,{plan:'pro',region:'CN'});
  assert.equal(repo.applied.validated.findings[0].metric.sourceValue,12);
  assert.equal(repo.applied.validated.findings[0].metric.sourceUnit,'CNY/month');
  assert.equal(repo.applied.validated.findings[0].metric.conversionVersion,'identity-v1');
});

test('existing numeric metrics convert only compatible exact units and preserve source provenance',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),baseContext=repo.validationContext;
  repo.validationContext=async()=>{const context=await baseContext();context.job.request_json.metricDefinitions=[{id:claimId,metricKey:'request.latency',label:'请求耗时',valueType:'number',canonicalUnit:'s',methodVersion:'direct-observation-v1'}];return context;};
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId,workerEnabled:true});
  const metric={metricKey:'request.latency',label:'请求耗时',valueType:'number',value:1500,unit:'ms',observedAt:'2026-10-20T00:00:00.000Z',dimensions:{region:'CN'},methodVersion:'direct-observation-v1'};
  const result={protocol:'research-result-v1',jobId,topicId,contractVersion:2,status:'completed',finishedAt:'2026-10-20T01:00:00.000Z',sources:[{sourceId,url:'https://example.com/release',contentHash:hash('document'),fetchedAt:'2026-10-20T00:00:00.000Z',authorityTier:'official-primary'}],findings:[{findingId:'request-latency',kind:'metric',title:'请求耗时',summary:'官方数据记录请求耗时为 1500 ms。',importance:'important',confidence:0.9,metric,evidence:[{sourceId,locator:'文本 0-15',quoteHash:hash('quote')}]}],unresolvedQuestions:[],usage:{searchQueries:0,documentsRead:1,deepResearchJobs:1}};
  await service.complete(jobId,{attemptId,result});
  const converted=repo.applied.validated.findings[0].metric;
  assert.equal(converted.value,1.5);
  assert.equal(converted.unit,'s');
  assert.equal(converted.sourceValue,1500);
  assert.equal(converted.sourceUnit,'ms');
  assert.equal(converted.conversionVersion,'deterministic-units-v1');
  assert.equal(converted.conversionNumerator,1);
  assert.equal(converted.conversionDenominator,1000);
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...result,findings:[{...result.findings[0],metric:{...metric,unit:'CNY/month'}}]}}),error=>error.code==='RESEARCHER_METRIC_UNIT_INCOMPATIBLE');
  await assert.rejects(()=>service.complete(jobId,{attemptId,result:{...result,findings:[{...result.findings[0],metric:{...metric,unit:'MS'}}]}}),error=>error.code==='RESEARCHER_METRIC_UNIT_INCOMPATIBLE');
});

test('deterministic unit converter keeps decimal and binary storage families distinct',async()=>{
  const {convertMetricUnit,listMetricUnitFamilies}=await import(moduleUrl('metric-unit-conversion.mjs'));
  assert.deepEqual(convertMetricUnit({value:2,sourceUnit:'GiB',targetUnit:'MiB'}),{value:2048,sourceValue:2,sourceUnit:'GiB',targetUnit:'MiB',conversionVersion:'deterministic-units-v1',conversionNumerator:1024,conversionDenominator:1});
  assert.equal(convertMetricUnit({value:1,sourceUnit:'MB',targetUnit:'MiB'}).value,0.95367431640625);
  assert.equal(convertMetricUnit({value:1,sourceUnit:'mb',targetUnit:'MB'}),null);
  assert.equal(convertMetricUnit({value:1,sourceUnit:'CNY',targetUnit:'USD'}),null);
  assert.ok(listMetricUnitFamilies().some(item=>item.unit==='ms'&&item.family==='duration'));
});

test('method templates are immutable versions and constrain new metric observations',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>attemptId});
  const rules={evidenceKinds:['direct-quote'],authorityTiers:['official-primary'],requiredDimensions:['plan'],missingValuePolicy:'unknown',comparisonPolicy:'same-method-unit',aggregation:'none',instructions:'只记录官方页面直接给出的套餐价格。'};
  const created=await service.createMethodTemplate({userId:'user'},topicId,{methodVersion:'official-price-v1',label:'官方套餐价格',description:'固定套餐维度与官方来源。',methodKind:'direct-observation',rules});
  assert.equal(created.methodVersion,'official-price-v1');
  assert.deepEqual(repo.methodTemplate.rules.requiredDimensions,['plan']);
  await assert.rejects(()=>service.createMethodTemplate({userId:'user'},topicId,{methodVersion:'bad-v1',label:'坏模板',description:'错误地把缺失当零。',methodKind:'direct-observation',rules:{...rules,missingValuePolicy:'zero'}}),error=>error.code==='RESEARCH_METHOD_TEMPLATE_INVALID');
  assert.equal((await service.retireMethodTemplate({userId:'user'},topicId,attemptId)).status,'retired');
});

test('claim review requires an exact current revision, a deliberate decision and an audit note',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>attemptId});
  await assert.rejects(()=>service.reviewClaim({userId:'user'},topicId,claimId,{revision:2,decision:'accept',note:'x'}),error=>error.code==='RESEARCH_CLAIM_REVIEW_INVALID');
  const accepted=await service.reviewClaim({userId:'user'},topicId,claimId,{revision:2,decision:'accept',note:'已逐条核对两项官方证据。'});
  assert.equal(repo.reviewed.revision,2);
  assert.equal(repo.reviewed.action,'accepted');
  assert.equal(repo.reviewed.id,attemptId);
  assert.equal(accepted.status,'accepted');
});

test('claim review signals are listed by topic and resolved only with an audited decision',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo});
  const signals=await service.listClaimReviewSignals({userId:'user'},topicId,{openOnly:true,limit:20});
  assert.equal(signals[0].type,'stale');
  await assert.rejects(()=>service.resolveClaimReviewSignal({userId:'user'},attemptId,{decision:'dismissed',note:'x'}),error=>error.code==='RESEARCH_CLAIM_SIGNAL_RESOLUTION_INVALID');
  assert.equal((await service.resolveClaimReviewSignal({userId:'user'},attemptId,{decision:'revalidated',note:'已重新核对当前一手证据。'})).status,'resolved');
  assert.equal(repo.signalResolution.decision,'revalidated');
});

test('critical claims cannot be accepted when the frozen evidence has no official primary source',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.reviewClaim=async()=>({status:'primary_evidence_required'});
  const service=createResearcherCollaborationService({repository:repo,ids:()=>attemptId});
  await assert.rejects(()=>service.reviewClaim({userId:'user'},topicId,claimId,{revision:2,decision:'accept',note:'已核对，但没有官方一手证据。'}),error=>error.code==='RESEARCH_CLAIM_PRIMARY_EVIDENCE_REQUIRED');
});

test('metric series filters are bounded and preserve missing as unknown',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.listMetricSeries=async(_user,_topic,query)=>{repo.metricQuery=query;return[{metricKey:'plan.price',statistics:{count:0,missingIsZero:false,latest:null}}];};
  const service=createResearcherCollaborationService({repository:repo});
  const series=await service.listMetrics({userId:'user'},topicId,{metricKey:'plan.price',dimensionKey:'plan',dimensionValue:'pro',from:'2026-01-01T00:00:00.000Z',to:'2026-12-31T00:00:00.000Z'});
  assert.equal(series[0].statistics.missingIsZero,false);
  assert.equal(repo.metricQuery.dimensionValue,'pro');
  await assert.rejects(()=>service.listMetrics({userId:'user'},topicId,{dimensionKey:'plan'}),error=>error.code==='RESEARCH_METRIC_FILTER_INVALID');
  await assert.rejects(()=>service.listMetrics({userId:'user'},topicId,{from:'2027-01-01T00:00:00.000Z',to:'2026-01-01T00:00:00.000Z'}),error=>error.code==='RESEARCH_METRIC_FILTER_INVALID');
});

test('metric comparison groups only accepted observations with the same method and unit',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.listMetricSeries=async(_user,_topic,query)=>{repo.metricQuery=query;return[{id:'definition',metricKey:'plan.price',label:'套餐月价',valueType:'number',canonicalUnit:'CNY/month',methodVersion:'direct-observation-v1',observations:[{id:'one',observedAt:'2026-10-20T00:00:00.000Z',value:12,dimensions:{plan:'pro'},evidence:{id:'e1'}},{id:'two',observedAt:'2026-10-19T00:00:00.000Z',value:10,dimensions:{plan:'pro'},evidence:{id:'e2'}},{id:'three',observedAt:'2026-10-18T00:00:00.000Z',value:6,dimensions:{plan:'basic'},evidence:{id:'e3'}},{id:'missing',observedAt:'2026-10-17T00:00:00.000Z',value:5,dimensions:{region:'CN'},evidence:{id:'e4'}}]}];};
  const service=createResearcherCollaborationService({repository:repo}),comparison=await service.compareMetrics({userId:'user'},topicId,{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan'});
  assert.equal(repo.metricQuery.status,'active');
  assert.equal(comparison.groups[0].dimensionValue,'pro');
  assert.equal(comparison.groups[0].statistics.average,11);
  assert.equal(comparison.groups[1].statistics.latest,6);
  assert.equal(comparison.missingDimensionCount,1);
  assert.equal(comparison.missingIsZero,false);
  await assert.rejects(()=>service.compareMetrics({userId:'user'},topicId,{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'bad key'}),error=>error.code==='RESEARCH_METRIC_COMPARISON_INVALID');
});

test('metric matrix keeps latest accepted cells evidence-backed and missing values unknown',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.listMetricSeries=async(_user,_topic,query)=>[{id:query.metricKey,metricKey:query.metricKey,label:query.metricKey,valueType:'number',canonicalUnit:query.metricKey==='plan.price'?'CNY/month':'GB',methodVersion:'direct-observation-v1',observations:query.metricKey==='plan.price'?[{observedAt:'2026-10-20T00:00:00.000Z',value:12,dimensions:{plan:'pro'},evidence:{id:'price-new'}},{observedAt:'2026-10-01T00:00:00.000Z',value:10,dimensions:{plan:'pro'},evidence:{id:'price-old'}},{observedAt:'2026-10-20T00:00:00.000Z',value:6,dimensions:{plan:'basic'},evidence:{id:'price-basic'}}]:[{observedAt:'2026-10-20T00:00:00.000Z',value:100,dimensions:{plan:'pro'},evidence:{id:'storage-pro'}},{observedAt:'2026-10-20T00:00:00.000Z',value:20,dimensions:{region:'CN'},evidence:{id:'missing-plan'}}]}];
  const service=createResearcherCollaborationService({repository:repo}),matrix=await service.metricMatrix({userId:'user'},topicId,{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.storage',methodVersion:'direct-observation-v1'}],dimensionKey:'plan'});
  assert.equal(matrix.rows.length,2);
  assert.equal(matrix.rows.find(row=>row.dimensionValue==='pro').cells['plan.price'].value,12,'latest observation wins within a cell');
  assert.equal(matrix.rows.find(row=>row.dimensionValue==='pro').cells['plan.storage'].evidence.id,'storage-pro');
  assert.equal(matrix.rows.find(row=>row.dimensionValue==='basic').cells['plan.storage'],undefined);
  assert.equal(matrix.missingDimensionCount,1);
  assert.equal(matrix.missingIsZero,false);
  await assert.rejects(()=>service.metricMatrix({userId:'user'},topicId,{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'}],dimensionKey:'plan'}),error=>error.code==='RESEARCH_METRIC_MATRIX_INVALID');
});

test('derived metric formulas are immutable bounded arithmetic over evidence-backed accepted inputs',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),definitions={
    'latency.current:direct-observation-v1':{id:'left-id',metricKey:'latency.current',label:'当前耗时',valueType:'number',canonicalUnit:'s',methodVersion:'direct-observation-v1'},
    'latency.baseline:direct-observation-v1':{id:'right-id',metricKey:'latency.baseline',label:'基线耗时',valueType:'number',canonicalUnit:'s',methodVersion:'direct-observation-v1'},
  };
  repo.getMetricDefinition=async(_user,_topic,key,version)=>definitions[`${key}:${version}`]??null;
  repo.listMetricSeries=async(_user,_topic,query)=>{const definition=Object.values(definitions).find(item=>item.metricKey===query.metricKey);if(!definition)return[];const left=definition.metricKey==='latency.current';return[{...definition,observations:left?[{observedAt:'2026-10-21T00:00:00.000Z',value:1.5,unit:'s',dimensions:{region:'CN'},evidence:{id:'left-cn',url:'https://example.com/left-cn'}},{observedAt:'2026-10-20T00:00:00.000Z',value:2,unit:'s',dimensions:{region:'US'},evidence:{id:'left-us',url:'https://example.com/left-us'}},{observedAt:'2026-10-20T00:00:00.000Z',value:3,unit:'s',dimensions:{region:'JP'},evidence:{id:'left-jp',url:'https://example.com/left-jp'}}]:[{observedAt:'2026-10-21T00:00:00.000Z',value:2,unit:'s',dimensions:{region:'CN'},evidence:{id:'right-cn',url:'https://example.com/right-cn'}},{observedAt:'2026-10-20T00:00:00.000Z',value:0,unit:'s',dimensions:{region:'EU'},evidence:{id:'right-eu',url:'https://example.com/right-eu'}},{observedAt:'2026-10-20T00:00:00.000Z',value:0,unit:'s',dimensions:{region:'JP'},evidence:{id:'right-jp',url:'https://example.com/right-jp'}}]}];};
  const service=createResearcherCollaborationService({repository:repo,ids:()=>jobId});
  const created=await service.createDerivedMetric({userId:'user'},topicId,{derivedKey:'latency.change_percent',label:'耗时变化率',formulaVersion:'derived-arithmetic-v1',operator:'percent-change',left:{metricKey:'latency.current',methodVersion:'direct-observation-v1'},right:{metricKey:'latency.baseline',methodVersion:'direct-observation-v1'},dimensionKey:'region'});
  assert.equal(created.outputUnit,'%');
  assert.equal(created.formula.missingValuePolicy,'unknown');
  assert.equal(created.formula.zeroDenominatorPolicy,'unknown');
  const evaluated=await service.evaluateDerivedMetric({userId:'user'},topicId,jobId);
  assert.equal(evaluated.rows.find(row=>row.dimensionValue==='CN').value,-25);
  assert.equal(evaluated.rows.find(row=>row.dimensionValue==='CN').left.evidence.id,'left-cn');
  assert.equal(evaluated.rows.find(row=>row.dimensionValue==='US').missingReason,'right-missing');
  assert.equal(evaluated.rows.find(row=>row.dimensionValue==='EU').missingReason,'left-missing');
  assert.equal(evaluated.rows.find(row=>row.dimensionValue==='JP').missingReason,'division-by-zero');
  assert.equal(evaluated.missingIsZero,false);
  await assert.rejects(()=>service.createDerivedMetric({userId:'user'},topicId,{derivedKey:'bad',label:'坏公式',formulaVersion:'v1',operator:'multiply',left:{metricKey:'latency.current',methodVersion:'direct-observation-v1'},right:{metricKey:'latency.baseline',methodVersion:'direct-observation-v1'},dimensionKey:'region'}),error=>error.code==='RESEARCH_DERIVED_METRIC_INVALID');
  definitions['latency.baseline:direct-observation-v1'].canonicalUnit='ms';
  await assert.rejects(()=>service.createDerivedMetric({userId:'user'},topicId,{derivedKey:'bad.units',label:'错单位',formulaVersion:'v1',operator:'difference',left:{metricKey:'latency.current',methodVersion:'direct-observation-v1'},right:{metricKey:'latency.baseline',methodVersion:'direct-observation-v1'},dimensionKey:'region'}),error=>error.code==='RESEARCH_DERIVED_METRIC_UNIT_MISMATCH');
});

test('metric trend buckets accepted observations without filling missing periods',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository();repo.listMetricSeries=async(_user,_topic,query)=>{repo.metricQuery=query;return[{id:'definition',metricKey:'plan.price',label:'套餐月价',valueType:'number',canonicalUnit:'CNY/month',methodVersion:'direct-observation-v1',observations:[{observedAt:'2026-10-20T00:00:00.000Z',value:12,evidence:{id:'e1'}},{observedAt:'2026-10-05T00:00:00.000Z',value:10,evidence:{id:'e2'}},{observedAt:'2026-08-01T00:00:00.000Z',value:6,evidence:{id:'e3'}}]}];};
  const service=createResearcherCollaborationService({repository:repo}),trend=await service.metricTrend({userId:'user'},topicId,{metricKey:'plan.price',methodVersion:'direct-observation-v1',interval:'month',dimensionKey:'plan',dimensionValue:'pro'});
  assert.equal(repo.metricQuery.status,'active');
  assert.equal(repo.metricQuery.dimensionValue,'pro');
  assert.equal(trend.buckets.length,2,'September is missing and must not be synthesized as zero');
  assert.equal(trend.buckets[1].statistics.average,11);
  assert.deepEqual(trend.summary,{basis:'first-to-latest-observation',observationCount:3,observedBucketCount:2,first:{observedAt:'2026-08-01T00:00:00.000Z',value:6,evidence:{id:'e3'}},latest:{observedAt:'2026-10-20T00:00:00.000Z',value:12,evidence:{id:'e1'}},absoluteChange:6,relativeChangePercent:100,direction:'increased',missingIsZero:false,causalAttribution:false});
  assert.equal(trend.missingIsZero,false);
  await assert.rejects(()=>service.metricTrend({userId:'user'},topicId,{metricKey:'plan.price',methodVersion:'direct-observation-v1',interval:'quarter'}),error=>error.code==='RESEARCH_METRIC_TREND_INVALID');
});

test('saved metric views keep bounded normalized series, comparison, trend and matrix queries',async()=>{
  const {createResearcherCollaborationService}=await import(moduleUrl('researcher-collaboration-service.mjs'));
  const repo=repository(),service=createResearcherCollaborationService({repository:repo,ids:()=>claimId});
  const view=await service.createMetricView({userId:'user'},topicId,{name:'套餐对比',viewType:'comparison',config:{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan',from:'2026-01-01T00:00:00Z'}});
  assert.equal(view.name,'套餐对比');
  assert.equal(repo.metricView.config.from,'2026-01-01T00:00:00.000Z');
  await assert.rejects(()=>service.createMetricView({userId:'user'},topicId,{name:'坏视图',viewType:'series',config:{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan'}}),error=>error.code==='RESEARCH_METRIC_VIEW_INVALID');
  const trendView=await service.createMetricView({userId:'user'},topicId,{name:'套餐月趋势',viewType:'trend',config:{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan',dimensionValue:'pro',interval:'month',from:'2026-01-01T00:00:00Z'}});
  assert.equal(trendView.viewType,'trend');
  assert.equal(repo.metricView.config.interval,'month');
  assert.equal(repo.metricView.config.from,'2026-01-01T00:00:00.000Z');
  await assert.rejects(()=>service.createMetricView({userId:'user'},topicId,{name:'坏趋势',viewType:'trend',config:{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan',dimensionValue:'pro',interval:'quarter'}}),error=>error.code==='RESEARCH_METRIC_VIEW_INVALID');
  const matrix=await service.createMetricView({userId:'user'},topicId,{name:'套餐矩阵',viewType:'matrix',config:{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.storage',methodVersion:'direct-observation-v1'}],dimensionKey:'plan',from:'2026-01-01T00:00:00Z'}});
  assert.equal(matrix.viewType,'matrix');
  assert.equal(repo.metricView.config.metrics.length,2);
  assert.equal(repo.metricView.config.from,'2026-01-01T00:00:00.000Z');
  await assert.rejects(()=>service.createMetricView({userId:'user'},topicId,{name:'重复指标',viewType:'matrix',config:{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.price',methodVersion:'direct-observation-v1'}],dimensionKey:'plan'}}),error=>error.code==='RESEARCH_METRIC_VIEW_INVALID');
  assert.equal((await service.deleteMetricView({userId:'user'},topicId,claimId)).deleted,true);
  const quality=await service.qualitySummary({userId:'user'},topicId);
  assert.equal(quality.schemaVersion,'research-structural-quality-v1');
  assert.equal(quality.claims.evidenceCoverageRate,1);
  assert.equal(quality.metrics.traceabilityRate,1);
  assert.equal(quality.structuralGate.passed,true);
  assert.match(quality.caveats[0],/不衡量结论是否真实/u);
});

test('Researcher worker endpoints require the dedicated server secret',async t=>{
  const {createApp}=await import(moduleUrl('app.mjs'));
  let claimed=0,reviewed=null;
  const app=createApp({
    config:{requestBodyLimit:65536,researcherWorkerEnabled:true,researcherWorkerToken:'s'.repeat(32)},
    database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},
    authService:{authenticateBearer:async()=>({userId:'user'})},
    researcherCollaborationService:{capabilities:async()=>({workerAvailable:true}),cancelJob:async()=>({id:jobId,status:'cancelled'}),getClaim:async()=>({id:claimId,status:'candidate'}),reviewClaim:async(_actor,_topic,_claim,body)=>{reviewed=body;return{id:claimId,status:'accepted'};},factTimeline:async()=>({schemaVersion:'research-fact-timeline-v1',series:[],missingIsZero:false}),listClaimReviewSignals:async()=>[{id:attemptId,type:'stale'}],resolveClaimReviewSignal:async(_actor,_signal,body)=>({status:'resolved',decision:body.decision}),listMethodTemplates:async()=>[{id:attemptId,methodVersion:'direct-observation-v1'}],compareMetrics:async()=>({metricKey:'plan.price',groups:[],missingIsZero:false}),metricMatrix:async()=>({dimensionKey:'plan',definitions:[],rows:[],missingIsZero:false}),metricTrend:async()=>({metricKey:'plan.price',buckets:[],missingIsZero:false}),qualitySummary:async()=>({schemaVersion:'research-structural-quality-v1',claims:{accepted:1,evidenceBacked:1,evidenceCoverageRate:1},criticalClaims:{accepted:0,primaryBacked:0,primaryCoverageRate:null},metrics:{activeObservations:1,traceableObservations:1,traceabilityRate:1},sampling:{pending:1,passed:0,failed:0,reviewed:0,passRate:null},externalBenchmark:{total:1,pending:1,detected:0,missed:0,excluded:0,evaluated:0,detectionRate:null,independenceVerified:false},corrections:{open:0,corrected:0,dismissed:0},structuralGate:{evaluated:true,passed:true},caveats:[]}),listExternalBenchmarkCases:async()=>[{id:jobId,topicId,status:'pending',title:'外部事件'}],createExternalBenchmarkCase:async(_actor,_topic,body)=>({created:true,case:{id:jobId,...body,status:'pending'}}),reviewExternalBenchmarkCase:async(_actor,_topic,_case,body)=>({id:jobId,status:body.decision,review:{note:body.note}}),listQualitySamples:async()=>[{id:claimId,status:'pending',target:{title:'价格变化'}}],generateQualitySamples:async()=>[{id:claimId,status:'pending',target:{title:'价格变化'}}],reviewQualitySample:async(_actor,_topic,_sample,body)=>({id:claimId,status:body.decision==='pass'?'passed':'failed'}),resolveQualityCorrection:async(_actor,_topic,_sample,body)=>({id:claimId,status:'failed',correctionResolution:{decision:body.decision,note:body.note}}),listDerivedMetrics:async()=>[{id:claimId,derivedKey:'price.delta'}],createDerivedMetric:async(_actor,_topic,body)=>({id:claimId,...body}),evaluateDerivedMetric:async()=>({definition:{id:claimId},rows:[],missingIsZero:false}),claimNext:async()=>{claimed+=1;return null;},markSent:async()=>({status:'leased'})},
  });
  t.after(()=>app.close());
  const user=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/researcher`,headers:{authorization:'Bearer user-session'}});
  assert.equal(user.statusCode,200);
  const cancelled=await app.inject({method:'DELETE',url:`/v1/me/research-topics/${topicId}/researcher-jobs/${jobId}`,headers:{authorization:'Bearer user-session'}});
  assert.equal(cancelled.statusCode,200);
  assert.equal(cancelled.json().data.status,'cancelled');
  const detail=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/claims/${claimId}`,headers:{authorization:'Bearer user-session'}});
  assert.equal(detail.statusCode,200);
  const review=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/claims/${claimId}/reviews`,headers:{authorization:'Bearer user-session'},payload:{revision:2,decision:'accept',note:'已核对证据。'}});
  assert.equal(review.statusCode,200);
  assert.equal(reviewed.decision,'accept');
  const factTimeline=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/fact-timeline?subject=${encodeURIComponent('专业版')}&dimensionKey=pricing&predicateKey=monthly-price&scopeKey=plan&scopeValue=pro`,headers:{authorization:'Bearer user-session'}});
  assert.equal(factTimeline.statusCode,200);
  assert.equal(factTimeline.json().data.schemaVersion,'research-fact-timeline-v1');
  assert.equal(factTimeline.json().data.missingIsZero,false);
  const signals=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/claim-review-signals?openOnly=true`,headers:{authorization:'Bearer user-session'}});
  assert.equal(signals.statusCode,200);
  assert.equal(signals.json().data[0].type,'stale');
  const resolution=await app.inject({method:'POST',url:`/v1/me/research-claim-review-signals/${attemptId}/resolutions`,headers:{authorization:'Bearer user-session'},payload:{decision:'acknowledged',note:'已记录，待下一轮正式复核。'}});
  assert.equal(resolution.statusCode,200);
  assert.equal(resolution.json().data.decision,'acknowledged');
  const methods=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/method-templates?status=active`,headers:{authorization:'Bearer user-session'}});
  assert.equal(methods.statusCode,200);
  assert.equal(methods.json().data[0].methodVersion,'direct-observation-v1');
  const comparison=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/metric-comparison?metricKey=plan.price&methodVersion=direct-observation-v1&dimensionKey=plan`,headers:{authorization:'Bearer user-session'}});
  assert.equal(comparison.statusCode,200);
  assert.equal(comparison.json().data.missingIsZero,false);
  const matrix=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/metric-matrix`,headers:{authorization:'Bearer user-session'},payload:{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.storage',methodVersion:'direct-observation-v1'}],dimensionKey:'plan'}});
  assert.equal(matrix.statusCode,200);
  assert.equal(matrix.json().data.missingIsZero,false);
  const trend=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/metric-trend?metricKey=plan.price&methodVersion=direct-observation-v1&interval=month`,headers:{authorization:'Bearer user-session'}});
  assert.equal(trend.statusCode,200);
  assert.equal(trend.json().data.missingIsZero,false);
  const quality=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/quality-summary`,headers:{authorization:'Bearer user-session'}});
  assert.equal(quality.statusCode,200);
  assert.equal(quality.json().data.schemaVersion,'research-structural-quality-v1');
  const benchmarkCases=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/external-benchmark-cases?status=pending`,headers:{authorization:'Bearer user-session'}});
  assert.equal(benchmarkCases.statusCode,200);
  assert.equal(benchmarkCases.json().data[0].status,'pending');
  const benchmarkCreated=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/external-benchmark-cases`,headers:{authorization:'Bearer user-session'},payload:{title:'外部事件',occurredAt:'2026-10-20T00:00:00.000Z',sourceUrl:'https://audit.example/case',sourceKind:'external-audit',importance:'important',provenanceNote:'由外部审计员独立整理并冻结。'}});
  assert.equal(benchmarkCreated.statusCode,201);
  const benchmarkReviewed=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/external-benchmark-cases/${jobId}/reviews`,headers:{authorization:'Bearer user-session'},payload:{decision:'detected',matchedEventId:attemptId,note:'已核对来源时间与平台事件证据一致。'}});
  assert.equal(benchmarkReviewed.statusCode,200);
  assert.equal(benchmarkReviewed.json().data.status,'detected');
  const qualitySamples=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/quality-samples?status=pending&periodKey=2020-01`,headers:{authorization:'Bearer user-session'}});
  assert.equal(qualitySamples.statusCode,200);
  assert.equal(qualitySamples.json().data[0].status,'pending');
  const generatedSamples=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/quality-samples/generate`,headers:{authorization:'Bearer user-session'},payload:{periodKey:'2020-01',sampleSize:5}});
  assert.equal(generatedSamples.statusCode,201);
  const sampleReview=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/quality-samples/${claimId}/reviews`,headers:{authorization:'Bearer user-session'},payload:{decision:'fail',note:'独立核验发现当前证据已经不再支持该项目。'}});
  assert.equal(sampleReview.statusCode,200);
  assert.equal(sampleReview.json().data.status,'failed');
  const correctionResolution=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/quality-samples/${claimId}/correction-resolution`,headers:{authorization:'Bearer user-session'},payload:{decision:'dismissed',note:'复核后确认这是抽样误报，不需要改写原结论。'}});
  assert.equal(correctionResolution.statusCode,200);
  assert.equal(correctionResolution.json().data.correctionResolution.decision,'dismissed');
  const derived=await app.inject({method:'POST',url:`/v1/me/research-topics/${topicId}/derived-metrics`,headers:{authorization:'Bearer user-session'},payload:{derivedKey:'price.delta',label:'价格差',formulaVersion:'v1',operator:'difference',left:{metricKey:'plan.price',methodVersion:'direct-observation-v1'},right:{metricKey:'plan.list_price',methodVersion:'direct-observation-v1'},dimensionKey:'plan'}});
  assert.equal(derived.statusCode,201);
  const derivedList=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/derived-metrics`,headers:{authorization:'Bearer user-session'}});
  assert.equal(derivedList.json().data[0].derivedKey,'price.delta');
  const derivedEvaluation=await app.inject({method:'GET',url:`/v1/me/research-topics/${topicId}/derived-metrics/${claimId}/evaluation`,headers:{authorization:'Bearer user-session'}});
  assert.equal(derivedEvaluation.json().data.missingIsZero,false);
  const denied=await app.inject({method:'POST',url:'/v1/internal/researcher/jobs/claim',payload:{workerId:'worker-1'}});
  assert.equal(denied.statusCode,401);
  const accepted=await app.inject({method:'POST',url:'/v1/internal/researcher/jobs/claim',headers:{authorization:`Bearer ${'s'.repeat(32)}`},payload:{workerId:'worker-1'}});
  assert.equal(accepted.statusCode,204);
  assert.equal(claimed,1);
  const sent=await app.inject({method:'POST',url:`/v1/internal/researcher/jobs/${jobId}/sent`,headers:{authorization:`Bearer ${'s'.repeat(32)}`},payload:{attemptId}});
  assert.equal(sent.statusCode,200);
});

test('Researcher worker health endpoint is authenticated and returns a failing status without mutating presence',async t=>{
  const {createApp}=await import(moduleUrl('app.mjs'));let checks=0;
  const app=createApp({
    config:{requestBodyLimit:65536,researcherWorkerEnabled:true,researcherWorkerToken:'s'.repeat(32)},
    database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},authService:{authenticateBearer:async()=>({userId:'user'})},
    researcherCollaborationService:{workerHealth:async(workerId,body)=>{checks+=1;return{healthy:false,status:'stale',state:'polling',lastSeenAt:'2026-10-21T00:00:00.000Z',staleAfterSeconds:body.staleAfterSeconds,workerId};}},
  });
  t.after(()=>app.close());
  const payload={workerId:'researcher-worker-1',provider:'deepseek-researcher',model:'deepseek-chat',staleAfterSeconds:180};
  const denied=await app.inject({method:'POST',url:'/v1/internal/researcher/workers/health',payload});
  assert.equal(denied.statusCode,401);
  const stale=await app.inject({method:'POST',url:'/v1/internal/researcher/workers/health',headers:{authorization:`Bearer ${'s'.repeat(32)}`},payload});
  assert.equal(stale.statusCode,503);
  assert.equal(stale.json().data.status,'stale');
  assert.equal(checks,1);
});

test('Local Researcher node routes separate account enrollment from node-token execution',async t=>{
  const {createApp}=await import(moduleUrl('app.mjs'));let claimedNode=null;
  const node={id:attemptId,userId:'user',label:'study PC',provider:'deepseek-researcher',model:'deepseek-chat',status:'active'};
  const service={
    listLocalNodes:async()=>[node],createLocalNode:async(_actor,body)=>({...node,label:body.label,enrollmentToken:`mrn_${'n'.repeat(43)}`}),revokeLocalNode:async()=>({...node,status:'revoked'}),
    authenticateLocalNode:async authorization=>{if(authorization!==`Bearer mrn_${'n'.repeat(43)}`){const error=new Error('node auth required');error.statusCode=401;throw error;}return node;},
    localNodeHealth:async value=>({healthy:true,status:'online',node:value}),claimNextLocal:async value=>{claimedNode=value;return null;},
    heartbeatLocal:async()=>({status:'leased'}),markSentLocal:async()=>({status:'leased'}),completeLocal:async()=>({status:'completed'}),failLocal:async()=>({status:'failed'}),
  };
  const app=createApp({config:{requestBodyLimit:65536,researcherWorkerEnabled:false},database:{ping:async()=>true},migrations:{status:async()=>({ready:true})},authService:{authenticateBearer:async()=>({userId:'user'})},researcherCollaborationService:service});
  t.after(()=>app.close());
  const created=await app.inject({method:'POST',url:'/v1/me/researcher-nodes',headers:{authorization:'Bearer user-session'},payload:{label:'study PC'}});
  assert.equal(created.statusCode,201);
  assert.match(created.json().data.enrollmentToken,/^mrn_/u);
  assert.equal((await app.inject({method:'POST',url:'/v1/researcher-node/health'})).statusCode,401);
  const headers={authorization:`Bearer mrn_${'n'.repeat(43)}`};
  assert.equal((await app.inject({method:'POST',url:'/v1/researcher-node/health',headers,payload:{}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/researcher-node/jobs/claim',headers,payload:{leaseSeconds:90}})).statusCode,204);
  assert.equal(claimedNode.userId,'user');
});
