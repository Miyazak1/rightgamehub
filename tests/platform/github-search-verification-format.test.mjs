import test from 'node:test';import assert from 'node:assert/strict';
import {validateSearchVerification,bindSearchVerification,searchVerificationTemplate,searchVerificationInput,SEARCH_VERIFY_PROMPT,createSearchStageHandlers} from '../../apps/api/src/agent-plugins/github/search.mjs';
import {compileAgentProviderRequest} from '../../apps/api/src/agent-provider-request.mjs';
const criteria=[{id:'c1',label:'浏览器可用',requirement:'must',kind:'documented',op:'supports',value:'browser',requestQuote:'浏览器'},
 {id:'c2',label:'MIT许可偏好',requirement:'prefer',kind:'license',op:'eq',value:'MIT',requestQuote:'MIT'}];
const plan={criteria,queries:[],assumptions:[],clarification:null};
const evidence=[{key:'fixture/browser',url:'https://github.com/fixture/browser',description:'selector generator',sources:[{id:'r1-meta',kind:'metadata',url:'https://api.github.com/repos/fixture/browser',text:'{"licenseSpdx":"MIT"}',truncated:false},{id:'r1-m1',kind:'readme',url:'https://github.com/fixture/browser/blob/'+'a'.repeat(40)+'/README.md',revision:'a'.repeat(40),text:'This library runs in web browsers.',truncated:false}]}];
const candidates=[{key:'fixture/browser',language:'TypeScript',licenseSpdx:'MIT',stars:50}];
function reply(){const v=searchVerificationTemplate(plan,evidence);v.candidates[0].checks[0]={criterion:'c1',status:'pass',reason:'作者文档说明浏览器运行',references:[{source:'r1-m1',quote:'runs in web browsers'}]};return v;}
test('verification template requests documented checks only; metadata is calculated even when omitted by the model',()=>{
 const v=reply();assert.deepEqual(v.candidates[0].checks.map(c=>c.criterion),['c1']);
 const r=bindSearchVerification(v,plan,candidates,evidence);assert.equal(r.candidates[0].verdict,'matched');assert.equal(r.candidates[0].checks[1].basis,'metadata');
 assert.equal(r.candidates[0].checks[1].status,'pass');
 const denied=bindSearchVerification(v,{...plan,criteria:[criteria[0],{...criteria[1],requirement:'must',value:'Apache-2.0'}]},candidates,evidence);assert.equal(denied.candidates[0].verdict,'excluded');
 v.candidates[0].checks=[];assert.throws(()=>bindSearchVerification(v,plan,candidates,evidence),{code:'AGENT_GITHUB_SEARCH_CONDITION_MISSING'});
});
test('legacy short metadata citations do not fail formatting or bypass documented evidence checks',()=>{
 const v=reply();v.candidates[0].checks.push({criterion:'c2',status:'fail',reason:'模型元数据判断不可信',references:[{source:'r1-meta',quote:'MIT'}]});
 assert.equal(validateSearchVerification(v).candidates.length,1);assert.equal(bindSearchVerification(v,plan,candidates,evidence).candidates[0].checks[1].status,'pass');
 v.candidates[0].checks[0].references=[{source:'r1-meta',quote:'MIT'}];assert.throws(()=>bindSearchVerification(v,plan,candidates,evidence),{code:'AGENT_GITHUB_SEARCH_CITATION_INVALID'});
});
test('verification format errors identify fixed schema paths without printing model content',()=>{
 const cases=[
  [v=>{delete v.unhandledRequirements;},'$'],
  [v=>{v.candidates[0].checks[0].status='pass|fail|unknown';},'$.candidates[0].checks[0].status'],
  [v=>{v.candidates[0].checks[0].references[0].quote='';},'$.candidates[0].checks[0].references[0].quote'],
  [v=>{v.candidates[0].checks[0].reason='x'.repeat(141);},'$.candidates[0].checks[0].reason'],
  [v=>{v.limitations=null;},'$.limitations']
 ];
 for(const [change,field]of cases){const v=reply();change(v);assert.throws(()=>validateSearchVerification(v),e=>e.code==='AGENT_GITHUB_SEARCH_VERIFICATION_INVALID'&&e.field===field&&!e.message.includes('x'.repeat(141)));}
});
test('verification template and multibyte material input remain under the actual provider budget',()=>{
 const cs=Array.from({length:8},(_,i)=>({...criteria[0],id:'c'+(i+1),label:'条'.repeat(100),value:'件'.repeat(160),requestQuote:'引'.repeat(200)}));
 const es=Array.from({length:5},(_,i)=>({...evidence[0],key:'fixture/r'+i,description:'中'.repeat(1000),sources:[evidence[0].sources[0],...Array.from({length:6},(_,j)=>({...evidence[0].sources[1],id:'r'+(i+1)+'-m'+j,text:'中文材料'.repeat(400)}))]}));
 const input=searchVerificationInput({request:'需求'.repeat(1000),asOf:'2026-11-23',criteria:cs,evidence:es});assert.equal(input.truncated,true);
 const request={messages:[{role:'system',content:SEARCH_VERIFY_PROMPT},{role:'user',content:JSON.stringify(input.payload)}]};
 assert.ok(compileAgentProviderRequest({request,modelPolicy:{maxInputTokens:50000,maxOutputTokens:5000},tokenCeiling:5000,timeoutSeconds:130}).inputTokens<=50000);
 assert.equal(input.payload.criteria.length,8);assert.equal(input.payload.evidence.length,5);assert.ok(input.payload.evidence.every(e=>e.sources.some(s=>s.truncated)));
 assert.ok(es[0].sources[1].text.length>input.payload.evidence[0].sources[1].text.length);
});
test('actual verify handler supplies the keyed template, binds real references and uses one existing model call',async()=>{
 let calls=0,saved;
 const store={'agent.github.search-plan':{id:'plan',content:plan},'agent.github.search-search':{id:'search',content:{candidates,searches:[],discoveredCount:1}},'agent.github.search-evidence':{id:'evidence',content:{evidence,readFailures:[]}}};
 const handlers=createSearchStageHandlers({input:{request:'浏览器工具优先MIT',asOf:'2026-11-23'},load:async k=>store[k],save:async(_c,_ex,key,content)=>{saved=content;return {id:key};},model:async(_c,_ex,key,_schema,_system,payload)=>{calls++;assert.equal(key,'verify');assert.equal(payload.criteria.length,2);assert.equal(payload.responseTemplate.candidates[0].checks.length,1);return {output:reply(),actionId:'verify-action'};},tool:async()=>assert.fail('verify must reuse gathered evidence')});
 await handlers['agent.github.search:verify']({},{});assert.equal(calls,1);assert.match(saved.reply,/MIT/);assert.equal(saved.search.report.candidates[0].verdict,'matched');
});
