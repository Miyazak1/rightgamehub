import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchStageHandlers,bindSearchPlan,bindSearchVerification,buildSearchEvidence,renderSearchResult} from '../../apps/api/src/agent-plugins/github/search.mjs';
import {createGitHubRepositorySearchAdapter,validateGitHubRepositorySearchV2Input} from '../../apps/api/src/agent-github-repository-search-tool.mjs';
import {stableHash} from '../../apps/api/src/researcher-qa-protocol/stable-json.mjs';
import {admitGitHubTask} from '../../apps/api/src/agent-plugins/github/admission.mjs';

export const filters=()=>({language:null,license:null,createdAfter:null,createdBefore:null,pushedBefore:null,maxStars:null});
export const query=()=>({query:'local workflow',limit:20,sort:'best-match',minStars:0,pushedAfter:null,filters:filters()});
export const criterion=(kind='documented',value='offline execution',op='supports',requirement='must',id='c1')=>({id,label:value,kind,value,op,requirement,requestQuote:'找项目'});
export const planFor=criteria=>({criteria,queries:[query()],assumptions:[],clarification:null});
export const candidate=()=>({key:'fixture/local',canonicalUrl:'https://github.com/fixture/local',owner:'fixture',name:'local',description:'Offline workflow engine',language:'Python',licenseSpdx:'MIT',stars:50,forks:2,topics:[],createdAt:'2020-01-01T00:00:00Z',pushedAt:'2026-11-20T00:00:00Z'});
export function materials(c=candidate(),body='Runs entirely offline on Windows. MIT licensed source code. 中文界面支持。 CPU only mode is supported.'){
 const metadata={name:c.name,fullName:c.key,stars:c.stars},revision='a'.repeat(40),ms=[{type:'readme',path:'README.md',canonicalUri:c.canonicalUrl+'/blob/'+revision+'/README.md',sourceRevision:revision,publishedAt:null,text:body,truncated:false,contentSha256:stableHash(body)}];
 return {schemaVersion:'github-repository-materials-v1',repository:{key:c.key,canonicalUrl:c.canonicalUrl},sourceVersion:{revision,canonicalUri:c.canonicalUrl+'/tree/'+revision,fetchedAt:'2026-11-23T00:00:00Z',contentSha256:stableHash({metadata,materials:ms})},metadata,materials:ms};
}
export const answer=(cs,status='pass',refs=[{source:'r1-m1',quote:'Runs entirely offline on Windows.'}])=>({candidates:[{key:'fixture/local',checks:cs.map(c=>({criterion:c.id,status,reason:'材料说明支持该条件',references:refs}))}],limitations:[],unhandledRequirements:[]});

test('new search admission freezes the original full requirements, not just a shortened topic',async()=>{
 const request='找项目，Python、Windows、离线，不能需要云服务';
 const task=await admitGitHubTask('github_search_projects',{topic:'workflow'},{row:{input_json:{message:request}}});
 assert.equal(task.searchProtocol,2);assert.equal(task.userRequest,request);
 const article=await admitGitHubTask('github_write_article',{topic:'workflow'},{row:{input_json:{message:'写文章'}}});assert.equal(article.searchProtocol,undefined);
 const inspect=await admitGitHubTask('github_search_projects',{topic:'inspect',repositoryUrl:'https://github.com/fixture/local'},{row:{input_json:{message:request}}});assert.equal(inspect.searchProtocol,undefined);
});
test('typed qualifiers encode language/license/date/stars, omit default sort, preserve the unmodified legacy adapter',async()=>{
 const urls=[],fetchImpl=async url=>{urls.push(String(url));return Response.json({items:[],total_count:0,incomplete_results:false});};
 const adapter=createGitHubRepositorySearchAdapter({fetchImpl,contractVersion:2}),q={...query(),filters:{...filters(),language:'C++',license:'mit',createdAfter:'2026-01-01',maxStars:1000}};
 const r=await adapter({request:q});assert.equal(r.output.schemaVersion,'github-repository-search-v2');
 const url=new URL(urls[0]);assert.equal(url.searchParams.has('sort'),false);assert.match(url.searchParams.get('q'),/language:C\+\+/);assert.match(url.searchParams.get('q'),/created:>=2026-01-01/);
 const old=await createGitHubRepositorySearchAdapter({fetchImpl})({request:{query:'workflow engine',limit:20,sort:'stars',minStars:10,pushedAfter:null}});assert.equal(old.output.schemaVersion,'github-repository-search-v1');assert.equal(Object.hasOwn(old.output,'incompleteResults'),false);
});
test('search qualifier injection, impossible dates and conflicting ranges fail before dispatch',()=>{
 for(const q of [{...query(),query:'foo repo:secret'},{...query(),filters:{...filters(),language:'Python OR repo:other'}},{...query(),filters:{...filters(),createdAfter:'2026-02-30'}},{...query(),minStars:100,filters:{...filters(),maxStars:10}},{...query(),filters:{...filters(),createdAfter:'2026-11-20',createdBefore:'2026-01-01'}}])assert.throws(()=>validateGitHubRepositorySearchV2Input(q));
});
test('planner cannot silently invent a stars floor, convert a preference to a filter or invent source wording',()=>{
 const p=planFor([criterion('language','Python','eq','prefer')]);p.queries[0].filters.language='Python';assert.throws(()=>bindSearchPlan(p,'找项目'),{code:'AGENT_GITHUB_SEARCH_UNJUSTIFIED_FILTER'});
 const p2=planFor([criterion()]);p2.queries[0].minStars=10;assert.throws(()=>bindSearchPlan(p2,'找项目'),{code:'AGENT_GITHUB_SEARCH_UNJUSTIFIED_FILTER'});
 assert.throws(()=>bindSearchPlan(p2,'different text'),{code:'AGENT_GITHUB_SEARCH_CONDITION_UNBOUND'});
});
const cases=[
 ['language and license', [criterion('language','Python','eq'),criterion('license','MIT','eq','must','c2')],'matched'],
 ['recently created, despite a recent push', [criterion('created','2026-08-01','gte')],'excluded'],
 ['actively maintained', [criterion('pushed','2026-11-01','gte')],'matched'],
 ['low stars rather than popular-first', [criterion('stars','100','lte')],'matched'],
 ['offline Windows feature documented', [criterion()],'matched'],
 ['unsupported platform explicitly contradicts docs', [criterion('documented','requires cloud')],'excluded'],
 ['unknown hardware limit is not filled from name', [criterion('documented','fits 4GB VRAM')],'unconfirmed'],
 ['weight commercial license not implied by MIT code', [criterion('documented','commercial model weights')],'unconfirmed'],
 ['no release is not evidence of a recent release', [criterion('released','2026-11-01','gte')],'unconfirmed'],
 ['unmet preference does not exclude', [criterion('stars','1000','gte','prefer')],'matched']
];
for(const [name,cs,expected]of cases)test('condition verification: '+name,()=>{
 const c=candidate(),e=buildSearchEvidence(c,materials(c),1),p=planFor(cs);
 let a=answer(cs);
 if(expected==='unconfirmed')a=answer(cs,'unknown',[]);
 if(name.startsWith('unsupported'))a=answer(cs,'fail');
 const report=bindSearchVerification(a,p,[c],[e]);assert.equal(report.candidates[0].verdict,expected);
 if(cs.every(c=>c.kind!=='documented'))assert.equal(report.candidates[0].checks[0].basis,'metadata');
});
test('bad citation, cross-repository source, missing checks and fake candidates fail closed',()=>{
 const c=candidate(),p=planFor([criterion()]),e=buildSearchEvidence(c,materials(c),1);
 for(const a of [answer(p.criteria,'pass',[{source:'r1-m1',quote:'This sentence was never in the file.'}]),answer(p.criteria,'pass',[{source:'r2-m1',quote:'Runs entirely offline on Windows.'}]),answer([]),{...answer(p.criteria),candidates:[]}])assert.throws(()=>bindSearchVerification(a,p,[c],[e]));
 assert.throws(()=>bindSearchVerification(answer(p.criteria,'pass',[]),p,[c],[e]),{code:'AGENT_GITHUB_SEARCH_CITATION_REQUIRED'});
});
test('metadata cannot substitute for documented functionality; incomplete results and unknown remain explicit',()=>{
 const c=candidate(),p=planFor([criterion()]),e=buildSearchEvidence(c,null,1);
 assert.throws(()=>bindSearchVerification(answer(p.criteria,'pass',[{source:'r1-meta',quote:e.sources[0].text}]),p,[c],[e]),{code:'AGENT_GITHUB_SEARCH_CITATION_INVALID'});
 const report=bindSearchVerification(answer(p.criteria,'unknown',[]),p,[c],[e]);
 const r=renderSearchResult({plan:p,report,searches:[{query:{},source:{canonicalUri:'https://api.github.com/search/repositories?q=test',fetchedAt:'2026-11-23'},incompleteResults:true,totalCount:100}],asOf:'2026-11-23',discoveredCount:100});
 assert.equal(r.repositories.length,0);assert.match(r.reply,/待确认/);assert.match(r.reply,/可能不完整/);assert.match(r.reply,/没有自动放宽条件/);
});
test('independent request-coverage warning prevents a candidate from being called fully matched',()=>{
 const c=candidate(),p=planFor([criterion()]),e=buildSearchEvidence(c,materials(c),1),a=answer(p.criteria);a.unhandledRequirements=['原请求还有GPU显存限制，当前条件未覆盖'];
 const report=bindSearchVerification(a,p,[c],[e]);assert.equal(report.candidates[0].verdict,'unconfirmed');
 const r=renderSearchResult({plan:p,report,searches:[],asOf:'2026-11-23',discoveredCount:1});assert.equal(r.repositories.length,0);assert.match(r.reply,/需求覆盖待确认/);
});
test('actual stage handlers use adapter responses, deduplicate, persist evidence and replay without network or model calls',async()=>{
 const c=candidate(),p=planFor([criterion()]),store=new Map(),calls={model:0,network:0,materials:0};p.queries.push({...query(),query:'offline workflow'});
 const adapter=createGitHubRepositorySearchAdapter({contractVersion:2,fetchImpl:async url=>{calls.network++;return Response.json({items:[{name:c.name,owner:{login:c.owner},description:c.description,stargazers_count:c.stars,forks_count:c.forks,language:c.language,license:{spdx_id:c.licenseSpdx},pushed_at:c.pushedAt,created_at:c.createdAt}],incomplete_results:false,total_count:1});}});
 const handlers=createSearchStageHandlers({input:{request:'找项目',asOf:'2026-11-23'},load:async key=>store.get(key),save:async(_ctx,_ex,key,content)=>{const a={id:key,content};store.set(key,a);return a;},model:async(_c,_e,key)=>{calls.model++;return {output:key==='plan'?p:answer(p.criteria),actionId:key};},tool:async(_c,_e,key,_name,_version,_cap,request)=>{
  if(key.startsWith('search'))return {...await adapter({request}),status:'succeeded',artifactId:key};calls.materials++;return {output:materials(),artifactId:key};
 }});
 for(const h of Object.values(handlers))await h({},{});
 const r=store.get('agent.github.search-result').content;assert.equal(r.repositories.length,1);assert.equal(r.search.discoveredCount,1);assert.match(r.reply,/#L1-L1/);assert.deepEqual(calls,{model:2,network:2,materials:1});
 for(const h of Object.values(handlers))await h({},{});assert.deepEqual(calls,{model:2,network:2,materials:1});
});
test('empty result and clarification consume no material or verification model calls',async()=>{
 for(const clarification of [null,'请确认是否允许外部API']){
  const p=planFor([criterion()]);p.clarification=clarification;if(clarification)p.queries=[];
  const store=new Map(),calls={model:0,tool:0};
  const adapter=createGitHubRepositorySearchAdapter({contractVersion:2,fetchImpl:async()=>Response.json({items:[],incomplete_results:false,total_count:0})});
  const hs=createSearchStageHandlers({input:{request:'找项目',asOf:'2026-11-23'},load:async k=>store.get(k),save:async(_c,_e,k,content)=>{const a={id:k,content};store.set(k,a);return a;},model:async()=>{calls.model++;return {output:p};},tool:async(_c,_e,k,_n,_v,_cap,request)=>{calls.tool++;assert.match(k,/^search/);return {...await adapter({request}),artifactId:k};}});
  for(const h of Object.values(hs))await h({},{});assert.equal(calls.model,1);assert.equal(calls.tool,clarification?0:1);assert.equal(store.get('agent.github.search-result').content.repositories.length,0);
 }
});
test('material read failure stays unknown; budget, permission and uncertain outcomes are never swallowed',async()=>{
 for(const error of [{code:'AGENT_GITHUB_MATERIALS_EMPTY'},{code:'AGENT_BUDGET_DENIED'},{code:'AGENT_PLUGIN_DISABLED'},{code:'AGENT_GITHUB_NETWORK_FAILED',uncertain:true}]){
  const store=new Map([['agent.github.search-search',{id:'searched',content:{candidates:[candidate()]}}]]);
  const handlers=createSearchStageHandlers({input:{},load:async k=>store.get(k),save:async(_c,_e,k,content)=>{const a={id:k,content};store.set(k,a);return a;},tool:async()=>{throw Object.assign(new Error(error.code),error);}});
  if(error.code==='AGENT_GITHUB_MATERIALS_EMPTY'){await handlers['agent.github.search:gather']({},{});const e=store.get('agent.github.search-evidence').content;assert.deepEqual(e.readFailures,['fixture/local']);assert.equal(e.evidence[0].sources.length,1);}
  else await assert.rejects(handlers['agent.github.search:gather']({},{}),e=>e.code===error.code);
 }
});
test('large Chinese official materials stay within the provider request byte ceiling and disclose truncation',()=>{
 const c=candidate(),m=materials(c,'中文材料说明。'.repeat(1400));
 m.materials=Array.from({length:6},(_,i)=>({...m.materials[0],path:'docs/guide'+i+'.md',canonicalUri:c.canonicalUrl+'/blob/'+'a'.repeat(40)+'/docs/guide'+i+'.md'}));
 m.sourceVersion.contentSha256=stableHash({metadata:m.metadata,materials:m.materials});
 const evidence=Array.from({length:5},(_,i)=>buildSearchEvidence(c,m,i+1));
 assert(Buffer.byteLength(JSON.stringify({evidence}))<50000);assert(evidence.every(e=>e.sources.filter(s=>s.kind!=='metadata').every(s=>s.truncated)));
});
