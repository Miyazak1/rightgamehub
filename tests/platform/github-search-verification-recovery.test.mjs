import test from 'node:test';import assert from 'node:assert/strict';
import {bindSearchVerification,createSearchStageHandlers,locateSearchCitation,validateSearchVerification,searchVerificationTemplate} from '../../apps/api/src/agent-plugins/github/search.mjs';
const plan={criteria:[{id:'c1',kind:'documented',op:'supports',value:'CPU推理',label:'CPU推理',requirement:'must',requestQuote:'CPU推理'},{id:'c2',kind:'license',op:'eq',value:'MIT',label:'MIT偏好',requirement:'prefer',requestQuote:'MIT'}],responseRequirements:[],assumptions:[],queries:[],clarification:null};
const candidate={key:'fixture/tool',licenseSpdx:'MIT'},body='Runs entirely offline on Windows.\nCPU\r\nexecution is supported.\n'+'Detailed authoritative documentation. '.repeat(17);
const evidence=[{key:'fixture/tool',url:'https://github.com/fixture/tool',sources:[{id:'r1-meta',kind:'metadata',url:'https://api.github.com/repos/fixture/tool',text:'MIT'},{id:'r1-m1',kind:'readme',url:'https://github.com/fixture/tool/blob/'+'a'.repeat(40)+'/README.md',revision:'a'.repeat(40),text:body,truncated:false}]}];
function answer(refs=[{source:'r1-m1',quote:'CPU'}]){const a=searchVerificationTemplate(plan,evidence);Object.assign(a.candidates[0].checks[0],{status:'pass',reason:'作者文档说明支持CPU执行',references:refs});return a;}
async function verify(output,{error=null}={}){
 const store=new Map([['agent.github.search-plan',{id:'plan',content:plan}],['agent.github.search-search',{id:'search',content:{candidates:[candidate],searches:[],discoveredCount:1}}],['agent.github.search-evidence',{id:'evidence',content:{evidence,readFailures:[]}}]]),before=JSON.stringify([...store]);let calls=0;
 const handlers=createSearchStageHandlers({input:{request:'CPU推理，优先MIT',asOf:'2026-11-24'},load:async k=>store.get(k),save:async(_ctx,_ex,key,content,refs)=>{const a={id:key,content,refs};store.set(key,a);return a;},model:async()=>{calls++;if(error)throw error;return {output,actionId:'verify-action'};},tool:async()=>assert.fail('no repeated searches or material requests')});
 await handlers['agent.github.search:verify']({},{});const result=store.get('agent.github.search-result').content;
 await handlers['agent.github.search:verify']({},{});assert.equal(calls,1);assert.equal(JSON.stringify([...store].slice(0,3)),before);return result;
}
test('short exact citations and full long citations bind to real material with bounded displayed quotes',()=>{
 for(const quote of ['CPU',body]){const r=bindSearchVerification(answer([{source:'r1-m1',quote}]),plan,[candidate],evidence);assert.equal(r.candidates[0].verdict,'matched');const ref=r.candidates[0].checks[0].references[0];assert(ref.quote.length<=400);assert(body.includes(ref.quote));}
 assert.throws(()=>validateSearchVerification(answer([{source:'r1-m1',quote:'x'.repeat(1201)}])),{code:'AGENT_GITHUB_SEARCH_VERIFICATION_INVALID'});
});
test('whitespace-only normalization maps to actual source lines; paraphrases, regex tokens and ambiguous spans are not invented',()=>{
 const r=bindSearchVerification(answer([{source:'r1-m1',quote:'CPU execution is supported.'}]),plan,[candidate],evidence);const ref=r.candidates[0].checks[0].references[0];assert.equal(ref.whitespaceNormalized,true);assert.equal(ref.quote,'CPU\r\nexecution is supported.');assert.equal(ref.fromLine,2);assert.equal(ref.toLine,3);
 assert.equal(locateSearchCitation('CPU\nmode CPU\tmode','CPU mode'),null);
 assert.equal(locateSearchCitation('CPU mode is enabled','CPU execution works'),null);
 assert.equal(locateSearchCitation('x\ny','.* y'),null);
});
for(const [topic,refs]of [
 ['2-offline-workflow',[{source:'r1-m1',quote:'This project never uses cloud services.'}]],
 ['5-sqlite-created',[{source:'r1-m1',quote:'The SQLite manager has a desktop GUI.'}]],
 ['6-model-license',[{source:'r2-m1',quote:'Weights permit commercial use.'}]],
 ['8-license-checker',[{source:'r1-meta',quote:'MIT'}]],
])test('observed citation-error class / '+topic+': invalid evidence becomes an explicit unknown, never a recommendation',async()=>{
 const raw=answer(refs),frozen=JSON.stringify(raw);assert.throws(()=>bindSearchVerification(raw,plan,[candidate],evidence),{code:'AGENT_GITHUB_SEARCH_CITATION_INVALID'});
 const result=await verify(raw);assert.equal(JSON.stringify(raw),frozen);assert.equal(result.repositories.length,0);assert.equal(result.search.report.verificationStatus,'partial');assert.equal(result.search.report.candidates[0].checks[0].status,'unknown');assert.deepEqual(result.search.report.candidates[0].checks[0].references,[]);assert.equal(result.search.report.candidates[0].checks[1].status,'pass');assert.match(result.reply,/部分核验未完成/);assert.doesNotMatch(result.reply,/Weights permit|project never|desktop GUI/);
});
test('observed quote-bound error class / 4-backup-release: real short and long quotations no longer discard the result',async()=>{
 const result=await verify(answer([{source:'r1-m1',quote:body}]));assert.equal(result.repositories.length,1);assert.equal(result.search.report.verificationStatus,undefined);
 const missing=await verify(answer([]));assert.equal(missing.repositories.length,0);assert.equal(missing.search.report.validationIssues[0].code,'AGENT_GITHUB_SEARCH_CITATION_REQUIRED');
});
test('observed JSON error class / 7-speech-memory: whole fences parse, malformed/prose/duplicate JSON is not repaired',async()=>{
 const fenced='```json\n'+JSON.stringify(answer())+'\n```';assert.equal((await verify(fenced)).repositories.length,1);
 for(const raw of ['{broken','explanation\n'+JSON.stringify(answer()),'{"candidates":[],"candidates":[],"limitations":[],"unhandledRequirements":[]}']){
  const result=await verify(raw);assert.equal(result.repositories.length,0);assert.equal(result.search.report.verificationStatus,'incomplete');assert.match(result.reply,/不是完整验收成功/);
 }
 const upstream=Object.assign(new Error('AGENT_PROVIDER_OUTPUT_INVALID'),{code:'AGENT_PROVIDER_OUTPUT_INVALID',cause:{code:'AGENT_GITHUB_SEARCH_VERIFICATION_INVALID'}});
 assert.equal((await verify(null,{error:upstream})).search.report.verificationStatus,'incomplete');
});
test('permission, budget, transport, uncertainty and cancellation never become a successful fallback',async()=>{
 for(const error of [{code:'AGENT_BUDGET_DENIED'},{code:'AGENT_PLUGIN_DISABLED'},{code:'AGENT_PROVIDER_TIMEOUT'},{code:'AGENT_PROVIDER_OUTPUT_INVALID'},{code:'AGENT_PROVIDER_OUTPUT_INVALID',cause:{code:'OTHER_VALIDATOR'}},{code:'AGENT_GITHUB_SEARCH_VERIFICATION_INVALID',uncertain:true},{code:'AGENT_PROVIDER_CANCELLED'}])await assert.rejects(verify(null,{error:Object.assign(new Error(error.code),error)}));
 const wrong=answer();wrong.candidates[0].key='other/repo';await assert.rejects(verify(wrong),{code:'AGENT_GITHUB_SEARCH_CANDIDATE_UNBOUND'});
 const missing=answer();missing.candidates[0].checks=[];await assert.rejects(verify(missing),{code:'AGENT_GITHUB_SEARCH_CONDITION_MISSING'});
});

test('one bad citation invalidates that check even alongside a valid quote, without discarding another verified candidate',()=>{
 const second={...evidence[0],key:'fixture/second',url:'https://github.com/fixture/second',sources:evidence[0].sources.map(s=>({...s,id:s.id.replace('r1-','r2-'),url:s.url.replace('fixture/tool','fixture/second')}))};
 const a=answer([{source:'r1-m1',quote:'CPU'},{source:'r1-m1',quote:'Invented cloud-free performance guarantee.'}]);
 a.candidates.push({key:second.key,checks:[{criterion:'c1',status:'pass',reason:'作者文档支持',references:[{source:'r2-m1',quote:'CPU'}]}]});
 const r=bindSearchVerification(a,plan,[candidate,{...candidate,key:second.key}],[...evidence,second],{recoverCitations:true});
 assert.equal(r.verificationStatus,'partial');assert.equal(r.candidates.find(c=>c.key==='fixture/tool').verdict,'unconfirmed');assert.equal(r.candidates.find(c=>c.key===second.key).verdict,'matched');assert.equal(r.validationIssues.length,1);
});
