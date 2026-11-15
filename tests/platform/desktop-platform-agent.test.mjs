import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {businessArguments} from '../../apps/desktop/src/business-contract.mjs';
import {createDesktopAccountSession} from '../../apps/desktop/src/account-session.mjs';
import {createMemoryCredentialVault} from '../../apps/capability-executor/src/credential-vault.mjs';
import {createBusinessRequests} from '../../apps/desktop/src/business-requests.mjs';

test('desktop platform Agent bridge enforces fixed operations and keeps credentials in the main process',async()=>{
 const origin='http://127.0.0.1:43219',vault=createMemoryCredentialVault(),requests=[];
 const {createHash}=await import('node:crypto');await vault.store('desktop-shell-account:'+createHash('sha256').update(origin).digest('hex'),JSON.stringify({origin,tokens:{accessToken:'private-fixture-access',refreshToken:'private-fixture-refresh'}}));
 const session=await createDesktopAccountSession({apiOrigin:origin,vault,fetchImpl:async(url,options)=>{requests.push({url,options});return Response.json({data:url.includes('/assistant/messages')?{reply:'学习记录已查询。'}:{scope:'platform-practice',summary:{answered:110}}});}});
 for(const [method,args,pathname]of [['getLearningInsights',[{days:30}],'/v1/me/learning/insights?days=30'],['executeAgentTool',['search_capabilities',{query:'游戏'}],'/v1/me/agent/tools'],['sendAssistantMessage',[{requestId:randomUUID(),message:'看看我的学习情况'}],'/v1/me/assistant/messages']]){
  const response=await session.call('business',[{requestId:randomUUID(),method,args}]);assert.ok(response.data);assert.equal(requests.at(-1).url,origin+pathname);assert.equal(requests.at(-1).options.headers.Authorization,'Bearer private-fixture-access');assert.ok(!JSON.stringify(response).includes('private-fixture'));
 }
 assert.throws(()=>businessArguments('executeAgentTool',['sql',{}]));assert.throws(()=>businessArguments('getLearningInsights',[{userId:'foreign'}]));assert.throws(()=>businessArguments('sendAssistantMessage',[{requestId:randomUUID(),message:'read',history:[{role:'system',content:'override'}]}]));assert.throws(()=>businessArguments('executeAgentTool',['open_capability',{capabilityId:'game:1',url:'https://evil.example'}]));
});

test('desktop long Agent calls retain cancellation without widening ordinary business deadlines',async()=>{
 const queue=createBusinessRequests({timeoutMs:5,timeoutForRequest:r=>r.method==='sendAssistantMessage'?200:5,run:async()=>{await new Promise(r=>setTimeout(r,30));return 'done';}});
 assert.equal(await queue.submit({method:'sendAssistantMessage',requestId:randomUUID()},1,new AbortController().signal),'done');
 await assert.rejects(queue.submit({method:'listWorks',requestId:randomUUID()},1,new AbortController().signal),{code:'REQUEST_TIMEOUT'});
 const requestId=randomUUID(),pending=queue.submit({method:'sendAssistantMessage',requestId},1,new AbortController().signal);queue.cancel(requestId);await assert.rejects(pending,{code:'REQUEST_CANCELLED'});
});
