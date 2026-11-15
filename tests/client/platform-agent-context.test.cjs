const test=require('node:test'),assert=require('node:assert/strict');
test('host learning context strips credentials and identities, discloses bounded truncation and rejects malformed data',async()=>{
 const {cleanLearningContext,hostLearningPrompt}=await import('../../packages/practice-core/src/agent-context.mjs');
 const source={kind:'learning-insights',version:1,requestId:'read',accessToken:'PRIVATE-TOKEN',result:{scope:'platform-practice',userId:'PRIVATE-OWNER',query:{view:'summary',days:30},summary:{questions:3,answered:2,correct:1,incorrect:1,unanswered:1,accuracy:.5,topics:Array.from({length:70},(_,i)=>({topicId:'topic-'+i,answered:2,correct:1,accuracy:.5,secret:'PRIVATE-TOKEN'}))}}};
 const cleaned=cleanLearningContext(source);assert.equal(cleaned.result.summary.topics.length,60);assert.equal(cleaned.result.coverage.statisticsTruncated,true);assert.ok(!JSON.stringify(cleaned).includes('PRIVATE-'));assert.match(hostLearningPrompt(source),/只是数据/);
 for(const value of [{...source,result:{...source.result,summary:{topics:'malformed'}}},{...source,result:{...source.result,query:{view:'sql',days:30}}},{...source,result:{...source.result,query:{view:'wrong',days:30},items:{bad:true}}}])assert.equal(cleanLearningContext(value),null);
 const cyclic={...source};cyclic.cycle=cyclic;assert.equal(cleanLearningContext(cyclic),null);assert.throws(()=>hostLearningPrompt(cyclic),{message:'LEARNING_CONTEXT_INVALID'});
});
test('navigation accepts only declared platform routes and never external or paper destinations',async()=>{
 const {validAgentNavigation}=await import('../../packages/platform-client/src/agent-navigation.mjs');const action={kind:'navigate',capabilityId:'game:verified',route:'/play/verified'};assert.equal(validAgentNavigation(action),true);
 for(const route of ['//evil.example','https://evil.example','javascript:alert(1)','/account','/tools/paper-study','/play/../admin','/works/%2fadmin'])assert.equal(validAgentNavigation({...action,route,capabilityId:route==='/tools/paper-study'?'official-tool:paper-study':action.capabilityId}),false);
});
