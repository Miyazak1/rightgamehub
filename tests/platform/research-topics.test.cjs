const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const moduleUrl=relative=>pathToFileURL(path.join(root,relative)).href;
const uuids=[
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b',
];
const baseContract={
  questions:['这个技术方向在过去 30 天发生了哪些实质变化？'],
  methods:['trend-v1','triangulation-v1'],
  sourcePolicy:{allowedTypes:['http','rss','github'],minAuthorityTier:'community',requirePrimaryForCritical:true},
  schedule:{cadence:'weekly',timezone:'Asia/Shanghai',localTime:'09:00',weekday:1},
  budget:{maxSearchQueriesPerRun:8,maxDocumentsPerRun:20,maxDeepResearchJobsPerRun:1},
  notifications:{minimumImportance:'important'},
  retention:{sourceVersionsDays:365},
};

test('research schedule uses contract wall-clock time across timezones, downtime and DST',async()=>{
  const {nextRunForContract,normalizeResearchContract,buildResearchNewsQuery,buildResearchSearchWindow,buildResearchDiscoveryClusterIdentity,canonicalizeResearchNewsUrl,researchHeadlineFingerprint,researchPublishedAtInWindow}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  assert.equal(nextRunForContract({schedule:{cadence:'manual',timezone:'Asia/Shanghai'}},new Date('2026-10-21T00:00:00.000Z')),null);
  assert.equal(nextRunForContract({schedule:{cadence:'daily',timezone:'Asia/Shanghai',localTime:'09:00'}},new Date('2026-10-21T00:30:00.000Z')),'2026-10-21T01:00:00.000Z');
  assert.equal(nextRunForContract({schedule:{cadence:'daily',timezone:'Asia/Shanghai',localTime:'09:00'}},new Date('2026-10-21T01:00:00.000Z')),'2026-10-22T01:00:00.000Z');
  assert.equal(nextRunForContract({schedule:{cadence:'weekly',timezone:'Asia/Shanghai',localTime:'09:00',weekday:1}},new Date('2026-10-21T00:00:00.000Z')),'2026-10-26T01:00:00.000Z');
  assert.equal(nextRunForContract({schedule:{cadence:'daily',timezone:'America/New_York',localTime:'02:30'}},new Date('2026-03-08T06:00:00.000Z')),'2026-03-08T07:00:00.000Z');
  assert.equal(nextRunForContract({schedule:{cadence:'daily',timezone:'America/New_York',localTime:'01:30'}},new Date('2026-11-01T04:00:00.000Z')),'2026-11-01T05:30:00.000Z');
  const normalized=normalizeResearchContract(baseContract);
  assert.deepEqual(normalized.schedule,{cadence:'weekly',timezone:'Asia/Shanghai',localTime:'09:00',weekday:1});
  assert.deepEqual(normalized.sourcePolicy.searchPacks,[]);
  assert.throws(()=>normalizeResearchContract({...baseContract,schedule:{cadence:'daily',timezone:'Asia/Shanghai',localTime:'25:00'}}),error=>error.code==='RESEARCH_CONTRACT_INVALID');
  assert.equal(buildResearchNewsQuery('OpenAI','过去 30 天发生了哪些重要事件？'),'OpenAI 过去 30 天发生了哪些重要事件？');
  assert.match(buildResearchNewsQuery('OpenAI','重要变化',{domains:['reuters.com','apnews.com'],after:'2026-10-01T00:00:00.000Z'}),/site:reuters\.com OR site:apnews\.com after:2026-10-01/u);
  assert.equal(buildResearchNewsQuery(' 很长的关注对象 '.repeat(20),' 很长的观察问题 '.repeat(30)).length,128);
  assert.equal(canonicalizeResearchNewsUrl('https://EXAMPLE.com/news/?utm_source=test&b=2&a=1#part'),'https://example.com/news?a=1&b=2');
  assert.equal(researchHeadlineFingerprint('AI：新规发布！'),'ai 新规发布');
  assert.equal(buildResearchDiscoveryClusterIdentity('AI：新规发布！','2026-10-20T08:00:00Z').fingerprint,buildResearchDiscoveryClusterIdentity('AI 新规发布','2026-10-20T18:00:00Z').fingerprint);
  assert.notEqual(buildResearchDiscoveryClusterIdentity('AI 新规发布','2026-10-20T18:00:00Z').fingerprint,buildResearchDiscoveryClusterIdentity('AI 新规发布','2026-10-21T18:00:00Z').fingerprint);
  assert.deepEqual(buildResearchSearchWindow({windowStartAt:'2026-10-20T09:00:00.000Z',startedAt:'2026-10-22T09:00:00.000Z',hasPreviousSuccessfulRun:true}),{after:'2026-10-19T09:00:00.000Z',before:'2026-10-22T09:00:00.000Z',searchAfterDate:'2026-10-19',overlapHours:24,initialLookbackDays:null});
  assert.deepEqual(buildResearchSearchWindow({windowStartAt:'2020-01-01T00:00:00.000Z',startedAt:'2026-10-22T09:00:00.000Z'}),{after:'2026-09-22T09:00:00.000Z',before:'2026-10-22T09:00:00.000Z',searchAfterDate:'2026-09-22',overlapHours:0,initialLookbackDays:30});
  const window={after:'2026-10-19T09:00:00.000Z',before:'2026-10-22T09:00:00.000Z'};
  assert.equal(researchPublishedAtInWindow('2026-10-19',window),true);
  assert.equal(researchPublishedAtInWindow('2026-10-19T00:00:00.000Z',window),false);
});

test('research news source catalog exposes auditable regional packs and deterministic rotation',async()=>{
  const {getResearchNewsSourceCatalog,getResearchNewsSourcePackDomains}=await import(moduleUrl('apps/api/src/research-news-source-catalog.mjs'));
  const catalog=getResearchNewsSourceCatalog(),asia=catalog.packs.find(pack=>pack.id==='asia');
  assert.equal(catalog.policy.fullTextStorage,false);
  assert.equal(catalog.policy.rssAutoSubscription,false);
  assert.ok(asia.outletCount>=10);
  assert.deepEqual(getResearchNewsSourcePackDomains('asia','same-run'),getResearchNewsSourcePackDomains('asia','same-run'));
  assert.equal(getResearchNewsSourcePackDomains('unknown','run').length,0);
});

const createMemoryRepository=()=>{
  const topics=new Map(),sources=new Map(),entities=new Map(),discoveries=new Map(),candidateAssessments=[],candidateEvaluationDatasets=[],candidateEvaluationRuns=[],authorityReviews=[],sourceStatusReviews=[],entityStatusReviews=[],sourceRelationships=[],billingReconciliations=[],billingReviews=[],watches=new Map([[uuids[1],{id:uuids[1],userId:'user-1',title:'官方更新',url:'https://example.com',status:'active'}]]);
  return{
    topics,sources,entities,discoveries,candidateAssessments,candidateEvaluationDatasets,candidateEvaluationRuns,authorityReviews,sourceStatusReviews,entityStatusReviews,sourceRelationships,billingReconciliations,billingReviews,watches,
    count:async userId=>[...topics.values()].filter(item=>item.userId===userId&&item.status!=='archived').length,
    create:async input=>{const now=new Date().toISOString(),topic={...input,status:'active',currentContractVersion:1,lastRunAt:null,createdAt:now,updatedAt:now};topics.set(input.id,topic);return topic;},
    list:async userId=>[...topics.values()].filter(item=>item.userId===userId),
    get:async(userId,id)=>topics.get(id)?.userId===userId?topics.get(id):null,
    update:async(userId,id,input)=>{const current=topics.get(id);if(!current||current.userId!==userId)return null;const next={...current,...input,updatedAt:new Date().toISOString()};if(input.setNextRunAt)next.nextRunAt=input.nextRunAt;if(['paused','archived'].includes(input.status))next.nextRunAt=null;delete next.setNextRunAt;topics.set(id,next);return next;},
    createContract:async(userId,id,{expectedVersion,contract,nextRunAt})=>{const current=topics.get(id);if(!current||current.userId!==userId)return null;if(current.currentContractVersion!==expectedVersion){const error=new Error('conflict');error.code='RESEARCH_CONTRACT_VERSION_CONFLICT';error.statusCode=409;throw error;}const next={...current,currentContractVersion:expectedVersion+1,contract,nextRunAt};topics.set(id,next);return next;},
    listWatches:async(userId,topicId)=>[...watches.values()].filter(item=>item.userId===userId&&item.topicId===topicId),
    linkWatch:async(userId,topicId,watchId)=>{const watch=watches.get(watchId);if(!watch||watch.userId!==userId)return 'missing';if(watch.topicId&&watch.topicId!==topicId)return 'conflict';watch.topicId=topicId;return 'linked';},
    unlinkWatch:async(userId,topicId,watchId)=>{const watch=watches.get(watchId);if(!watch||watch.userId!==userId||watch.topicId!==topicId)return false;delete watch.topicId;return true;},
    listSources:async(userId,topicId)=>[...sources.values()].filter(item=>item.userId===userId&&item.topicId===topicId),
    listDiscoveries:async(userId,topicId,query={})=>[...discoveries.values()].filter(item=>item.userId===userId&&item.topicId===topicId).map(item=>({...item,latestAssessment:candidateAssessments.filter(review=>review.discoveryId===item.id).at(-1)||null})).filter(item=>(!query.decision||(query.decision==='unassessed'?!item.latestAssessment:item.latestAssessment?.decision===query.decision))&&(!query.evaluatorKind||item.latestAssessment?.evaluatorKind===query.evaluatorKind)&&(!query.sourceStatus||item.sourceStatus===query.sourceStatus)&&(query.minTopicRelevance===null||query.minTopicRelevance===undefined||Number(item.latestAssessment?.dimensionScores?.topicRelevance)>=query.minTopicRelevance)).sort((left,right)=>query.sort==='priority'?Number(right.latestAssessment?.dimensionScores?.topicRelevance??-1)-Number(left.latestAssessment?.dimensionScores?.topicRelevance??-1):String(right.discoveredAt||'').localeCompare(String(left.discoveredAt||''))).slice(0,query.limit??50),
    getDiscoveryStats:async(userId,topicId)=>{if(topics.get(topicId)?.userId!==userId)return null;const items=[...discoveries.values()].filter(item=>item.userId===userId&&item.topicId===topicId).map(item=>({...item,latestAssessment:candidateAssessments.filter(review=>review.discoveryId===item.id).at(-1)||null})),score=key=>{const values=items.map(item=>item.latestAssessment?.dimensionScores?.[key]).filter(value=>Number.isFinite(Number(value))).map(Number);return values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length*1000)/1000:null;};return{schemaVersion:'research-candidate-stats-v1',total:items.length,unassessed:items.filter(item=>!item.latestAssessment).length,decisions:{relevant:items.filter(item=>item.latestAssessment?.decision==='relevant').length,needsReview:items.filter(item=>item.latestAssessment?.decision==='needs-review').length,irrelevant:items.filter(item=>item.latestAssessment?.decision==='irrelevant').length},evaluatorKinds:{rule:items.filter(item=>item.latestAssessment?.evaluatorKind==='rule').length,model:items.filter(item=>item.latestAssessment?.evaluatorKind==='model').length,human:items.filter(item=>item.latestAssessment?.evaluatorKind==='human').length},sourceStatuses:{candidate:items.filter(item=>item.sourceStatus==='candidate').length,tracked:items.filter(item=>item.sourceStatus==='tracked').length,muted:items.filter(item=>item.sourceStatus==='muted').length,rejected:items.filter(item=>item.sourceStatus==='rejected').length},averageScores:{topicRelevance:score('topicRelevance'),novelty:score('novelty'),potentialImpact:score('potentialImpact'),evidenceability:score('evidenceability'),timelineValue:score('timelineValue')},latestDiscoveredAt:items.map(item=>item.discoveredAt).filter(Boolean).sort().at(-1)||null,caveats:['统计基于每条候选的最新评估。']};},
    getCandidateEvaluationItems:async(userId,topicId,evaluationKey=null)=>{if(topics.get(topicId)?.userId!==userId)return null;const selected=evaluationKey||candidateAssessments.filter(item=>item.topicId===topicId&&item.evaluatorKind==='model').at(-1)?.evaluationKey||null;return{evaluationKey:selected,items:[...discoveries.values()].filter(item=>item.userId===userId&&item.topicId===topicId).map(item=>{const assessments=candidateAssessments.filter(review=>review.discoveryId===item.id),model=assessments.filter(review=>review.evaluatorKind==='model'&&review.evaluationKey===selected).at(-1),human=assessments.filter(review=>review.evaluatorKind==='human').at(-1);return{id:item.id,title:item.title,snippet:item.snippet||'',provider:item.provider||'test-provider',publisher:item.publisher||null,modelDecision:model?.decision||null,humanDecision:human?.decision||null};}).filter(item=>item.modelDecision||item.humanDecision)};},
    getCandidateGoldCandidates:async(userId,topicId)=>{if(topics.get(topicId)?.userId!==userId)return null;return[...discoveries.values()].filter(item=>item.userId===userId&&item.topicId===topicId).map(item=>{const human=candidateAssessments.filter(review=>review.discoveryId===item.id&&review.evaluatorKind==='human'&&['relevant','irrelevant'].includes(review.decision)).at(-1),assigned=candidateEvaluationDatasets.flatMap(dataset=>dataset.cases).find(entry=>entry.discoveryId===item.id);return human?{id:item.id,title:item.title,snippet:item.snippet||'',provider:item.provider||'test-provider',publisher:item.publisher||null,humanAssessmentId:human.id,humanDecision:human.decision,assignedSplit:assigned?.datasetSplit||null}:null;}).filter(Boolean);},
    createCandidateEvaluationDataset:async(userId,topicId,input)=>{if(topics.get(topicId)?.userId!==userId)return{status:'missing'};if(input.cases.some(item=>{const assigned=candidateEvaluationDatasets.flatMap(dataset=>dataset.cases).find(entry=>item.caseOrigin==='external-import'?entry.externalCaseKey===item.externalCaseKey:entry.discoveryId===item.discoveryId);return assigned&&assigned.datasetSplit!==input.split;}))return{status:'split-conflict'};const existing=candidateEvaluationDatasets.find(item=>item.topicId===topicId&&item.split===input.split&&item.contentSha256===input.contentSha256);if(existing)return{status:'ok',created:false,dataset:existing};const dataset={id:input.id,topicId,name:input.name,split:input.split,origin:input.origin,sampleStrategy:input.sampleStrategy,sampleLimit:input.sampleLimit,sampleCount:input.sampleCount,summary:input.summary,coverage:input.coverage,contentSha256:input.contentSha256,createdAt:new Date().toISOString(),cases:input.cases.map(item=>({...item,datasetSplit:input.split})),latestRun:null};candidateEvaluationDatasets.push(dataset);return{status:'ok',created:true,dataset};},
    listCandidateEvaluationDatasets:async(userId,topicId)=>candidateEvaluationDatasets.filter(item=>item.topicId===topicId&&topics.get(topicId)?.userId===userId).map(dataset=>({...dataset,latestRun:candidateEvaluationRuns.filter(run=>run.datasetId===dataset.id).at(-1)||null})),
    getCandidateEvaluationDatasetItems:async(userId,topicId,datasetId,evaluationKey=null)=>{const dataset=candidateEvaluationDatasets.find(item=>item.id===datasetId&&item.topicId===topicId&&topics.get(topicId)?.userId===userId);if(!dataset)return null;const selected=dataset.origin==='external-import'?null:evaluationKey||candidateAssessments.filter(item=>dataset.cases.some(entry=>entry.discoveryId===item.discoveryId)&&item.evaluatorKind==='model').at(-1)?.evaluationKey||null;return{dataset,evaluationKey:selected,items:dataset.cases.map(item=>{const model=candidateAssessments.filter(review=>review.discoveryId===item.discoveryId&&review.evaluatorKind==='model'&&review.evaluationKey===selected).at(-1);return{id:item.id,caseOrigin:item.caseOrigin,referenceUrl:item.referenceUrl,title:item.title,snippet:item.snippet,provider:item.provider,publisher:item.publisher,humanDecision:item.goldDecision,modelDecision:model?.decision||null};})};},
    recordCandidateEvaluationRun:async(userId,topicId,datasetId,input)=>{const dataset=candidateEvaluationDatasets.find(item=>item.id===datasetId&&item.topicId===topicId&&topics.get(topicId)?.userId===userId);if(!dataset)return null;for(const prediction of input.predictions??[]){if(!dataset.predictions)dataset.predictions=[];if(!dataset.predictions.some(item=>item.caseId===prediction.caseId&&item.evaluationKey===input.evaluationKey))dataset.predictions.push({...prediction,evaluationKey:input.evaluationKey});}let run=candidateEvaluationRuns.find(item=>item.datasetId===datasetId&&item.evaluationKey===input.evaluationKey&&item.inputSha256===input.inputSha256),created=false;if(!run){created=true;run={id:input.id,datasetId,evaluationKey:input.evaluationKey,datasetSha256:dataset.contentSha256,report:input.report,thresholds:input.thresholds,inputSha256:input.inputSha256,createdAt:new Date().toISOString()};candidateEvaluationRuns.push(run);}return{created,run};},
    listCandidateEvaluationRuns:async(userId,topicId,datasetId,limit=20)=>topics.get(topicId)?.userId===userId?candidateEvaluationRuns.filter(item=>item.datasetId===datasetId).slice(-limit).reverse():[],
    listCandidateEvaluationPredictions:async(userId,topicId,datasetId,{evaluationKey=null,limit=500}={})=>topics.get(topicId)?.userId===userId?(candidateEvaluationDatasets.find(item=>item.id===datasetId)?.predictions??[]).filter(item=>!evaluationKey||item.evaluationKey===evaluationKey).slice(-limit).reverse():[],
    reviewDiscovery:async(userId,topicId,discoveryId,input)=>{const discovery=discoveries.get(discoveryId);if(!discovery||discovery.userId!==userId||discovery.topicId!==topicId)return null;const existing=candidateAssessments.find(item=>item.discoveryId===discoveryId&&item.evaluationKey===input.evaluationKey&&item.inputSha256===input.inputSha256);if(existing)return existing;const review={...input,userId,topicId,discoveryId,createdAt:new Date().toISOString()};candidateAssessments.push(review);return review;},
    getSource:async(userId,topicId,sourceId)=>{const source=sources.get(sourceId);return source?.userId===userId&&source.topicId===topicId?source:null;},
    addSource:async(userId,topicId,input)=>{const existing=[...sources.values()].find(item=>item.userId===userId&&item.topicId===topicId&&item.url===input.url&&item.type===input.type);if(existing)return existing;const source={...input,userId,topicId,status:'candidate',authorityTier:'unknown',pinned:false,addedBy:'user',addedReason:'用户提交，等待确认'};sources.set(input.id,source);return source;},
    updateSource:async(userId,topicId,sourceId,status,input)=>{const source=sources.get(sourceId);if(!source||source.userId!==userId||source.topicId!==topicId)return null;if(source.status!==status){sourceStatusReviews.push({...input,userId,topicId,sourceId,previousStatus:source.status,decidedStatus:status,createdAt:new Date().toISOString()});Object.assign(source,{status});}return source;},
    listSourceStatusReviews:async(userId,topicId,sourceId)=>sourceStatusReviews.filter(item=>item.userId===userId&&item.topicId===topicId&&item.sourceId===sourceId).slice().reverse(),
    listSourceAuthorityReviews:async(userId,topicId,sourceId)=>authorityReviews.filter(item=>item.userId===userId&&item.topicId===topicId&&item.sourceId===sourceId).slice().reverse(),
    reviewSourceAuthority:async(userId,topicId,sourceId,input)=>{const source=sources.get(sourceId);if(!source||source.userId!==userId||source.topicId!==topicId)return null;const review={...input,userId,topicId,sourceId,previousTier:source.authorityTier,basis:'manual-review',createdAt:new Date().toISOString()};source.authorityTier=input.decidedTier;source.authorityReviewCount=(source.authorityReviewCount||0)+1;source.authorityReviewedAt=review.createdAt;authorityReviews.push(review);return review;},
    listSourceRelationships:async(userId,topicId)=>sourceRelationships.filter(item=>item.userId===userId&&item.topicId===topicId),
    reviewSourceRelationship:async(userId,topicId,input)=>{const left=sources.get(input.leftSourceId),right=sources.get(input.rightSourceId);if(!left||!right||left.userId!==userId||right.userId!==userId||left.topicId!==topicId||right.topicId!==topicId)return{status:'missing_source'};const prior=sourceRelationships.filter(item=>item.topicId===topicId&&new Set([item.leftSource.id,item.rightSource.id]).has(input.leftSourceId)&&new Set([item.leftSource.id,item.rightSource.id]).has(input.rightSourceId)),review={id:input.id,topicId,userId,revision:prior.length+1,relationship:input.relationship,rationale:input.rationale,leftSource:left,rightSource:right,createdAt:new Date().toISOString()};for(const item of prior)sourceRelationships.splice(sourceRelationships.indexOf(item),1);sourceRelationships.push(review);return{status:'reviewed',review};},
    listEntities:async(userId,topicId)=>[...entities.values()].filter(item=>item.userId===userId&&item.topicId===topicId),
    createEntity:async(userId,topicId,input)=>{const existing=[...entities.values()].find(item=>item.userId===userId&&item.topicId===topicId&&item.type===input.type&&item.normalizedName===input.normalizedName);if(existing)return existing;const entity={...input,userId,topicId,eventCount:0};entities.set(input.id,entity);return entity;},
    updateEntity:async(userId,topicId,entityId,status,input)=>{const entity=entities.get(entityId);if(!entity||entity.userId!==userId||entity.topicId!==topicId)return null;if(entity.status!==status){entityStatusReviews.push({...input,userId,topicId,entityId,previousStatus:entity.status,decidedStatus:status,createdAt:new Date().toISOString()});entity.status=status;}return entity;},
    listEntityStatusReviews:async(userId,topicId,entityId)=>entityStatusReviews.filter(item=>item.userId===userId&&item.topicId===topicId&&item.entityId===entityId).slice().reverse(),
    linkEventEntity:async()=>true,
    getOperationsSummary:async(userId,topicId,{days})=>topics.get(topicId)?.userId===userId?{schemaVersion:'research-operations-summary-v1',topicId,window:{days},runs:{total:1},actions:{total:2},usage:{providerCostUsdMicros:750}}:null,
    getStorageAssessment:async(userId,topicId)=>topics.get(topicId)?.userId===userId?{schemaVersion:'research-storage-assessment-v1',topicId,policy:{sourceVersionsDays:365},inventory:{versions:3,metadataBytes:900,evidenceRecords:2,evidenceQuoteBytes:120,inlineSnapshotBodies:1,inlineSnapshotBodyBytes:4096,externalBodyReferences:0,metadataOnlyVersions:2},retention:{olderThanPolicy:1,protectedByEvidence:1,protectedByEvents:1,protectedByVersionChain:0,protectedByLongerSharedPolicy:0,deletionCandidates:0,previewOnly:true},recommendation:{decision:'keep-relational-storage'},caveats:['只读评估，不会删除数据。']}:null,
    listBillingReconciliations:async(userId,topicId)=>billingReconciliations.filter(item=>item.userId===userId&&item.topicId===topicId).map(item=>item.reconciliation),
    createBillingReconciliation:async(userId,topicId,input)=>{if(topics.get(topicId)?.userId!==userId)return null;const existing=billingReconciliations.find(item=>item.topicId===topicId&&item.inputSha256===input.inputSha256);if(existing)return{created:false,reconciliation:existing.reconciliation};const reconciliation={id:input.id,topicId,provider:input.provider,periodStartAt:input.periodStartAt,periodEndAt:input.periodEndAt,statement:{billableRequests:input.statementBillableRequests,costUsdMicros:input.statementCostUsdMicros},ledger:{billableRequests:1,costUsdMicros:750},difference:{billableRequests:input.statementBillableRequests-1,costUsdMicros:input.statementCostUsdMicros-750},note:input.note};billingReconciliations.push({userId,topicId,inputSha256:input.inputSha256,reconciliation});return{created:true,reconciliation};},
    reviewBillingReconciliation:async(userId,topicId,reconciliationId,input)=>{const target=billingReconciliations.find(item=>item.userId===userId&&item.topicId===topicId&&item.reconciliation.id===reconciliationId);if(!target)return null;const review={id:input.id,reconciliationId,decision:input.decision,note:input.note};billingReviews.push(review);return review;},
  };
};

test('event cluster diagnostics collapse known-related sources without claiming independence',async()=>{
  const {buildEventClusterDiagnostic}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const diagnostic=buildEventClusterDiagnostic({id:uuids[0],event_type:'release',canonical_title:'Release 1',occurred_day:'2026-10-20',status:'candidate',member_count:3,supporting_evidence_count:2,opposing_evidence_count:1,sources:[{id:uuids[1],url:'https://publisher.example/a',type:'http',authorityTier:'official-primary'},{id:uuids[2],url:'https://mirror.example/a',type:'rss',authorityTier:'community'},{id:uuids[3],url:'https://review.example/a',type:'http',authorityTier:'independent-reputable'}]},[{revision:1,relationship:'shared-origin',leftSource:{id:uuids[1]},rightSource:{id:uuids[2]}},{revision:1,relationship:'editorially-independent',leftSource:{id:uuids[1]},rightSource:{id:uuids[3]}}]);
  assert.equal(diagnostic.sourceCount,3);
  assert.equal(diagnostic.provisionalLineageGroups,2);
  assert.equal(diagnostic.relationships.totalPairs,3);
  assert.equal(diagnostic.relationships.relatedPairs,1);
  assert.equal(diagnostic.relationships.editoriallyIndependentPairs,1);
  assert.equal(diagnostic.relationships.unreviewedPairs,1);
  assert.equal(diagnostic.evidence.opposing,1);
  assert.equal(diagnostic.independenceVerified,false);
  assert.deepEqual(diagnostic.attentionReasons,['known-related-sources','unreviewed-source-pairs','opposition-present']);
});

test('tier 0 candidate prefilter emits deterministic auditable scores without accepting evidence',async()=>{
  const {buildResearchCandidatePrefilter}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const relevantInput={topicTitle:'人工智能监管',objective:'长期追踪欧盟人工智能法案实施变化',questions:['欧盟人工智能法案有哪些新规？'],candidate:{title:'欧盟发布人工智能法案实施指南',snippet:'欧盟委员会今天发布新的人工智能监管实施指南和执行时间表。',url:'https://example.com/ai-act',siteName:'Example',publishedAt:'2026-10-21T00:00:00Z',rerankScore:2.5,authority:3}};
  const relevant=buildResearchCandidatePrefilter(relevantInput),repeated=buildResearchCandidatePrefilter(relevantInput),irrelevant=buildResearchCandidatePrefilter({topicTitle:'人工智能监管',objective:'长期追踪欧盟人工智能法案实施变化',questions:['欧盟人工智能法案有哪些新规？'],candidate:{title:'足球赛果',snippet:'主队获胜。',url:'https://example.com/sport',rerankScore:0.1,authority:0}});
  assert.equal(relevant.stage,'prefilter');
  assert.equal(relevant.evaluatorKind,'rule');
  assert.equal(relevant.evaluationKey,'tier0-prefilter-v1');
  assert.equal(relevant.decision,'relevant');
  assert.equal(relevant.inputSha256,repeated.inputSha256);
  assert.ok(relevant.dimensionScores.topicRelevance>=0.55);
  assert.ok(relevant.reasonCodes.includes('topic-term-match'));
  assert.match(relevant.rationale,/不代表内容真实/u);
  assert.equal(irrelevant.decision,'irrelevant');
  assert.ok(irrelevant.reasonCodes.includes('thin-candidate'));
});

test('metric period attribution compares only exact accepted series and preserves unknown periods',async()=>{
  const {buildMetricPeriodAttribution}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const row=(id,metricKey,value,observedAt,dimensions)=>({id,metric_key:metricKey,label:metricKey,value_type:'number',canonical_unit:'CNY/month',method_version:'direct-observation-v1',observed_at:observedAt,value_number:value,unit:'CNY/month',source_value_number:value,source_unit:'CNY/month',conversion_version:'identity-v1',conversion_numerator:1,conversion_denominator:1,dimensions,confidence:0.9,evidence_id:`evidence-${id}`,canonical_url:`https://example.com/${id}`,authority_tier:'official-primary'});
  const attribution=buildMetricPeriodAttribution({currentRows:[row('current-price','plan.price',12,'2026-10-20T00:00:00.000Z',{region:'CN',plan:'pro'}),row('new-count','seat.count',5,'2026-10-21T00:00:00.000Z',{plan:'pro'})],previousRows:[row('previous-price','plan.price',10,'2026-10-10T00:00:00.000Z',{plan:'pro',region:'CN'}),row('old-only','legacy.price',8,'2026-10-11T00:00:00.000Z',{plan:'legacy'})],currentWindow:{startAt:'2026-10-15T00:00:00.000Z',endAt:'2026-10-22T00:00:00.000Z'},previousWindow:{startAt:'2026-10-08T00:00:00.000Z',endAt:'2026-10-15T00:00:00.000Z'}});
  const price=attribution.series.find(item=>item.metricKey==='plan.price'),newSeries=attribution.series.find(item=>item.metricKey==='seat.count'),oldSeries=attribution.series.find(item=>item.metricKey==='legacy.price');
  assert.equal(attribution.schemaVersion,'research-metric-period-attribution-v1');
  assert.equal(price.status,'continued');
  assert.equal(price.change.absolute,2);
  assert.equal(price.change.relativePercent,20);
  assert.equal(price.current.latest.evidence.id,'evidence-current-price');
  assert.equal(newSeries.status,'new-series');
  assert.equal(oldSeries.status,'not-observed-this-period');
  assert.equal(oldSeries.current,null);
  assert.equal(attribution.summary.missingIsZero,false);
  assert.equal(attribution.causalAttribution,false);
  assert.match(attribution.caveats.join(' '),/不证明任何事件导致/u);
});

test('research topic service creates normalized versioned contracts and isolates accounts',async()=>{
  const {createResearchTopicService,ResearchTopicError}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  assert.throws(()=>service.list(null),error=>error instanceof ResearchTopicError&&error.code==='AUTH_REQUIRED');
  const topic=await service.create({userId:'user-1'},{title:' AI 编程工具 ',objective:' 长期追踪真实能力变化 ',contract:baseContract});
  assert.equal(topic.title,'AI 编程工具');
  assert.equal(topic.contract.schemaVersion,'research-contract-v1');
  assert.equal(topic.contract.budget.maxBillableRequestsPerMonth,100);
  assert.equal(topic.contract.budget.maxProviderCostUsdMicrosPerMonth,1000000);
  assert.equal(topic.currentContractVersion,1);
  assert.ok(new Date(topic.nextRunAt)>new Date());
  assert.equal((await service.list({userId:'user-1'})).length,1);
  await assert.rejects(service.get({userId:'user-2'},topic.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  const next=await service.createContract({userId:'user-1'},topic.id,{expectedVersion:1,contract:{...baseContract,questions:['哪些旧结论已经失效？']}});
  assert.equal(next.currentContractVersion,2);
  assert.equal(next.contract.questions[0],'哪些旧结论已经失效？');
  assert.ok(new Date(next.nextRunAt)>new Date());
  await assert.rejects(service.createContract({userId:'user-1'},topic.id,{expectedVersion:1,contract:baseContract}),error=>error.code==='RESEARCH_CONTRACT_VERSION_CONFLICT');
  const paused=await service.update({userId:'user-1'},topic.id,{status:'paused'});
  assert.equal(paused.nextRunAt,null);
  const resumed=await service.update({userId:'user-1'},topic.id,{status:'active'});
  assert.ok(new Date(resumed.nextRunAt)>new Date());
});

test('candidate evaluation gate measures model decisions against human labels and stays advisory',async()=>{
  const {buildExternalResearchCandidateEvaluationDataset,buildResearchCandidateEvaluationDataset,buildResearchCandidateEvaluationReport,buildResearchCandidateCoverageReport,detectResearchCandidateLanguage}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  assert.equal(detectResearchCandidateLanguage('欧盟发布新的监管指南'),'zh');
  assert.equal(detectResearchCandidateLanguage('OpenAI launches a new model'),'en');
  assert.equal(detectResearchCandidateLanguage('OpenAI 发布 new model'),'mixed');
  const items=Array.from({length:50},(_,index)=>({id:String(index),title:index%2?'欧盟人工智能法案更新':'AI regulation update',snippet:'A material policy change was published.',provider:'deepseek-search',publisher:index<30?'News A':'News B',humanDecision:index<30?'relevant':'irrelevant',modelDecision:index===0?'irrelevant':index===30?'relevant':'relevant'}));
  for(let index=31;index<50;index+=1)items[index].modelDecision='irrelevant';
  const report=buildResearchCandidateEvaluationReport({evaluationKey:'tier1-value-v1:deepseek-chat',items});
  assert.equal(report.schemaVersion,'research-candidate-evaluation-v1');
  assert.equal(report.mode,'shadow');
  assert.equal(report.automationAllowed,false);
  assert.equal(report.overall.labeledCount,50);
  assert.equal(report.overall.confusion.truePositive,29);
  assert.equal(report.overall.confusion.falsePositive,1);
  assert.equal(report.overall.confusion.falseNegative,1);
  assert.equal(report.status,'eligible-for-controlled-pilot');
  assert.equal(report.bySource.length,2);
  const insufficient=buildResearchCandidateEvaluationReport({items:items.slice(0,10)});
  assert.equal(insufficient.status,'insufficient-data');
  const frozen=buildResearchCandidateEvaluationDataset({topicId:uuids[0],name:'候选相关性开发集 v1',split:'development',sampleSize:4,candidates:[{id:uuids[1],humanAssessmentId:uuids[5],humanDecision:'relevant',title:'中文政策更新',snippet:'发布新的监管办法',provider:'search'},{id:uuids[2],humanAssessmentId:uuids[6],humanDecision:'irrelevant',title:'Football result',snippet:'The home team won.',provider:'search'},{id:uuids[3],humanAssessmentId:uuids[7],humanDecision:'relevant',title:'AI policy update',snippet:'A new regulation was published.',provider:'search'},{id:uuids[4],humanAssessmentId:uuids[8],humanDecision:'irrelevant',title:'娱乐新闻',snippet:'与专题无关',provider:'search'},{id:uuids[9],humanAssessmentId:uuids[10],humanDecision:'relevant',title:'已进入保留集',snippet:'不能进入开发集',provider:'search',assignedSplit:'holdout'}]});
  assert.equal(frozen.sampleCount,4);
  assert.equal(frozen.summary.labels.relevant,2);
  assert.equal(frozen.summary.labels.irrelevant,2);
  assert.equal(frozen.cases.some(item=>item.discoveryId===uuids[9]),false);
  assert.match(frozen.contentSha256,/^[a-f0-9]{64}$/u);
  const renamed=buildResearchCandidateEvaluationDataset({topicId:uuids[0],name:'同一冻结内容的显示名称',split:'development',sampleSize:4,candidates:[{id:uuids[1],humanAssessmentId:uuids[5],humanDecision:'relevant',title:'中文政策更新',snippet:'发布新的监管办法',provider:'search'},{id:uuids[2],humanAssessmentId:uuids[6],humanDecision:'irrelevant',title:'Football result',snippet:'The home team won.',provider:'search'},{id:uuids[3],humanAssessmentId:uuids[7],humanDecision:'relevant',title:'AI policy update',snippet:'A new regulation was published.',provider:'search'},{id:uuids[4],humanAssessmentId:uuids[8],humanDecision:'irrelevant',title:'娱乐新闻',snippet:'与专题无关',provider:'search'}]});
  assert.deepEqual(renamed.cases,frozen.cases);
  assert.equal(renamed.contentSha256,frozen.contentSha256);
  const externalCases=Array.from({length:50},(_,index)=>({externalId:`audit-${index}`,title:index%2?`中文新闻 ${index}`:`English news ${index}`,snippet:index%2?'独立审计摘要内容':'Independent audit excerpt',provider:'external-audit',publisher:`Publisher ${index%5}`,goldDecision:index<25?'relevant':'irrelevant',language:index%2?'zh':'en',referenceUrl:`https://news.example/${index}`,provenanceNote:'Independent reviewer labeled this candidate from the cited source.'}));
  const external=buildExternalResearchCandidateEvaluationDataset({topicId:uuids[0],name:'独立保留集',split:'holdout',cases:externalCases});
  const externalReordered=buildExternalResearchCandidateEvaluationDataset({topicId:uuids[0],name:'重命名',split:'holdout',cases:externalCases.toReversed()});
  assert.equal(external.origin,'external-import');
  assert.equal(external.coverage.status,'coverage-balanced');
  assert.equal(external.coverage.structuralCoveragePassed,true);
  assert.equal(external.coverage.representative,false);
  assert.equal(external.coverage.sourceCount,5);
  assert.equal(external.contentSha256,externalReordered.contentSha256);
  assert.deepEqual(external.cases,externalReordered.cases);
  assert.equal(buildResearchCandidateCoverageReport({cases:external.cases.slice(0,10)}).status,'insufficient-samples');
  assert.equal(buildResearchCandidateCoverageReport({cases:external.cases.map(item=>({...item,sourceLabel:'Only source'}))}).status,'review-required');
});

test('external candidate audit imports stay immutable across development and holdout splits',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let counter=100;
  const service=createResearchTopicService({repository,ids:()=>`00000000-0000-4000-8000-${String(counter++).padStart(12,'0')}`});
  const topic=await service.create({userId:'user-1'},{title:'外部候选审计',objective:'用独立样本验证新闻候选相关性',contract:baseContract});
  const cases=[{externalId:'audit-1',title:'Independent policy update',snippet:'A regulator published a material update.',provider:'external-audit',publisher:'Publisher A',goldDecision:'relevant',language:'en',referenceUrl:'https://news.example/a',provenanceNote:'Independent reviewer checked the cited publication.'},{externalId:'audit-2',title:'无关体育新闻',snippet:'比赛结果与专题无关。',provider:'external-audit',publisher:'Publisher B',goldDecision:'irrelevant',language:'zh',referenceUrl:'https://news.example/b',provenanceNote:'独立复核员依据所引用的公开页面完成标注。'}];
  const imported=await service.importCandidateEvaluationDataset({userId:'user-1'},topic.id,{name:'外部开发集 v1',split:'development',cases});
  assert.equal(imported.created,true);
  assert.equal(imported.dataset.origin,'external-import');
  assert.equal(imported.dataset.coverage.representative,false);
  const evaluated=await service.runCandidateEvaluationDataset({userId:'user-1'},topic.id,imported.dataset.id,{});
  assert.equal(evaluated.created,true);
  assert.equal(evaluated.run.evaluationKey,'tier0-prefilter-v1');
  assert.equal(evaluated.run.report.evaluatorKind,'rule');
  assert.equal(evaluated.run.report.automationAllowed,false);
  assert.equal(imported.dataset.predictions.length,2);
  assert.equal((await service.listCandidateEvaluationPredictions({userId:'user-1'},topic.id,imported.dataset.id,{evaluationKey:'tier0-prefilter-v1'})).length,2);
  assert.equal((await service.runCandidateEvaluationDataset({userId:'user-1'},topic.id,imported.dataset.id,{})).created,false);
  await assert.rejects(service.runCandidateEvaluationDataset({userId:'user-1'},topic.id,imported.dataset.id,{evaluationKey:'tier1-value-v1:deepseek-chat'}),error=>error.code==='RESEARCH_CANDIDATE_EVALUATION_UNAVAILABLE');
  await assert.rejects(service.importCandidateEvaluationDataset({userId:'user-1'},topic.id,{name:'泄漏保留集',split:'holdout',cases}),error=>error.code==='RESEARCH_CANDIDATE_DATASET_SPLIT_CONFLICT');
  await assert.rejects(service.importCandidateEvaluationDataset({userId:'user-1'},topic.id,{name:'非法地址',split:'holdout',cases:[{...cases[0],externalId:'bad-url',referenceUrl:'file:///secret'}]}),error=>error.code==='RESEARCH_CANDIDATE_DATASET_IMPORT_INVALID');
});

test('research candidate reviews are append-only, idempotent and separate from source status',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  const topic=await service.create({userId:'user-1'},{title:'新闻候选评估',objective:'保留候选判断而不直接采信为事实',contract:baseContract});
  const discoveryId=uuids[5];
  repository.discoveries.set(discoveryId,{id:discoveryId,userId:'user-1',topicId:topic.id,sourceId:uuids[6],sourceStatus:'candidate',title:'候选报道',url:'https://example.com/news'});
  const input={decision:'relevant',rationale:'该报道直接回答专题的长期观察问题，但仍需获取原文证据。'};
  const first=await service.reviewDiscovery({userId:'user-1'},topic.id,discoveryId,input);
  const repeated=await service.reviewDiscovery({userId:'user-1'},topic.id,discoveryId,input);
  assert.equal(first.id,repeated.id);
  assert.equal(first.decision,'relevant');
  assert.equal(first.evaluatorKind,'human');
  assert.equal(repository.candidateAssessments.length,1);
  assert.equal(repository.discoveries.get(discoveryId).sourceStatus,'candidate','candidate relevance must not silently activate the whole source');
  assert.equal((await service.listDiscoveries({userId:'user-1'},topic.id))[0].latestAssessment.decision,'relevant');
  assert.equal((await service.listDiscoveries({userId:'user-1'},topic.id,{decision:'relevant',evaluatorKind:'human',sourceStatus:'candidate',sort:'priority'})).length,1);
  assert.equal((await service.listDiscoveries({userId:'user-1'},topic.id,{decision:'irrelevant'})).length,0);
  const stats=await service.getDiscoveryStats({userId:'user-1'},topic.id);
  assert.equal(stats.schemaVersion,'research-candidate-stats-v1');
  assert.equal(stats.total,1);
  assert.equal(stats.decisions.relevant,1);
  assert.equal(stats.evaluatorKinds.human,1);
  assert.equal(stats.sourceStatuses.candidate,1);
  const evaluation=await service.getCandidateEvaluation({userId:'user-1'},topic.id);
  assert.equal(evaluation.schemaVersion,'research-candidate-evaluation-v1');
  assert.equal(evaluation.status,'insufficient-data');
  assert.equal(evaluation.automationAllowed,false);
  repository.candidateAssessments.push({id:uuids[10],topicId:topic.id,discoveryId,evaluatorKind:'model',stage:'value',evaluationKey:'tier1-value-v1:deepseek-chat',decision:'relevant',dimensionScores:{topicRelevance:0.9},rationale:'模型认为该候选与专题直接相关，建议进入人工复核。'});
  const createdDataset=await service.createCandidateEvaluationDataset({userId:'user-1'},topic.id,{name:'候选相关性开发集 v1',split:'development',sampleSize:10});
  assert.equal(createdDataset.created,true);
  assert.equal(createdDataset.dataset.sampleCount,1);
  assert.equal(createdDataset.dataset.split,'development');
  const evaluationRun=await service.runCandidateEvaluationDataset({userId:'user-1'},topic.id,createdDataset.dataset.id,{evaluationKey:'tier1-value-v1:deepseek-chat'});
  assert.equal(evaluationRun.created,true);
  assert.equal(evaluationRun.run.report.mode,'offline-development');
  assert.equal(evaluationRun.run.report.automationAllowed,false);
  assert.equal((await service.listCandidateEvaluationDatasets({userId:'user-1'},topic.id)).length,1);
  assert.equal((await service.listCandidateEvaluationRuns({userId:'user-1'},topic.id,createdDataset.dataset.id)).length,1);
  await assert.rejects(service.createCandidateEvaluationDataset({userId:'user-1'},topic.id,{name:'候选相关性保留集 v1',split:'holdout',sampleSize:10}),error=>error.code==='RESEARCH_CANDIDATE_DATASET_EMPTY');
  await assert.rejects(service.listDiscoveries({userId:'user-1'},topic.id,{minTopicRelevance:2}),error=>error.code==='RESEARCH_CANDIDATE_FILTER_INVALID');
  await assert.rejects(service.getCandidateEvaluation({userId:'user-1'},topic.id,{evaluationKey:'bad key'}),error=>error.code==='RESEARCH_CANDIDATE_EVALUATION_KEY_INVALID');
  await assert.rejects(service.reviewDiscovery({userId:'user-1'},topic.id,discoveryId,{decision:'relevant',rationale:'太短'}),error=>error.code==='RESEARCH_CANDIDATE_REVIEW_INVALID');
  await assert.rejects(service.reviewDiscovery({userId:'user-2'},topic.id,discoveryId,input),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
});

test('research topic service validates bounded contracts and links only owned watches',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();
  let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  await assert.rejects(service.create({userId:'user-1'},{title:'空契约',objective:'验证边界',contract:{questions:[]}}),error=>error.code==='RESEARCH_CONTRACT_INVALID');
  await assert.rejects(service.create({userId:'user-1'},{title:'错误时区',objective:'验证自然周期边界',contract:{...baseContract,schedule:{cadence:'weekly',timezone:'Mars/Olympus'}}}),error=>error.code==='RESEARCH_CONTRACT_INVALID');
  await assert.rejects(service.create({userId:'user-1'},{title:'错误月预算',objective:'验证专题成本硬门禁',contract:{...baseContract,budget:{...baseContract.budget,maxProviderCostUsdMicrosPerMonth:-1}}}),error=>error.code==='RESEARCH_CONTRACT_INVALID');
  const topic=await service.create({userId:'user-1'},{title:'行业观察',objective:'观察长期变化',contract:baseContract});
  const linked=await service.linkWatch({userId:'user-1'},topic.id,uuids[1]);
  assert.equal(linked.watchId,uuids[1]);
  assert.equal((await service.listWatches({userId:'user-1'},topic.id)).length,1);
  const second=await service.create({userId:'user-1'},{title:'第二专题',objective:'验证监控不能被静默抢占',contract:{...baseContract,schedule:{cadence:'manual',timezone:'Asia/Shanghai'}}});
  assert.equal(second.nextRunAt,null);
  await assert.rejects(service.linkWatch({userId:'user-1'},second.id,uuids[1]),error=>error.code==='RESEARCH_WATCH_ALREADY_LINKED'&&error.statusCode===409);
  await assert.rejects(service.linkWatch({userId:'user-2'},topic.id,uuids[1]),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  await service.unlinkWatch({userId:'user-1'},topic.id,uuids[1]);
  assert.equal((await service.listWatches({userId:'user-1'},topic.id)).length,0);
});

test('research topic service exposes an account-isolated bounded operations window',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  const topic=await service.create({userId:'user-1'},{title:'运行体检',objective:'观察长期运行成本和质量',contract:baseContract});
  const summary=await service.getOperationsSummary({userId:'user-1'},topic.id,{days:90});
  assert.equal(summary.schemaVersion,'research-operations-summary-v1');
  assert.equal(summary.window.days,90);
  assert.deepEqual(summary.queueCapacity,{scope:'account',queued:0,active:0,maxActive:1,availableSlots:1});
  assert.match(summary.caveats.at(-1),/不代表平台总体吞吐量/u);
  await assert.rejects(service.getOperationsSummary({userId:'user-1'},topic.id,{days:6}),error=>error.code==='RESEARCH_OPERATIONS_WINDOW_INVALID');
  await assert.rejects(service.getOperationsSummary({userId:'user-2'},topic.id,{days:30}),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
});

test('research storage assessment is read-only, explicit about payload coverage, and account isolated',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  const topic=await service.create({userId:'user-1'},{title:'存储盘点',objective:'区分正文、摘录和元数据',contract:baseContract});
  const assessment=await service.getStorageAssessment({userId:'user-1'},topic.id);
  assert.equal(assessment.schemaVersion,'research-storage-assessment-v1');
  assert.equal(assessment.retention.previewOnly,true);
  assert.equal(assessment.inventory.metadataOnlyVersions,2);
  assert.deepEqual(assessment.policy.candidateRawBody,{version:'discard-after-extraction-v1',persisted:false,ttlSeconds:0,maxEvidenceChars:1200});
  assert.match(assessment.caveats[0],/不会删除/u);
  await assert.rejects(service.getStorageAssessment({userId:'user-2'},topic.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
});

test('research billing reconciliation is bounded, idempotent and never mutates the usage ledger',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const repository=createMemoryRepository();let index=0;
  const service=createResearchTopicService({repository,ids:()=>uuids[index++]});
  const topic=await service.create({userId:'user-1'},{title:'账单核对',objective:'冻结供应商账单与平台账本差异',contract:baseContract});
  const input={provider:'deepseek-search',periodStartAt:'2026-09-01T00:00:00.000Z',periodEndAt:'2026-10-01T00:00:00.000Z',statementBillableRequests:2,statementCostUsdMicros:1000,sourceReference:'invoice-2026-09',note:'人工录入供应商月度账单汇总，仅用于核对差异。'};
  const first=await service.createBillingReconciliation({userId:'user-1'},topic.id,input),again=await service.createBillingReconciliation({userId:'user-1'},topic.id,input);
  assert.equal(first.created,true);
  assert.equal(again.created,false);
  assert.deepEqual(first.reconciliation.difference,{billableRequests:1,costUsdMicros:250});
  assert.equal((await service.listBillingReconciliations({userId:'user-1'},topic.id)).length,1);
  const review=await service.reviewBillingReconciliation({userId:'user-1'},topic.id,first.reconciliation.id,{decision:'disputed',note:'供应商汇总高于平台账本，需要人工核对原始发票。'});
  assert.equal(review.decision,'disputed');
  await assert.rejects(service.createBillingReconciliation({userId:'user-1'},topic.id,{...input,periodEndAt:'2027-10-01T00:00:00.000Z'}),error=>error.code==='RESEARCH_BILLING_RECONCILIATION_INVALID');
  await assert.rejects(service.listBillingReconciliations({userId:'user-2'},topic.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
});

test('research source policy uses the frozen type and authority threshold without provider-score shortcuts',async()=>{
  const {researchSourcePolicyDecision}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const strict={sourcePolicy:{allowedTypes:['rss','github'],minAuthorityTier:'institutional'}};
  assert.deepEqual(researchSourcePolicyDecision({type:'rss',authorityTier:'official-primary'},strict),{eligible:true,reason:'eligible',minimumAuthorityTier:'institutional',authorityTier:'official-primary'});
  assert.equal(researchSourcePolicyDecision({type:'rss',authorityTier:'community'},strict).reason,'authority-below-minimum');
  assert.equal(researchSourcePolicyDecision({type:'http',authorityTier:'official-primary'},strict).reason,'type-not-allowed');
  assert.equal(researchSourcePolicyDecision({type:'rss',authorityTier:'unknown'},{sourcePolicy:{allowedTypes:['rss'],minAuthorityTier:'unknown'}}).eligible,true);
});

test('webpage, RSS and GitHub Release candidates require confirmation and reject unsafe inputs',async()=>{
  const [{createResearchTopicService},{parseSyndicationFeed},{createGitHubReleaseAdapter,normalizeGitHubRepositoryUrl}]=await Promise.all([
    import(moduleUrl('apps/api/src/research-topic-service.mjs')),
    import(moduleUrl('apps/api/src/research-feed-adapter.mjs')),
    import(moduleUrl('apps/api/src/research-github-adapter.mjs')),
  ]);
  const repository=createMemoryRepository();let index=0;
  const rss=`<?xml version="1.0"?><rss version="2.0"><channel><title>官方更新</title><link>https://updates.example.com/</link><item><guid>release-1</guid><title>版本 1 发布</title><link>/release-1</link><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>修复关键问题</p>]]></description></item></channel></rss>`;
  const preview=parseSyndicationFeed(rss,{url:'https://updates.example.com/feed.xml'});
  const githubAdapter=createGitHubReleaseAdapter({feedAdapter:{inspect:async url=>({...preview,feed:{...preview.feed,url}})}});
  const service=createResearchTopicService({repository,ids:()=>uuids[index++],validateSourceUrl:async value=>new URL(value),feedAdapter:{inspect:async()=>preview},githubAdapter});
  const topic=await service.create({userId:'user-1'},{title:'版本追踪',objective:'验证来源后再追踪',contract:baseContract});
  const source=await service.addSource({userId:'user-1'},topic.id,{type:'rss',url:'https://updates.example.com/feed.xml'});
  assert.equal(source.status,'candidate');
  assert.equal(repository.sources.size,1);
  assert.equal((await service.inspectSource({userId:'user-1'},topic.id,source.id)).entries[0].externalId,'release-1');
  assert.equal((await service.updateSource({userId:'user-1'},topic.id,source.id,{status:'tracked'})).status,'tracked');
  const statusHistory=await service.listSourceStatusReviews({userId:'user-1'},topic.id,source.id);
  assert.equal(statusHistory.length,1);
  assert.equal(statusHistory[0].previousStatus,'candidate');
  assert.equal(statusHistory[0].decidedStatus,'tracked');
  assert.equal(statusHistory[0].basis,'manual-status-control');
  await assert.rejects(service.listSourceStatusReviews({userId:'user-2'},topic.id,source.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  const authorityReview=await service.reviewSourceAuthority({userId:'user-1'},topic.id,source.id,{decidedTier:'official-primary',rationale:'已核对该来源由产品官方直接维护并发布更新。'});
  assert.equal(authorityReview.previousTier,'unknown');
  assert.equal(authorityReview.decidedTier,'official-primary');
  assert.equal((await service.listSourceAuthorityReviews({userId:'user-1'},topic.id,source.id))[0].rationale,'已核对该来源由产品官方直接维护并发布更新。');
  assert.equal((await service.listSources({userId:'user-1'},topic.id))[0].authorityTier,'official-primary');
  await assert.rejects(service.reviewSourceAuthority({userId:'user-1'},topic.id,source.id,{decidedTier:'community',rationale:'太短'}),error=>error.code==='RESEARCH_SOURCE_AUTHORITY_INVALID');
  await assert.rejects(service.listSourceAuthorityReviews({userId:'user-2'},topic.id,source.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  await assert.rejects(service.inspectSource({userId:'user-2'},topic.id,source.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  const github=await service.addSource({userId:'user-1'},topic.id,{type:'github',url:'https://github.com/openai/codex'});
  assert.equal(github.status,'candidate');
  const relationship=await service.reviewSourceRelationship({userId:'user-1'},topic.id,{leftSourceId:source.id,rightSourceId:github.id,relationship:'shared-origin',rationale:'GitHub 发布说明明确链接到该官方更新订阅源。'});
  assert.equal(relationship.relationship,'shared-origin');
  assert.equal(relationship.revision,1);
  assert.equal((await service.listSourceRelationships({userId:'user-1'},topic.id))[0].rightSource.id,github.id);
  await assert.rejects(service.reviewSourceRelationship({userId:'user-1'},topic.id,{leftSourceId:source.id,rightSourceId:source.id,relationship:'unknown',rationale:'不能把同一个来源与自身建立关系。'}),error=>error.code==='RESEARCH_SOURCE_RELATIONSHIP_INVALID');
  await assert.rejects(service.listSourceRelationships({userId:'user-2'},topic.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  const entity=(await service.listEntities({userId:'user-1'},topic.id))[0];
  assert.equal(entity.name,'openai/codex');
  assert.equal(entity.status,'candidate');
  assert.equal((await service.updateEntity({userId:'user-1'},topic.id,entity.id,{status:'tracked'})).status,'tracked');
  const entityHistory=await service.listEntityStatusReviews({userId:'user-1'},topic.id,entity.id);
  assert.equal(entityHistory.length,1);
  assert.equal(entityHistory[0].previousStatus,'candidate');
  assert.equal(entityHistory[0].decidedStatus,'tracked');
  await assert.rejects(service.listEntityStatusReviews({userId:'user-2'},topic.id,entity.id),error=>error.code==='RESEARCH_TOPIC_NOT_FOUND');
  assert.equal((await service.inspectSource({userId:'user-1'},topic.id,github.id)).protocol,'github-release-preview-v1');
  assert.equal(normalizeGitHubRepositoryUrl('https://github.com/openai/codex.git').href,'https://github.com/openai/codex');
  assert.throws(()=>normalizeGitHubRepositoryUrl('https://github.com/openai/codex/releases'),error=>error.code==='RESEARCH_GITHUB_URL_INVALID');
  const restricted=await service.create({userId:'user-1'},{title:'仅网页',objective:'只允许网页来源',contract:{...baseContract,sourcePolicy:{...baseContract.sourcePolicy,allowedTypes:['http']}}});
  const webpage=await service.addSource({userId:'user-1'},restricted.id,{type:'http',url:'https://news.example.com/reports/quarterly-change'});
  assert.equal(webpage.type,'http');
  assert.equal(webpage.status,'candidate');
  assert.equal(webpage.url,'https://news.example.com/reports/quarterly-change');
  await assert.rejects(service.inspectSource({userId:'user-1'},restricted.id,webpage.id),error=>error.code==='RESEARCH_SOURCE_INSPECTION_UNAVAILABLE');
  await assert.rejects(service.addSource({userId:'user-1'},restricted.id,{type:'rss',url:'https://updates.example.com/feed.xml'}),error=>error.code==='RESEARCH_SOURCE_TYPE_NOT_ALLOWED');
  await assert.rejects(service.addSource({userId:'user-1'},restricted.id,{type:'pdf',url:'https://papers.example.com/report.pdf'}),error=>error.code==='RESEARCH_SOURCE_TYPE_UNSUPPORTED');
  assert.throws(()=>parseSyndicationFeed('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&xxe;</title></item></channel></rss>'),error=>error.code==='RESEARCH_FEED_UNSAFE_XML');
});

test('research topic routes require authentication and expose versioned contract updates',async t=>{
  const [{default:Fastify},{registerResearchTopicRoutes}]=await Promise.all([import(moduleUrl('apps/api/node_modules/fastify/fastify.js')),import(moduleUrl('apps/api/src/research-topic-routes.mjs'))]);
  const app=Fastify({logger:false});
  const service={
    list:async()=>[],
    create:async(_actor,body)=>({id:uuids[0],...body,currentContractVersion:1}),
    get:async()=>({id:uuids[0]}),
    update:async()=>({id:uuids[0],status:'paused'}),
    createContract:async(_actor,_id,body)=>({id:uuids[0],currentContractVersion:body.expectedVersion+1}),
    listWatches:async()=>[],linkWatch:async()=>({id:uuids[0],watchId:uuids[1]}),unlinkWatch:async()=>({id:uuids[0],watchId:uuids[1]}),
    listRuns:async()=>[{id:uuids[2],status:'no_change'}],triggerRun:async()=>({id:uuids[2],status:'queued'}),
    listRunActions:async()=>[{id:uuids[1],status:'completed',kind:'feed-fetch'}],
    getOperationsSummary:async(_actor,_id,{days})=>({schemaVersion:'research-operations-summary-v1',window:{days},runs:{total:1}}),
    getStorageAssessment:async()=>({schemaVersion:'research-storage-assessment-v1',retention:{previewOnly:true},inventory:{versions:3}}),
    listBillingReconciliations:async()=>[{id:uuids[4],provider:'deepseek-search'}],createBillingReconciliation:async()=>({created:true,reconciliation:{id:uuids[4],provider:'deepseek-search'}}),reviewBillingReconciliation:async()=>({id:uuids[5],decision:'acknowledged'}),
    listSources:async()=>[{id:uuids[1],url:'https://example.com'}],listSourceRelationships:async()=>[{id:uuids[4],relationship:'shared-origin'}],reviewSourceRelationship:async()=>({id:uuids[4],relationship:'shared-origin'}),listDiscoveries:async()=>[{id:uuids[2],sourceId:uuids[1],title:'候选页面'}],getDiscoveryStats:async()=>({schemaVersion:'research-candidate-stats-v1',total:1}),getCandidateEvaluation:async()=>({schemaVersion:'research-candidate-evaluation-v1',status:'insufficient-data',automationAllowed:false}),listCandidateEvaluationDatasets:async()=>[{id:uuids[3],split:'development',sampleCount:1}],createCandidateEvaluationDataset:async()=>({created:true,dataset:{id:uuids[3],split:'development',sampleCount:1}}),listCandidateEvaluationRuns:async()=>[{id:uuids[4],evaluationKey:'tier1-value-v1:deepseek-chat'}],runCandidateEvaluationDataset:async()=>({created:true,run:{id:uuids[4],report:{automationAllowed:false}}}),reviewDiscovery:async()=>({id:uuids[5],decision:'relevant',evaluatorKind:'human'}),addSource:async()=>({id:uuids[1],status:'candidate'}),updateSource:async()=>({id:uuids[1],status:'tracked'}),listSourceStatusReviews:async()=>[{id:uuids[5],sourceId:uuids[1],previousStatus:'candidate',decidedStatus:'tracked'}],listSourceAuthorityReviews:async()=>[{id:uuids[4],sourceId:uuids[1],decidedTier:'official-primary'}],reviewSourceAuthority:async()=>({id:uuids[4],sourceId:uuids[1],decidedTier:'official-primary'}),inspectSource:async()=>({protocol:'syndication-preview-v1',entries:[{externalId:'release-1'}]}),listEntities:async()=>[{id:uuids[3],name:'openai/codex',status:'candidate'}],createEntity:async()=>({id:uuids[3],name:'openai/codex',status:'candidate'}),updateEntity:async()=>({id:uuids[3],name:'openai/codex',status:'tracked'}),listEntityStatusReviews:async()=>[{id:uuids[5],entityId:uuids[3],previousStatus:'candidate',decidedStatus:'tracked'}],listEvidence:async()=>[{id:uuids[2],quote:'变化'}],listEvents:async()=>[{id:uuids[2],title:'官方更新发生变化'}],listEventClusterDiagnostics:async()=>({schemaVersion:'research-event-cluster-diagnostics-v1',items:[{id:uuids[5],sourceCount:2,independenceVerified:false}]}),listReports:async()=>[{id:uuids[4],runId:uuids[2],kind:'run-summary'}],listNotifications:async()=>[{id:uuids[2],title:'官方更新发生变化',isRead:false}],markNotificationRead:async()=>({id:uuids[2],isRead:true}),linkEventEntity:async()=>({eventId:uuids[2],entityId:uuids[3]}),
  };
  const requireAuth=async request=>{if(request.headers.authorization!=='Bearer ok'){const error=new Error('Authentication required.');error.statusCode=401;throw error;}request.actor={userId:'user-1'};};
  registerResearchTopicRoutes(app,{service,requireAuth});t.after(()=>app.close());
  assert.equal((await app.inject({method:'GET',url:'/v1/me/research-topics'})).statusCode,401);
  const created=await app.inject({method:'POST',url:'/v1/me/research-topics',headers:{authorization:'Bearer ok'},payload:{title:'专题',objective:'长期追踪',contract:baseContract}});
  assert.equal(created.statusCode,201);
  assert.equal(created.json().data.currentContractVersion,1);
  const versioned=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/contracts`,headers:{authorization:'Bearer ok'},payload:{expectedVersion:1,contract:baseContract}});
  assert.equal(versioned.statusCode,201);
  assert.equal(versioned.json().data.currentContractVersion,2);
  const linked=await app.inject({method:'PUT',url:`/v1/me/research-topics/${uuids[0]}/watches/${uuids[1]}`,headers:{authorization:'Bearer ok'}});
  assert.equal(linked.statusCode,200);
  const runs=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/runs`,headers:{authorization:'Bearer ok'}});
  assert.equal(runs.json().data[0].status,'no_change');
  const triggered=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/runs`,headers:{authorization:'Bearer ok'}});
  assert.equal(triggered.statusCode,202);
  assert.equal(triggered.json().data.status,'queued');
  const actions=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/runs/${uuids[2]}/actions`,headers:{authorization:'Bearer ok'}});
  assert.equal(actions.json().data[0].kind,'feed-fetch');
  const operations=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/operations-summary?days=90`,headers:{authorization:'Bearer ok'}});
  assert.equal(operations.json().data.schemaVersion,'research-operations-summary-v1');
  assert.equal(operations.json().data.window.days,90);
  const storage=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/storage-assessment`,headers:{authorization:'Bearer ok'}});
  assert.equal(storage.json().data.schemaVersion,'research-storage-assessment-v1');
  assert.equal(storage.json().data.retention.previewOnly,true);
  const reconciliations=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/billing-reconciliations`,headers:{authorization:'Bearer ok'}});
  const reconciled=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/billing-reconciliations`,headers:{authorization:'Bearer ok'},payload:{provider:'deepseek-search',periodStartAt:'2026-09-01T00:00:00.000Z',periodEndAt:'2026-10-01T00:00:00.000Z',statementBillableRequests:1,statementCostUsdMicros:750,note:'人工导入供应商月度账单汇总用于核对。'}});
  const reconciliationReviewed=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/billing-reconciliations/${uuids[4]}/reviews`,headers:{authorization:'Bearer ok'},payload:{decision:'acknowledged',note:'平台账本与供应商汇总一致，已人工核对。'}});
  assert.equal(reconciliations.json().data[0].provider,'deepseek-search');
  assert.equal(reconciled.statusCode,201);
  assert.equal(reconciliationReviewed.statusCode,201);
  const sources=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/sources`,headers:{authorization:'Bearer ok'}});
  const sourceRelationships=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/source-relationships`,headers:{authorization:'Bearer ok'}});
  const sourceRelationshipReviewed=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/source-relationships`,headers:{authorization:'Bearer ok'},payload:{leftSourceId:uuids[1],rightSourceId:uuids[2],relationship:'shared-origin',rationale:'两处页面明确标注相同的原始发布来源。'}});
  const discoveries=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/discoveries?decision=relevant&evaluatorKind=human&sourceStatus=candidate&sort=priority&minTopicRelevance=0.5`,headers:{authorization:'Bearer ok'}});
  const discoveryStats=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/discovery-stats`,headers:{authorization:'Bearer ok'}});
  const candidateEvaluation=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/candidate-evaluation`,headers:{authorization:'Bearer ok'}});
  const candidateDatasets=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/candidate-evaluation-datasets`,headers:{authorization:'Bearer ok'}});
  const candidateDatasetCreated=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/candidate-evaluation-datasets`,headers:{authorization:'Bearer ok'},payload:{name:'候选开发集 v1',split:'development',sampleSize:50}});
  const candidateDatasetRuns=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/candidate-evaluation-datasets/${uuids[3]}/runs`,headers:{authorization:'Bearer ok'}});
  const candidateDatasetRun=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/candidate-evaluation-datasets/${uuids[3]}/runs`,headers:{authorization:'Bearer ok'},payload:{evaluationKey:'tier1-value-v1:deepseek-chat'}});
  const discoveryReviewed=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/discoveries/${uuids[2]}/reviews`,headers:{authorization:'Bearer ok'},payload:{decision:'relevant',rationale:'该候选直接回答专题问题，下一步需要获取原始页面。'}});
  const entities=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/entities`,headers:{authorization:'Bearer ok'}});
  const entityAdded=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/entities`,headers:{authorization:'Bearer ok'},payload:{type:'project',name:'openai/codex'}});
  const entityTracked=await app.inject({method:'PATCH',url:`/v1/me/research-topics/${uuids[0]}/entities/${uuids[3]}`,headers:{authorization:'Bearer ok'},payload:{status:'tracked'}});
  const entityHistory=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/entities/${uuids[3]}/status-reviews`,headers:{authorization:'Bearer ok'}});
  const added=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/sources`,headers:{authorization:'Bearer ok'},payload:{url:'https://updates.example.com/feed.xml',type:'rss'}});
  const webpageAdded=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/sources`,headers:{authorization:'Bearer ok'},payload:{url:'https://news.example.com/report',type:'http'}});
  const unsupportedSource=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/sources`,headers:{authorization:'Bearer ok'},payload:{url:'https://papers.example.com/report.pdf',type:'pdf'}});
  const inspected=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/sources/${uuids[1]}/inspect`,headers:{authorization:'Bearer ok'}});
  const tracked=await app.inject({method:'PATCH',url:`/v1/me/research-topics/${uuids[0]}/sources/${uuids[1]}`,headers:{authorization:'Bearer ok'},payload:{status:'tracked'}});
  const statusHistory=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/sources/${uuids[1]}/status-reviews`,headers:{authorization:'Bearer ok'}});
  const authorityReviewed=await app.inject({method:'POST',url:`/v1/me/research-topics/${uuids[0]}/sources/${uuids[1]}/authority-reviews`,headers:{authorization:'Bearer ok'},payload:{decidedTier:'official-primary',rationale:'已核对来源由产品官方直接维护并发布。'}});
  const authorityHistory=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/sources/${uuids[1]}/authority-reviews`,headers:{authorization:'Bearer ok'}});
  const evidence=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/evidence`,headers:{authorization:'Bearer ok'}});
  const events=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/events`,headers:{authorization:'Bearer ok'}});
  const clusterDiagnostics=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/event-cluster-diagnostics`,headers:{authorization:'Bearer ok'}});
  const reports=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/reports`,headers:{authorization:'Bearer ok'}});
  const notifications=await app.inject({method:'GET',url:`/v1/me/research-topics/${uuids[0]}/notifications?unreadOnly=true`,headers:{authorization:'Bearer ok'}});
  const notificationRead=await app.inject({method:'POST',url:`/v1/me/research-events/${uuids[2]}/read`,headers:{authorization:'Bearer ok'}});
  const linkedEntity=await app.inject({method:'PUT',url:`/v1/me/research-topics/${uuids[0]}/events/${uuids[2]}/entities/${uuids[3]}`,headers:{authorization:'Bearer ok'}});
  assert.equal(sources.json().data[0].url,'https://example.com');
  assert.equal(sourceRelationships.json().data[0].relationship,'shared-origin');
  assert.equal(sourceRelationshipReviewed.statusCode,201);
  assert.equal(discoveries.json().data[0].title,'候选页面');
  assert.equal(discoveryStats.json().data.schemaVersion,'research-candidate-stats-v1');
  assert.equal(discoveryStats.json().data.total,1);
  assert.equal(candidateEvaluation.json().data.schemaVersion,'research-candidate-evaluation-v1');
  assert.equal(candidateEvaluation.json().data.automationAllowed,false);
  assert.equal(candidateDatasets.json().data[0].split,'development');
  assert.equal(candidateDatasetCreated.statusCode,201);
  assert.equal(candidateDatasetRuns.json().data[0].evaluationKey,'tier1-value-v1:deepseek-chat');
  assert.equal(candidateDatasetRun.statusCode,201);
  assert.equal(candidateDatasetRun.json().data.run.report.automationAllowed,false);
  assert.equal(discoveryReviewed.statusCode,201);
  assert.equal(discoveryReviewed.json().data.decision,'relevant');
  assert.equal(entities.json().data[0].name,'openai/codex');
  assert.equal(entityAdded.statusCode,201);
  assert.equal(entityTracked.json().data.status,'tracked');
  assert.equal(entityHistory.json().data[0].decidedStatus,'tracked');
  assert.equal(added.statusCode,201);
  assert.equal(added.json().data.status,'candidate');
  assert.equal(webpageAdded.statusCode,201);
  assert.equal(unsupportedSource.statusCode,400);
  assert.equal(inspected.json().data.entries[0].externalId,'release-1');
  assert.equal(tracked.json().data.status,'tracked');
  assert.equal(statusHistory.json().data[0].decidedStatus,'tracked');
  assert.equal(authorityReviewed.statusCode,201);
  assert.equal(authorityHistory.json().data[0].decidedTier,'official-primary');
  assert.equal(evidence.json().data[0].quote,'变化');
  assert.equal(events.json().data[0].title,'官方更新发生变化');
  assert.equal(clusterDiagnostics.json().data.schemaVersion,'research-event-cluster-diagnostics-v1');
  assert.equal(clusterDiagnostics.json().data.items[0].independenceVerified,false);
  assert.equal(reports.json().data[0].kind,'run-summary');
  assert.equal(notifications.json().data[0].isRead,false);
  assert.equal(notificationRead.json().data.isRead,true);
  assert.equal(linkedEntity.json().data.entityId,uuids[3]);
});

test('research topic worker records bounded observation outcomes without claiming web discovery',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const completed=[];let claimed=false,reconciled=0;
  const repository={
    get:async()=>({id:uuids[0],status:'active',contract:baseContract}),
    enqueueManual:async(_userId,_topicId,runId)=>({status:'queued',run:{id:runId,topicId:uuids[0],status:'queued'}}),
    listRuns:async()=>completed,
    reconcileStaleRunActions:async()=>{reconciled+=1;return{recovered:0};},
    enqueueDue:async()=>[{id:uuids[2],status:'queued'}],
    claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:2,activeWatches:2,erroredWatches:0,changeEvents:1,importantEvents:1}),
    completeRun:async(_id,_workerId,input)=>{const run={id:uuids[2],...input};completed.push(run);return run;},
  };
  const service=createResearchTopicService({repository,ids:()=>uuids[2]});
  const manual=await service.triggerRun({userId:'user-1'},uuids[0]);
  assert.equal(manual.status,'queued');
  const results=await service.processDue({workerId:'test-worker'});
  assert.equal(reconciled,1);
  assert.equal(results[0].status,'completed');
  assert.deepEqual(results[0].resultSummary,{schemaVersion:'radar-observation-v1',linkedWatches:2,activeWatches:2,erroredWatches:0,changeEvents:1,importantEvents:1,documentBudget:0,subscriptionSources:0,rssSources:0,githubSources:0,subscriptionSourcesSkippedByAuthority:0,subscriptionSourcesSkippedByType:0,rssSourcesSucceeded:0,rssSourcesErrored:0,rssEntries:0,rssVersionsArchived:0,rssEvidenceArchived:0,rssFailures:[],httpSources:0,httpSourcesSkippedByAuthority:0,httpSourcesSkippedByType:0,httpSourcesSucceeded:0,httpSourcesErrored:0,httpChanges:0,httpVersionsArchived:0,httpEvidenceArchived:0,httpBillableRequests:0,httpCostUsdMicros:0,httpFailures:[],searchConfigured:false,searchQueriesPlanned:0,searchQueriesSent:0,searchQueriesSucceeded:0,searchQueriesErrored:0,searchResultsSeen:0,searchCandidatesAdded:0,searchUnsafeResults:0,searchBillableRequests:0,searchCostUsdMicros:0,searchPrefilterRelevant:0,searchPrefilterNeedsReview:0,searchPrefilterIrrelevant:0,searchFailures:[],candidateAssessmentConfigured:false,candidateAssessmentConsidered:0,candidateAssessmentSucceeded:0,candidateAssessmentErrored:0,candidateAssessmentRelevant:0,candidateAssessmentNeedsReview:0,candidateAssessmentIrrelevant:0,candidateAssessmentBillableRequests:0,candidateAssessmentCostUsdMicros:0,candidateAssessmentFailures:[],sourcesSkippedByAuthority:0,sourcesSkippedByType:0,sourcesSkippedAfterFreeze:0,evidenceArchived:0,versionsArchived:0,newsMaterialsArchived:0,usage:{searchQueries:0,documentsRead:0,deepResearchJobs:0,billableRequests:0,providerCostUsdMicros:0}});
});

test('research topic scheduler reports local loop liveness without treating an empty queue as failure',async t=>{
  const {createResearchTopicWorker}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let now=new Date('2026-10-21T00:00:00.000Z'),calls=0;
  const worker=createResearchTopicWorker({service:{processDue:async()=>{calls+=1;return[];}},intervalMs:60000,staleAfterMs:180000,maxTickMs:900000,clock:()=>now,logger:{error(){}}});
  t.after(()=>worker.stop());
  assert.equal(worker.status().status,'not-started');
  worker.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal(worker.status().status,'online');
  assert.equal(worker.status().healthy,true);
  now=new Date('2026-10-21T00:03:01.000Z');
  assert.equal(worker.status().status,'stale');
  assert.equal(worker.status().healthy,false);
  worker.stop();
  assert.equal(worker.status().status,'stopped');
});

test('research topic scheduler distinguishes a live degraded loop from a stalled tick',async t=>{
  const {createResearchTopicWorker}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let now=new Date('2026-10-21T01:00:00.000Z');
  const degraded=createResearchTopicWorker({service:{processDue:async()=>{const error=new Error('database unavailable');error.code='DB_UNAVAILABLE';throw error;}},intervalMs:60000,clock:()=>now,logger:{error(){}}});
  t.after(()=>degraded.stop());
  degraded.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(degraded.status().status,'degraded');
  assert.equal(degraded.status().healthy,true);
  assert.equal(degraded.status().lastErrorCode,'DB_UNAVAILABLE');
  await degraded.runOnce();
  await degraded.runOnce();
  assert.equal(degraded.status().status,'failing');
  assert.equal(degraded.status().healthy,false);
  assert.equal(degraded.status().consecutiveErrors,3);
  let release;
  const stalled=createResearchTopicWorker({service:{processDue:()=>new Promise(resolve=>{release=resolve;})},intervalMs:60000,maxTickMs:900000,clock:()=>now,logger:{error(){}}});
  t.after(()=>{release?.([]);stalled.stop();});
  stalled.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stalled.status().status,'busy');
  now=new Date('2026-10-21T01:15:01.000Z');
  assert.equal(stalled.status().status,'stalled');
  assert.equal(stalled.status().healthy,false);
});

test('research topic worker records a policy block without spending source-read budget',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,completed;
  const repository={
    enqueueDue:async()=>[],
    claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:1,eligibleWatches:0,activeWatches:1,erroredWatches:0,watchesSkippedByAuthority:1,watchesSkippedByType:0,minimumAuthorityTier:'institutional',changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    completeRun:async(_id,_workerId,input)=>{completed=input;return{id:uuids[2],...input};},
  };
  const [result]=await createResearchTopicService({repository}).processDue({workerId:'policy-worker'});
  assert.equal(result.status,'blocked');
  assert.match(result.stopReason,/institutional/u);
  assert.equal(completed.resultSummary.sourcesSkippedByAuthority,1);
  assert.equal(completed.resultSummary.usage.documentsRead,0);
});

test('DeepSeek search adapter sends bounded metadata-only requests and hides the API key from results',async()=>{
  const {createDeepSeekSearchAdapter}=await import(moduleUrl('apps/api/src/deepseek-search-adapter.mjs'));
  let request;
  const adapter=createDeepSeekSearchAdapter({apiKey:'secret-key',fetchImpl:async(url,init)=>{request={url:String(url),init};return new Response(JSON.stringify({results:[{rerank_score:2.4,title:'官方发布',url:'https://example.com/release',snippet:'已发布',summary:'不应进入候选记录',content:'不应请求正文',site_name:'Example',site_icon:null,date:'2026-10-20T00:00:00Z',authority:3}]}),{status:200,headers:{'content-type':'application/json'}});}});
  assert.deepEqual(adapter.billing,{currency:'USD',unitPriceMicros:750,unit:'request',priceSource:'runtime-config'});
  const preview=await adapter.search({query:'浏览器 Agent 更新',count:5,oriQuestion:'浏览器 Agent 更新'});
  const body=JSON.parse(request.init.body);
  assert.equal(request.url,'https://api.deepseek.com/v1/tools/search');
  assert.equal(request.init.headers.authorization,'Bearer secret-key');
  assert.equal(body.need_content,false);
  assert.equal(body.count,5);
  assert.equal(preview.results[0].url,'https://example.com/release');
  assert.equal('summary' in preview.results[0],false);
  assert.equal(preview.billable,true);
  assert.deepEqual(preview.billing,{currency:'USD',unitPriceMicros:750,unit:'successful-request',priceSource:'runtime-config'});
  assert.equal(JSON.stringify(preview).includes('secret-key'),false);
  const emptyAdapter=createDeepSeekSearchAdapter({apiKey:'secret-key',priceUsdMicrosPerRequest:900,fetchImpl:async()=>new Response(JSON.stringify({results:[]}),{status:200,headers:{'content-type':'application/json'}})});
  const emptyPreview=await emptyAdapter.search({query:'没有匹配结果',count:3});
  assert.equal(emptyPreview.billable,false);
  assert.equal(emptyPreview.billing.unitPriceMicros,900);
  await assert.rejects(adapter.search({query:'x',count:11}),/1 到 10/u);
  assert.throws(()=>createDeepSeekSearchAdapter({apiKey:'key',priceUsdMicrosPerRequest:-1}),/non-negative integer/u);
});

test('DeepSeek candidate assessor sends metadata only and rejects incomplete or invalid model output',async()=>{
  const {createDeepSeekCandidateAssessmentAdapter,validateResearchCandidateAssessments}=await import(moduleUrl('apps/api/src/research-candidate-assessment-adapter.mjs'));
  const input={topicId:uuids[0],topicTitle:'人工智能监管',objective:'长期追踪欧盟人工智能法案实施变化',questions:['近期出现了哪些可验证的新变化？'],candidates:[{id:uuids[6],title:'欧盟发布实施时间表',snippet:'欧盟委员会公布了新的执行节点。',url:'https://example.com/should-not-leave-process',publisher:'Example News',publishedAt:'2026-10-21T00:00:00.000Z',provider:'deepseek-search',prefilter:{decision:'relevant',dimensionScores:{topicRelevance:0.9},reasonCodes:['topic-match']}}]};
  let request;
  const output={assessments:[{candidateId:uuids[6],decision:'relevant',reasonCodes:['high-topic-fit','verifiable-next-step'],dimensionScores:{topicRelevance:0.95,novelty:0.7,potentialImpact:0.8,evidenceability:0.85,timelineValue:0.9},rationale:'候选与专题直接相关，并包含可继续核验的明确时间节点。'}]};
  const adapter=createDeepSeekCandidateAssessmentAdapter({apiKey:'candidate-secret',priceUsdMicrosPerRequest:2500,fetchImpl:async(url,init)=>{request={url:String(url),init};return new Response(JSON.stringify({model:'deepseek-chat',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:200,headers:{'content-type':'application/json'}});}});
  const result=await adapter.assess(input),body=JSON.parse(request.init.body),userPayload=JSON.parse(body.messages[1].content);
  assert.equal(request.url,'https://api.deepseek.com/chat/completions');
  assert.equal(request.init.headers.authorization,'Bearer candidate-secret');
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.equal(userPayload.candidates[0].title,'欧盟发布实施时间表');
  assert.equal('url' in userPayload.candidates[0],false,'unconfirmed candidate URLs must not be sent to the model');
  assert.equal(JSON.stringify(result).includes('candidate-secret'),false);
  assert.equal(result.assessments[0].dimensionScores.topicRelevance,0.95);
  assert.match(result.assessments[0].inputSha256,/^[a-f0-9]{64}$/u);
  assert.deepEqual(result.billing,{currency:'USD',unitPriceMicros:2500,billableRequests:1,costUsdMicros:2500,priceSource:'runtime-config'});
  assert.throws(()=>validateResearchCandidateAssessments(input,{assessments:[]}),error=>error.code==='RESEARCH_CANDIDATE_MODEL_OUTPUT_INVALID');
  assert.throws(()=>validateResearchCandidateAssessments(input,{assessments:[{...output.assessments[0],dimensionScores:{...output.assessments[0].dimensionScores,novelty:1.1}}]}),error=>error.code==='RESEARCH_CANDIDATE_MODEL_OUTPUT_INVALID');
});

test('research topic worker records bounded Tier 1 candidate assessments in the action ledger',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,reservation,recorded,settlement,assessmentCalls=0;
  const candidate={id:uuids[6],title:'欧盟发布实施时间表',snippet:'欧盟委员会公布了新的执行节点。',provider:'deepseek-search',publisher:'Example News',publishedAt:'2026-10-21T00:00:00.000Z',prefilter:{decision:'relevant',dimensionScores:{topicRelevance:0.9},reasonCodes:['topic-match']}};
  const repository={
    enqueueDue:async()=>[],
    claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:1,activeWatches:1,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    getCandidateAssessmentBatch:async(_runId,limit,evaluationKey)=>{assert.equal(limit,4);assert.equal(evaluationKey,'tier1-value-v1:deepseek-chat');return{topicId:uuids[0],topicTitle:'人工智能监管',objective:'长期追踪监管变化',questions:['近期出现了什么变化？'],candidates:[candidate]};},
    reserveRunAction:async(_runId,sourceId,input)=>{reservation={sourceId,...input};return{shouldSend:true,action:{id:uuids[7],attemptId:input.attemptId,status:'reserved'}};},
    markRunActionSent:async()=>({id:uuids[7],status:'sent'}),
    recordCandidateAssessments:async(_runId,actionId,input)=>{recorded={actionId,...input};return{inserted:1,counts:{relevant:1,'needs-review':0,irrelevant:0}};},
    settleRunAction:async(_id,_attempt,input)=>{settlement=input;return{id:uuids[7],...input};},
    completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const candidateAssessmentAdapter={provider:'deepseek-candidate-assessor',evaluationKey:'tier1-value-v1:deepseek-chat',assess:async batch=>{assessmentCalls+=1;assert.equal(batch.candidates.length,1);return{protocol:'research-candidate-assessment-v1',model:'deepseek-chat',evaluationKey:'tier1-value-v1:deepseek-chat',finishReason:'stop',billable:true,billing:{unitPriceMicros:2500,priceSource:'test-price'},usage:{promptTokens:100,completionTokens:50,totalTokens:150},assessments:[{candidateId:uuids[6],decision:'relevant',reasonCodes:['high-topic-fit'],dimensionScores:{topicRelevance:0.95,novelty:0.7,potentialImpact:0.8,evidenceability:0.85,timelineValue:0.9},rationale:'候选与专题直接相关，值得进入后续证据获取。',inputSha256:'a'.repeat(64)}]};}};
  const [result]=await createResearchTopicService({repository,candidateAssessmentAdapter,candidateAssessmentMaxPerRun:4,ids:()=>uuids[8]}).processDue({workerId:'candidate-assessment-worker'});
  assert.equal(assessmentCalls,1);
  assert.equal(reservation.sourceId,null);
  assert.equal(reservation.kind,'candidate-assess');
  assert.equal(reservation.provider,'deepseek-candidate-assessor');
  assert.equal(recorded.actionId,uuids[7]);
  assert.equal(recorded.assessments[0].candidateId,uuids[6]);
  assert.equal(settlement.status,'completed');
  assert.equal(settlement.actualUsage.billableRequests,1);
  assert.equal(settlement.actualUsage.costUsdMicros,2500);
  assert.equal(settlement.receipt.assessmentsRecorded,1);
  assert.equal(result.resultSummary.candidateAssessmentConfigured,true);
  assert.equal(result.resultSummary.candidateAssessmentSucceeded,1);
  assert.equal(result.resultSummary.candidateAssessmentRelevant,1);
  assert.equal(result.resultSummary.usage.billableRequests,1);
  assert.equal(result.resultSummary.usage.providerCostUsdMicros,2500);
  assert.equal(result.resultSummary.usage.deepResearchJobs,0);
});

test('research topic worker conservatively accounts for a sent Tier 1 request that fails validation',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,settlement;
  const repository={
    enqueueDue:async()=>[],claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:1,activeWatches:1,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    getCandidateAssessmentBatch:async()=>({topicId:uuids[0],topicTitle:'专题',objective:'长期观察',questions:[],candidates:[{id:uuids[6],title:'候选',snippet:'摘要'}]}),
    reserveRunAction:async(_runId,_sourceId,input)=>({shouldSend:true,action:{id:uuids[7],attemptId:input.attemptId,status:'reserved'}}),
    markRunActionSent:async()=>({id:uuids[7],status:'sent'}),
    recordCandidateAssessments:async()=>{throw new Error('must not archive invalid output');},
    settleRunAction:async(_id,_attempt,input)=>{settlement=input;return{id:uuids[7],...input};},
    completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const invalid=new Error('invalid structured output');invalid.code='RESEARCH_CANDIDATE_MODEL_OUTPUT_INVALID';
  const candidateAssessmentAdapter={provider:'deepseek-candidate-assessor',evaluationKey:'tier1-value-v1:deepseek-chat',billing:{unitPriceMicros:2500},assess:async()=>{throw invalid;}};
  const [result]=await createResearchTopicService({repository,candidateAssessmentAdapter}).processDue({workerId:'candidate-assessment-failure-worker'});
  assert.equal(settlement.status,'failed');
  assert.equal(settlement.actualUsage.billableRequests,1);
  assert.equal(settlement.actualUsage.costUsdMicros,2500);
  assert.equal(result.status,'partial');
  assert.equal(result.resultSummary.candidateAssessmentErrored,1);
  assert.equal(result.resultSummary.usage.billableRequests,1);
  assert.equal(result.resultSummary.usage.providerCostUsdMicros,2500);
});

test('DeepSeek fetch adapter reads one confirmed public URL as bounded Markdown without leaking the API key',async()=>{
  const {createDeepSeekFetchAdapter}=await import(moduleUrl('apps/api/src/deepseek-fetch-adapter.mjs'));
  let request,validated='';
  const adapter=createDeepSeekFetchAdapter({
    apiKey:'secret-fetch-key',
    validateUrl:async value=>{validated=String(value);return new URL(value);},
    fetchImpl:async(url,init)=>{request={url:String(url),init};return new Response(JSON.stringify({title:' 发布说明\u0000 ',content:'# 版本 2\n\n修复关键问题。'}),{status:200,headers:{'content-type':'application/json'}});},
  });
  assert.deepEqual(adapter.billing,{currency:'USD',unitPriceMicros:750,unit:'request',priceSource:'runtime-config'});
  const preview=await adapter.fetch('https://example.com/release');
  assert.equal(validated,'https://example.com/release');
  assert.equal(request.url,'https://api.deepseek.com/v1/tools/fetch');
  assert.equal(request.init.headers.authorization,'Bearer secret-fetch-key');
  assert.deepEqual(JSON.parse(request.init.body),{url:'https://example.com/release'});
  assert.equal(preview.protocol,'deepseek-fetch-v1');
  assert.equal(preview.provider,'deepseek-fetch');
  assert.equal(preview.contentType,'text/markdown');
  assert.equal(preview.bodyText,'# 版本 2\n\n修复关键问题。');
  assert.match(preview.sha256,/^[a-f0-9]{64}$/u);
  assert.equal(preview.billable,true);
  assert.deepEqual(preview.billing,{currency:'USD',unitPriceMicros:750,unit:'successful-request',priceSource:'runtime-config'});
  assert.equal(JSON.stringify(preview).includes('secret-fetch-key'),false);
  assert.throws(()=>createDeepSeekFetchAdapter({apiKey:'key',priceUsdMicrosPerRequest:-1}),/non-negative integer/u);

  const throttled=createDeepSeekFetchAdapter({apiKey:'key',validateUrl:async value=>new URL(value),fetchImpl:async()=>new Response(JSON.stringify({error:{message:'slow down'}}),{status:429,headers:{'content-type':'application/json'}})});
  await assert.rejects(throttled.fetch('https://example.com'),error=>error.code==='RESEARCH_FETCH_HTTP_429'&&error.retryable===true);
  const rejected=createDeepSeekFetchAdapter({apiKey:'key',validateUrl:async value=>new URL(value),fetchImpl:async()=>new Response(JSON.stringify({error:{message:'bad URL'}}),{status:400,headers:{'content-type':'application/json'}})});
  await assert.rejects(rejected.fetch('https://example.com'),error=>error.code==='RESEARCH_FETCH_HTTP_400'&&error.retryable===false);
});

test('research topic worker turns search results into candidates without treating snippets as evidence',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,searchCalls=0;const settled=[],archived=[];
  const repository={
    enqueueDue:async()=>[],claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:0,activeWatches:0,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    getSearchPlanForRun:async(_runId,limit)=>{assert.equal(limit,4);return{queries:[{query:'浏览器 Agent 更新 site:example.com after:2026-10-19',oriQuestion:'浏览器 Agent 更新',packId:'global-core',domains:['example.com']}],resultLimit:10,searchPacks:['global-core'],window:{after:'2026-10-19T00:00:00.000Z',before:'2026-10-21T00:00:00.000Z',searchAfterDate:'2026-10-19',overlapHours:24,initialLookbackDays:null}};},
    reserveRunAction:async(_runId,sourceId,input)=>{assert.equal(sourceId,null);assert.equal(input.kind,'search');return{shouldSend:true,action:{id:uuids[0],attemptId:input.attemptId,status:'reserved'}};},
    markRunActionSent:async()=>({id:uuids[0],status:'reserved'}),
    archiveSearchResults:async(_runId,_actionId,input)=>{archived.push(input);return{resultsSeen:input.results.length,candidatesAdded:1,discoveryRecords:1,knownSourceResults:0,prefilterCounts:{relevant:1,'needs-review':0,irrelevant:0}};},
    settleRunAction:async(_id,_attempt,input)=>{settled.push(input);return{id:uuids[0],...input};},
    completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const searchAdapter={provider:'deepseek-search',search:async()=>{searchCalls+=1;return{protocol:'deepseek-search-preview-v1',provider:'deepseek-search',billable:true,billing:{currency:'USD',unitPriceMicros:750,priceSource:'test-price'},results:[{rank:1,title:'官方发布',url:'https://example.com/release?utm_source=search',snippet:'候选摘要',siteName:'Example',publishedAt:'2026-10-20T00:00:00Z',rerankScore:2.4,authority:3},{rank:2,title:'官方发布',url:'https://example.com/release',snippet:'重复',siteName:'Example',publishedAt:'2026-10-20T00:00:00Z',rerankScore:2.3,authority:3},{rank:3,title:'旧闻',url:'https://example.com/old',snippet:'过期',siteName:'Example',publishedAt:'2026-10-01T00:00:00Z',rerankScore:1.5,authority:2},{rank:4,title:'内网页面',url:'http://127.0.0.1/private',snippet:'拒绝',siteName:null,publishedAt:null,rerankScore:1,authority:-1}]};}};
  const service=createResearchTopicService({repository,searchAdapter,validateSourceUrl:async value=>{const url=new URL(value);if(url.hostname==='127.0.0.1')throw new Error('private');return url;}});
  const [result]=await service.processDue({workerId:'search-worker'});
  assert.equal(searchCalls,1);
  assert.equal(archived[0].results.length,1);
  assert.equal(archived[0].results[0].url,'https://example.com/release');
  assert.equal(archived[0].results[0].snippet,'候选摘要');
  assert.equal(settled[0].actualUsage.billableRequests,1);
  assert.equal(settled[0].actualUsage.costUsdMicros,750);
  assert.equal(settled[0].receipt.billing.unitPriceUsdMicros,750);
  assert.equal(settled[0].receipt.sourcePackId,'global-core');
  assert.equal(result.status,'completed');
  assert.equal(result.resultSummary.searchCandidatesAdded,1);
  assert.equal(result.resultSummary.searchPrefilterRelevant,1);
  assert.equal(result.resultSummary.searchPrefilterNeedsReview,0);
  assert.equal(result.resultSummary.searchPrefilterIrrelevant,0);
  assert.equal(result.resultSummary.searchUnsafeResults,1);
  assert.equal(result.resultSummary.searchProviderResults,4);
  assert.equal(result.resultSummary.searchDuplicateResults,1);
  assert.equal(result.resultSummary.searchOutOfWindowResults,1);
  assert.deepEqual(result.resultSummary.searchDomainsSeen,['example.com']);
  assert.equal(result.resultSummary.searchPackCoverage[0].packId,'global-core');
  assert.equal(result.resultSummary.evidenceArchived,0);
  assert.equal(result.resultSummary.usage.searchQueries,1);
});

test('research topic worker reserves and settles confirmed RSS calls within a bounded batch',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  const completed=[],settled=[];let claimed=false,inspected=0,archived=0,sent=0;
  const repository={
    enqueueDue:async()=>[],
    claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:0,activeWatches:0,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    listTrackedFeedsForRun:async(_runId,limit)=>{assert.equal(limit,5);return{documentLimit:1,sources:[{id:uuids[1],url:'https://updates.example.com/feed.xml',status:'tracked'}]};},
    reserveRunAction:async(_runId,sourceId,input)=>({shouldSend:true,action:{id:uuids[0],sourceId,attemptId:input.attemptId,status:'reserved'}}),
    markRunActionSent:async()=>{sent+=1;return{id:uuids[0],status:'reserved'};},
    settleRunAction:async(_actionId,_attemptId,input)=>{settled.push(input);return{id:uuids[0],...input};},
    archiveFeedPreview:async(_runId,sourceId,preview,options)=>{archived+=1;assert.equal(sourceId,uuids[1]);assert.equal(preview.contentHash,'a'.repeat(64));assert.equal(options.maxEntries,100);return{versionsArchived:1,evidenceArchived:2,entriesArchived:2};},
    completeRun:async(_id,_workerId,input)=>{const run={id:uuids[2],...input};completed.push(run);return run;},
  };
  const service=createResearchTopicService({repository,feedAdapter:{inspect:async()=>{inspected+=1;return{contentHash:'a'.repeat(64),entries:[{},{}]};}},httpAdapter:async()=>{throw new Error('document budget must prevent an extra HTTP read');}});
  const results=await service.processDue({workerId:'feed-worker'});
  assert.equal(inspected,1);
  assert.equal(archived,1);
  assert.equal(sent,1);
  assert.equal(settled[0].status,'completed');
  assert.equal(results[0].status,'completed');
  assert.equal(results[0].resultSummary.changeEvents,0);
  assert.equal(results[0].resultSummary.newsMaterialsArchived,2);
  assert.equal(results[0].resultSummary.usage.documentsRead,1);
});

test('research topic worker archives a confirmed discovered webpage as a candidate news article',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,kind='',reads=0,dispatchedRunId=null;
  const repository={
    enqueueDue:async()=>[],claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:0,activeWatches:0,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    listTrackedHttpForRun:async(_runId,limit)=>{assert.equal(limit,5);return{sources:[{id:uuids[1],type:'http',url:'https://example.com/release',status:'tracked'}],documentLimit:1};},
    reserveRunAction:async(_runId,_sourceId,input)=>{kind=input.kind;return{shouldSend:true,action:{id:uuids[0],attemptId:input.attemptId,status:'reserved'}};},
    markRunActionSent:async()=>({id:uuids[0],status:'reserved'}),settleRunAction:async(_id,_attempt,input)=>({id:uuids[0],...input}),
    archiveHttpPreview:async(_runId,_sourceId,preview)=>{assert.equal(preview.contentHash,'a'.repeat(64));return{versionsArchived:1,evidenceArchived:1,entriesArchived:0,baseline:true};},
    completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const service=createResearchTopicService({repository,httpAdapter:async()=>{reads+=1;return{finalUrl:'https://example.com/release',statusCode:200,contentType:'text/html',bodyText:'release',sha256:'a'.repeat(64)};},analysisDispatcher:async runId=>{dispatchedRunId=runId;return{status:'queued',job:{id:uuids[3]}};}});
  const [result]=await service.processDue({workerId:'http-worker'});
  assert.equal(reads,1);
  assert.equal(kind,'url-archive');
  assert.equal(result.status,'completed');
  assert.equal(result.resultSummary.httpSourcesSucceeded,1);
  assert.equal(result.resultSummary.httpChanges,0);
  assert.equal(result.resultSummary.httpEvidenceArchived,1);
  assert.equal(result.resultSummary.usage.documentsRead,1);
  assert.equal(dispatchedRunId,uuids[2]);
  assert.equal(result.analysisDispatch.status,'queued');
});

test('research topic worker discloses and bills the configured DeepSeek fetch provider once per confirmed page',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,reads=0,reservation,settlement,archivedPreview;
  const repository={
    enqueueDue:async()=>[],claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:0,activeWatches:0,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    listTrackedHttpForRun:async()=>({sources:[{id:uuids[1],type:'http',url:'https://example.com/release',status:'tracked'}],documentLimit:1}),
    reserveRunAction:async(_runId,_sourceId,input)=>{reservation=input;return{shouldSend:true,action:{id:uuids[0],attemptId:input.attemptId,status:'reserved'}};},
    markRunActionSent:async()=>({id:uuids[0],status:'sent'}),
    settleRunAction:async(_id,_attempt,input)=>{settlement=input;return{id:uuids[0],...input};},
    archiveHttpPreview:async(_runId,_sourceId,preview)=>{archivedPreview=preview;return{versionsArchived:1,evidenceArchived:1,entriesArchived:0,baseline:true};},
    completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const httpAdapter={provider:'deepseek-fetch',fetch:async()=>{reads+=1;return{protocol:'deepseek-fetch-v1',provider:'deepseek-fetch',finalUrl:'https://example.com/release',statusCode:200,contentType:'text/markdown',bodyText:'# Release',sha256:'b'.repeat(64),billable:true,billing:{currency:'USD',unitPriceMicros:750,priceSource:'test-price'}};}};
  const [result]=await createResearchTopicService({repository,httpAdapter}).processDue({workerId:'deepseek-fetch-worker'});
  assert.equal(reads,1);
  assert.equal(reservation.provider,'deepseek-fetch');
  assert.equal(settlement.actualUsage.fetchRequests,1);
  assert.equal(settlement.actualUsage.billableRequests,1);
  assert.equal(settlement.actualUsage.costUsdMicros,750);
  assert.equal(settlement.receipt.protocol,'deepseek-fetch-v1');
  assert.equal(settlement.receipt.provider,'deepseek-fetch');
  assert.equal('bodyText' in settlement.receipt,false);
  assert.equal(JSON.stringify(settlement).includes('# Release'),false);
  assert.equal(archivedPreview.provider,'deepseek-fetch');
  assert.equal(settlement.actualUsage.changesArchived,0);
  assert.equal(settlement.receipt.evidenceArchived,1);
  assert.equal(result.status,'completed');
});

test('research topic worker routes GitHub sources through the GitHub action adapter',async()=>{
  const {createResearchTopicService}=await import(moduleUrl('apps/api/src/research-topic-service.mjs'));
  let claimed=false,reservedKind='',githubReads=0;
  const repository={
    enqueueDue:async()=>[],claimQueued:async()=>{if(claimed)return null;claimed=true;return{id:uuids[2],topicId:uuids[0],status:'observing'};},
    observeRun:async()=>({linkedWatches:0,activeWatches:0,erroredWatches:0,changeEvents:0,importantEvents:0,versionsArchived:0,evidenceArchived:0}),
    listTrackedFeedsForRun:async()=>({sources:[{id:uuids[1],url:'https://github.com/openai/codex',type:'github'}],documentLimit:1}),
    reserveRunAction:async(_runId,_sourceId,input)=>{reservedKind=input.kind;return{shouldSend:true,action:{id:uuids[0],attemptId:input.attemptId,status:'reserved'}};},
    markRunActionSent:async()=>({id:uuids[0],status:'reserved'}),settleRunAction:async(_id,_attempt,input)=>({id:uuids[0],...input}),
    archiveFeedPreview:async()=>({versionsArchived:1,evidenceArchived:1,entriesArchived:1}),completeRun:async(_id,_worker,input)=>({id:uuids[2],...input}),
  };
  const service=createResearchTopicService({repository,feedAdapter:{inspect:async()=>{throw new Error('RSS adapter must not be used');}},githubAdapter:{inspect:async()=>{githubReads+=1;return{contentHash:'a'.repeat(64),entries:[{}]};}}});
  const [result]=await service.processDue({workerId:'github-worker'});
  assert.equal(githubReads,1);
  assert.equal(reservedKind,'github-fetch');
  assert.equal(result.resultSummary.githubSources,1);
  assert.equal(result.status,'completed');
});

test('research protocol schemas are strict JSON documents',()=>{
  const fs=require('node:fs');
  for(const file of ['research-contract-v1.schema.json','research-job-v1.schema.json','research-result-v1.schema.json']){
    const schema=JSON.parse(fs.readFileSync(path.join(root,'packages/contracts/research',file),'utf8'));
    assert.equal(schema.type,'object');
    assert.equal(schema.additionalProperties,false);
    assert.match(schema.$id,/^https:\/\/mooyu\.fun\/schemas\/research\//u);
  }
});

test('platform API client exposes research topic and watch-link operations',async()=>{
  const {createApiClient}=await import(moduleUrl('packages/platform-api-client/src/index.mjs'));
  const requests=[];
  const client=createApiClient({baseUrl:'https://api.example',getAccessToken:()=> 'token',fetchImpl:async(url,init)=>{requests.push({url:String(url),method:init.method});return new Response(JSON.stringify({data:{ok:true}}),{status:200,headers:{'content-type':'application/json'}});}});
  await client.createResearchTopic({title:'专题',objective:'目标',contract:baseContract});
  await client.createResearchContract(uuids[0],{expectedVersion:1,contract:baseContract});
  await client.linkResearchTopicWatch(uuids[0],uuids[1]);
  await client.listResearchTopicRuns(uuids[0]);
  await client.triggerResearchTopicRun(uuids[0]);
  await client.listResearchRunActions(uuids[0],uuids[2]);
  await client.listResearchTopicSources(uuids[0]);
  await client.listResearchTopicDiscoveries(uuids[0]);
  await client.addResearchTopicSource(uuids[0],{url:'https://updates.example.com/feed.xml',type:'rss'});
  await client.inspectResearchTopicSource(uuids[0],uuids[1]);
  await client.updateResearchTopicSource(uuids[0],uuids[1],{status:'tracked'});
  await client.listResearchTopicSourceStatusReviews(uuids[0],uuids[1]);
  await client.listResearchTopicSourceAuthorityReviews(uuids[0],uuids[1]);
  await client.reviewResearchTopicSourceAuthority(uuids[0],uuids[1],{decidedTier:'official-primary',rationale:'verified official source'});
  await client.listResearchTopicEvidence(uuids[0]);
  await client.listResearchTopicEvents(uuids[0]);
  await client.getResearcherCapabilities(uuids[0]);
  await client.listResearchTopicGaps(uuids[0]);
  await client.createResearchTopicGap(uuids[0],{question:'问题',reason:'原因',priority:'important'});
  await client.queueResearcherJob(uuids[0],uuids[1]);
  await client.listResearcherJobs(uuids[0]);
  await client.listResearchTopicClaims(uuids[0]);
  await client.getResearchTopicClaim(uuids[0],uuids[1]);
  await client.reviewResearchTopicClaim(uuids[0],uuids[1],{revision:1,decision:'accept',note:'evidence checked'});
  await client.listResearchTopicMetrics(uuids[0],{metricKey:'plan.price',dimensionKey:'plan',dimensionValue:'pro'});
  await client.compareResearchTopicMetric(uuids[0],{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan'});
  await client.trendResearchTopicMetric(uuids[0],{metricKey:'plan.price',methodVersion:'direct-observation-v1',interval:'month',dimensionKey:'plan',dimensionValue:'pro'});
  await client.listResearchTopicMetricViews(uuids[0]);
  await client.createResearchTopicMetricView(uuids[0],{name:'价格比较',viewType:'comparison',config:{metricKey:'plan.price',methodVersion:'direct-observation-v1',dimensionKey:'plan'}});
  await client.deleteResearchTopicMetricView(uuids[0],uuids[1]);
  await client.getResearchTopicQualitySummary(uuids[0]);
  await client.listResearchTopicQualitySamples(uuids[0],{status:'pending',periodKey:'2020-01',sampleKind:'facts',limit:20});
  await client.generateResearchTopicQualitySamples(uuids[0],{periodKey:'2020-01',sampleKind:'coverage',sampleSize:5});
  await client.reviewResearchTopicQualitySample(uuids[0],uuids[1],{decision:'fail',note:'independent review failed'});
  await client.resolveResearchTopicQualityCorrection(uuids[0],uuids[1],{decision:'dismissed',note:'independent review false alarm'});
  await client.listResearchTopicDerivedMetrics(uuids[0]);
  await client.createResearchTopicDerivedMetric(uuids[0],{derivedKey:'price.change',label:'价格变化',formulaVersion:'derived-arithmetic-v1',operator:'percent-change',left:{metricKey:'plan.price',methodVersion:'direct-observation-v1'},right:{metricKey:'plan.price_baseline',methodVersion:'direct-observation-v1'},dimensionKey:'plan'});
  await client.evaluateResearchTopicDerivedMetric(uuids[0],uuids[1],{from:'2026-01-01T00:00:00.000Z',to:'2026-10-01T00:00:00.000Z'});
  await client.listResearchTopicMethodTemplates(uuids[0],'active');
  await client.createResearchTopicMethodTemplate(uuids[0],{methodVersion:'official-price-v1'});
  await client.retireResearchTopicMethodTemplate(uuids[0],uuids[1]);
  await client.matrixResearchTopicMetrics(uuids[0],{metrics:[{metricKey:'plan.price',methodVersion:'direct-observation-v1'},{metricKey:'plan.storage',methodVersion:'direct-observation-v1'}],dimensionKey:'plan'});
  await client.listResearchTopicEntities(uuids[0]);
  await client.createResearchTopicEntity(uuids[0],{type:'project',name:'openai/codex'});
  await client.updateResearchTopicEntity(uuids[0],uuids[3],{status:'tracked'});
  await client.listResearchTopicEntityStatusReviews(uuids[0],uuids[3]);
  await client.linkResearchTopicEventEntity(uuids[0],uuids[2],uuids[3]);
  await client.listResearchRunSources(uuids[0],uuids[2]);
  await client.listResearchTopicReports(uuids[0]);
  await client.listResearchTopicNotifications(uuids[0],{unreadOnly:true});
  await client.markResearchEventRead(uuids[2]);
  await client.listResearchTopicClaimReviewSignals(uuids[0],{openOnly:true});
  await client.resolveResearchClaimReviewSignal(uuids[1],{decision:'acknowledged',note:'reviewed'});
  await client.getResearchTopicOperationsSummary(uuids[0],90);
  await client.getResearchTopicStorageAssessment(uuids[0]);
  await client.listResearchTopicBillingReconciliations(uuids[0]);
  await client.createResearchTopicBillingReconciliation(uuids[0],{provider:'deepseek-search'});
  await client.reviewResearchTopicBillingReconciliation(uuids[0],uuids[1],{decision:'acknowledged',note:'reviewed'});
  await client.listResearchTopicExternalBenchmarkCases(uuids[0],{status:'pending',periodKey:'2026-10'});
  await client.createResearchTopicExternalBenchmarkCase(uuids[0],{title:'外部事件'});
  await client.reviewResearchTopicExternalBenchmarkCase(uuids[0],uuids[1],{decision:'missed',note:'not found'});
  await client.listResearchTopicSourceRelationships(uuids[0]);
  await client.reviewResearchTopicSourceRelationship(uuids[0],{leftSourceId:uuids[1],rightSourceId:uuids[2],relationship:'shared-origin',rationale:'verified common origin'});
  await client.listResearchTopicEventClusterDiagnostics(uuids[0]);
  await client.cancelResearcherJob(uuids[0],uuids[1]);
  await client.reviewResearchTopicDiscovery(uuids[0],uuids[2],{decision:'relevant',rationale:'candidate directly answers the topic question'});
  await client.listResearchTopicDiscoveries(uuids[0],{limit:20,decision:'needs-review',evaluatorKind:'rule',sourceStatus:'candidate',sort:'priority',minTopicRelevance:0.4});
  await client.getResearchTopicDiscoveryStats(uuids[0]);
  await client.getResearchTopicCandidateEvaluation(uuids[0],'tier1-value-v1:deepseek-chat');
  await client.listResearchTopicCandidateEvaluationDatasets(uuids[0]);
  await client.createResearchTopicCandidateEvaluationDataset(uuids[0],{name:'候选开发集 v1',split:'development',sampleSize:50});
  await client.listResearchTopicCandidateEvaluationRuns(uuids[0],uuids[3]);
  await client.runResearchTopicCandidateEvaluationDataset(uuids[0],uuids[3],{evaluationKey:'tier1-value-v1:deepseek-chat'});
  assert.match(requests[11].url,/\/status-reviews\?limit=50$/u);
  requests.splice(11,1);
  assert.match(requests[44].url,/\/entities\/00000000-0000-4000-8000-000000000004\/status-reviews\?limit=50$/u);
  requests.splice(44,1);
  assert.deepEqual(requests.map(item=>item.method),['POST','POST','PUT','GET','POST','GET','GET','GET','POST','POST','PATCH','GET','POST','GET','GET','GET','GET','POST','POST','GET','GET','GET','POST','GET','GET','GET','GET','POST','DELETE','GET','GET','POST','POST','POST','GET','POST','GET','GET','POST','DELETE','POST','GET','POST','PATCH','PUT','GET','GET','GET','POST','GET','POST','GET','GET','GET','POST','POST','GET','POST','POST','GET','POST','GET','DELETE','POST','GET','GET','GET','GET','POST','GET','POST']);
  assert.match(requests[0].url,/\/v1\/me\/research-topics$/u);
  assert.match(requests[1].url,/\/contracts$/u);
  assert.match(requests[2].url,/\/watches\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[3].url,/\/runs\?limit=30$/u);
  assert.match(requests[4].url,/\/runs$/u);
  assert.match(requests[5].url,/\/runs\/00000000-0000-4000-8000-000000000003\/actions$/u);
  assert.match(requests[6].url,/\/sources\?limit=100$/u);
  assert.match(requests[7].url,/\/discoveries\?limit=50$/u);
  assert.match(requests[8].url,/\/sources$/u);
  assert.match(requests[9].url,/\/sources\/00000000-0000-4000-8000-000000000002\/inspect$/u);
  assert.match(requests[10].url,/\/sources\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[11].url,/\/authority-reviews\?limit=50$/u);
  assert.match(requests[12].url,/\/authority-reviews$/u);
  assert.match(requests[13].url,/\/evidence\?limit=50$/u);
  assert.match(requests[14].url,/\/events\?limit=50$/u);
  assert.match(requests[15].url,/\/researcher$/u);
  assert.match(requests[16].url,/\/gaps\?limit=100$/u);
  assert.match(requests[17].url,/\/gaps$/u);
  assert.match(requests[18].url,/\/gaps\/00000000-0000-4000-8000-000000000002\/jobs$/u);
  assert.match(requests[19].url,/\/researcher-jobs\?limit=50$/u);
  assert.match(requests[20].url,/\/claims\?limit=100$/u);
  assert.match(requests[21].url,/\/claims\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[22].url,/\/claims\/00000000-0000-4000-8000-000000000002\/reviews$/u);
  assert.match(requests[23].url,/\/metrics\?status=active&metricKey=plan\.price&dimensionKey=plan&dimensionValue=pro&limit=500$/u);
  assert.match(requests[24].url,/\/metric-comparison\?metricKey=plan\.price&methodVersion=direct-observation-v1&dimensionKey=plan$/u);
  assert.match(requests[25].url,/\/metric-trend\?metricKey=plan\.price&methodVersion=direct-observation-v1&interval=month&dimensionKey=plan&dimensionValue=pro$/u);
  assert.match(requests[26].url,/\/metric-views$/u);
  assert.match(requests[27].url,/\/metric-views$/u);
  assert.match(requests[28].url,/\/metric-views\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[29].url,/\/quality-summary$/u);
  assert.match(requests[30].url,/\/quality-samples\?status=pending&periodKey=2020-01&sampleKind=facts&limit=20$/u);
  assert.match(requests[31].url,/\/quality-samples\/generate$/u);
  assert.match(requests[32].url,/\/quality-samples\/00000000-0000-4000-8000-000000000002\/reviews$/u);
  assert.match(requests[33].url,/\/quality-samples\/00000000-0000-4000-8000-000000000002\/correction-resolution$/u);
  assert.match(requests[34].url,/\/derived-metrics$/u);
  assert.match(requests[35].url,/\/derived-metrics$/u);
  assert.match(requests[36].url,/\/derived-metrics\/00000000-0000-4000-8000-000000000002\/evaluation\?from=2026-01-01T00%3A00%3A00\.000Z&to=2026-10-01T00%3A00%3A00\.000Z$/u);
  assert.match(requests[37].url,/\/method-templates\?status=active$/u);
  assert.match(requests[38].url,/\/method-templates$/u);
  assert.match(requests[39].url,/\/method-templates\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[40].url,/\/metric-matrix$/u);
  assert.match(requests[41].url,/\/entities\?limit=100$/u);
  assert.match(requests[42].url,/\/entities$/u);
  assert.match(requests[43].url,/\/entities\/00000000-0000-4000-8000-000000000004$/u);
  assert.match(requests[44].url,/\/events\/00000000-0000-4000-8000-000000000003\/entities\/00000000-0000-4000-8000-000000000004$/u);
  assert.match(requests[45].url,/\/runs\/00000000-0000-4000-8000-000000000003\/sources$/u);
  assert.match(requests[46].url,/\/reports\?limit=30$/u);
  assert.match(requests[47].url,/\/notifications\?unreadOnly=true&limit=50$/u);
  assert.match(requests[48].url,/\/v1\/me\/research-events\/00000000-0000-4000-8000-000000000003\/read$/u);
  assert.match(requests[49].url,/\/claim-review-signals\?limit=50&openOnly=true$/u);
  assert.match(requests[50].url,/\/v1\/me\/research-claim-review-signals\/00000000-0000-4000-8000-000000000002\/resolutions$/u);
  assert.match(requests[51].url,/\/operations-summary\?days=90$/u);
  assert.match(requests[52].url,/\/storage-assessment$/u);
  assert.match(requests[53].url,/\/billing-reconciliations\?limit=50$/u);
  assert.match(requests[54].url,/\/billing-reconciliations$/u);
  assert.match(requests[55].url,/\/billing-reconciliations\/00000000-0000-4000-8000-000000000002\/reviews$/u);
  assert.match(requests[56].url,/\/external-benchmark-cases\?periodKey=2026-10&status=pending&limit=100$/u);
  assert.match(requests[57].url,/\/external-benchmark-cases$/u);
  assert.match(requests[58].url,/\/external-benchmark-cases\/00000000-0000-4000-8000-000000000002\/reviews$/u);
  assert.match(requests[59].url,/\/source-relationships\?limit=100$/u);
  assert.match(requests[60].url,/\/source-relationships$/u);
  assert.match(requests[61].url,/\/event-cluster-diagnostics\?limit=50$/u);
  assert.match(requests[62].url,/\/researcher-jobs\/00000000-0000-4000-8000-000000000002$/u);
  assert.match(requests[63].url,/\/discoveries\/00000000-0000-4000-8000-000000000003\/reviews$/u);
  assert.match(requests[64].url,/\/discoveries\?limit=20&decision=needs-review&evaluatorKind=rule&sourceStatus=candidate&sort=priority&minTopicRelevance=0\.4$/u);
  assert.match(requests[65].url,/\/discovery-stats$/u);
  assert.match(requests[66].url,/\/candidate-evaluation\?evaluationKey=tier1-value-v1%3Adeepseek-chat$/u);
  assert.match(requests[67].url,/\/candidate-evaluation-datasets$/u);
  assert.match(requests[68].url,/\/candidate-evaluation-datasets$/u);
  assert.match(requests[69].url,/\/candidate-evaluation-datasets\/00000000-0000-4000-8000-000000000004\/runs\?limit=20$/u);
  assert.match(requests[70].url,/\/candidate-evaluation-datasets\/00000000-0000-4000-8000-000000000004\/runs$/u);
});
