import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSearchPlan,bindSearchVerification,buildSearchEvidence,createSearchStageHandlers,renderSearchResult,searchVerificationTemplate,searchVerificationInput,SEARCH_VERIFY_PROMPT,validateSearchPlan,validateSearchVerification,classifySearchResponseInstruction} from '../../apps/api/src/agent-plugins/github/search.mjs';
import {createGitHubRepositorySearchAdapter} from '../../apps/api/src/agent-github-repository-search-tool.mjs';
import {stableHash} from '../../apps/api/src/researcher-qa-protocol/stable-json.mjs';

const query=()=>({query:'project capability',limit:20,sort:'best-match',minStars:0,pushedAfter:null,filters:{language:null,license:null,createdAfter:null,createdBefore:null,pushedBefore:null,maxStars:null}});
const criterion=(id,quote,{kind='documented',value=quote,requirement='must',op=kind==='documented'?'supports':'eq'}={})=>({id,label:quote,kind,value,op,requirement,requestQuote:quote});
const response=(id,kind,quote,value=quote)=>({id,kind,label:quote,value,requestQuote:quote});
const plan=(criteria,responseRequirements=[])=>({criteria,responseRequirements,queries:[query()],assumptions:[],clarification:null});
const candidate=()=>({key:'fixture/tool',canonicalUrl:'https://github.com/fixture/tool',owner:'fixture',name:'tool',description:'fixture project',language:'Python',licenseSpdx:'MIT',stars:50,forks:0,topics:[],createdAt:'2020-01-01T00:00:00Z',pushedAt:'2026-11-20T00:00:00Z'});
function materials(c,body,release=null){
 const revision='a'.repeat(40),metadata={name:c.name,fullName:c.key,stars:c.stars};
 const rows=[{type:'readme',path:'README.md',canonicalUri:c.canonicalUrl+'/blob/'+revision+'/README.md',sourceRevision:revision,publishedAt:null,text:body,truncated:false,contentSha256:stableHash(body)}];
 if(release)rows.push({type:'release',path:'release.json',canonicalUri:c.canonicalUrl+'/releases/tag/v1',sourceRevision:revision,publishedAt:release,text:'Official stable release.',truncated:false,contentSha256:stableHash('Official stable release.')});
 return {schemaVersion:'github-repository-materials-v1',repository:{key:c.key,canonicalUrl:c.canonicalUrl},sourceVersion:{revision,canonicalUri:c.canonicalUrl+'/tree/'+revision,fetchedAt:'2026-11-24T00:00:00Z',contentSha256:stableHash({metadata,materials:rows})},metadata,materials:rows};
}
const selectorRequest='查找生成 DOM CSS selector 的项目，必须能在 JavaScript 网页中使用，优先 MIT 许可，排除纯资料合集。请逐项核验条件，给出证据链接；无法确认的说明原因，不写文章。';
const selectorCriteria=()=>[
 criterion('c1','生成 DOM CSS selector'),criterion('c2','必须能在 JavaScript 网页中使用'),
 criterion('c3','优先 MIT 许可',{kind:'license',value:'MIT',requirement:'prefer'}),criterion('c4','排除纯资料合集')
];
const selectorResponses=()=>[response('a1','evidence','逐项核验条件'),response('a2','evidence','给出证据链接'),response('a3','unknown-reasons','无法确认的说明原因'),response('a4','result-only','不写文章')];
test('original selector regression: legacy c5/c6/c7 become answer requirements and no longer demote a matching tool',()=>{
 const p=plan([...selectorCriteria(),criterion('c5','逐项核验条件，给出证据链接'),criterion('c6','无法确认的说明原因'),criterion('c7','不写文章')]);delete p.responseRequirements;
 const before=structuredClone(p),bound=bindSearchPlan(p,selectorRequest);assert.deepEqual(p,before);
 assert.equal(bound.criteria.length,4);assert.deepEqual(bound.responseRequirements.map(r=>r.kind),['evidence','unknown-reasons','result-only']);
 const c=candidate(),e=buildSearchEvidence(c,materials(c,'Generates DOM CSS selectors in web browsers. An executable JavaScript library, not a link collection.'),1),answer=searchVerificationTemplate(bound,[e]);
 for(const check of answer.candidates[0].checks)Object.assign(check,{status:'pass',reason:'文档支持该项目条件',references:[{source:'r1-m1',quote:e.sources[1].text}]});
 const r=bindSearchVerification(answer,bound,[c],[e]);assert.equal(r.candidates[0].verdict,'matched');
 const rendered=renderSearchResult({plan:bound,report:r,searches:[],asOf:'2026-11-24',discoveredCount:1});assert.equal(rendered.repositories.length,1);
 assert.doesNotMatch(rendered.reply,/材料未说明是否不写文章|没有确认满足全部硬条件/);assert.match(rendered.reply,/#L1-L1/);
});

test('schema separation is bounded, source-bound and backwards compatible',()=>{
 assert.equal(bindSearchPlan(plan(selectorCriteria(),selectorResponses()),selectorRequest).responseRequirements.length,4);
 const legacy=plan([criterion('c1','项目')]);delete legacy.responseRequirements;assert.deepEqual(validateSearchPlan(legacy),legacy);
 for(const change of [p=>{p.responseRequirements[0].requestQuote='fabricated';},p=>{p.responseRequirements.push({...p.responseRequirements[0]});},p=>{p.responseRequirements[0].kind='publish';},p=>{p.responseRequirements[0].value=10;}]){
  const p=plan(selectorCriteria(),selectorResponses());change(p);assert.throws(()=>bindSearchPlan(p,selectorRequest));
 }
 assert.throws(()=>validateSearchPlan(plan([criterion('c1','工具')],[response('a1','format','表格','table'),response('a2','format','列表','list')])));
 const mixed=plan([criterion('c1','项目，给出证据链接')],[response('a1','evidence','项目，给出证据链接')]);assert.throws(()=>bindSearchPlan(mixed,'项目，给出证据链接'),{code:'AGENT_GITHUB_SEARCH_CONDITION_SCOPE_AMBIGUOUS'});
});

test('answer-like words inside actual product features remain project criteria',()=>{
 for(const [request,quote]of [['找一个可逐项核验条件的库','逐项核验条件'],['找一个不写文章的工具','不写文章'],['找生成带证据链接报告的工具','生成带证据链接报告'],['找支持表格导出的库','支持表格导出']]){
  assert.equal(classifySearchResponseInstruction(quote,request),null);
  assert.equal(bindSearchPlan(plan([criterion('c1',quote)]),request).criteria.length,1);
 }
 assert.equal(classifySearchResponseInstruction('逐项核验条件','找一个逐项核验条件的库。请逐项核验条件。'),null);
 const onlyAnswer=plan([criterion('c1','不写文章')]);assert.throws(()=>bindSearchPlan(onlyAnswer,'不写文章'),{code:'AGENT_GITHUB_SEARCH_PROJECT_CONDITION_REQUIRED'});
});

test('answer coverage warnings never change candidate eligibility; missing product constraints still block',()=>{
 const p=plan([criterion('c1','浏览器工具')],[response('a1','result-only','不写文章')]),c=candidate(),e=buildSearchEvidence(c,materials(c,'This tool runs in web browsers.'),1),a=searchVerificationTemplate(p,[e]);
 Object.assign(a.candidates[0].checks[0],{status:'pass',reason:'作者声明浏览器可用',references:[{source:'r1-m1',quote:'runs in web browsers'}]});
 a.unhandledResponseRequirements=['用户要求的特别排版未覆盖'];
 let r=bindSearchVerification(a,p,[c],[e]);assert.equal(r.candidates[0].verdict,'matched');
 const rendered=renderSearchResult({plan:p,report:r,searches:[],asOf:'2026-11-24',discoveredCount:1});assert.match(rendered.reply,/回答要求待确认/);assert.equal(rendered.repositories.length,1);
 a.unhandledRequirements=['原请求的离线能力未提取'];r=bindSearchVerification(a,p,[c],[e]);assert.equal(r.candidates[0].verdict,'unconfirmed');
 a.unhandledResponseRequirements=['x'.repeat(181)];assert.throws(()=>validateSearchVerification(a));
});

test('answer entries cannot justify repository filters or enter candidate checks',()=>{
 const p=plan([criterion('c1','工具')],[response('a1','result-only','不写文章')]),c=candidate(),e=buildSearchEvidence(c,materials(c,'An executable tool for web browsers.'),1);
 const a=searchVerificationTemplate(p,[e]);a.candidates[0].checks.push({criterion:'a1',status:'unknown',reason:'仓库未说明不写文章',references:[]});
 assert.throws(()=>bindSearchVerification(a,p,[c],[e]),{code:'AGENT_GITHUB_SEARCH_CONDITION_MISSING'});
 const withFilter=structuredClone(p);withFilter.queries[0].filters.license='mit';assert.throws(()=>bindSearchPlan(withFilter,'找工具，不写文章'),{code:'AGENT_GITHUB_SEARCH_UNJUSTIFIED_FILTER'});
 const many=plan(Array.from({length:8},(_,i)=>criterion('c'+(i+1),'条件'+i)),Array.from({length:8},(_,i)=>response('a'+(i+1),'evidence','给出证据链接')));
 assert.equal(bindSearchPlan(many,'条件0 条件1 条件2 条件3 条件4 条件5 条件6 条件7；给出证据链接').criteria.length,8);
});

test('formatting retains citations and unknown reasons, escaping table cells and disclosing brief display limits',()=>{
 const c=candidate(),p=plan([criterion('c1','工具')],[response('a1','format','用表格列出结果','table')]),e=buildSearchEvidence(c,materials(c,'An executable tool for web browsers.'),1),a=searchVerificationTemplate(p,[e]);
 a.candidates[0].checks[0]={criterion:'c1',status:'pass',reason:'作者材料包含 | <tag>\n换行',references:[{source:'r1-m1',quote:e.sources[1].text}]};
 const r=bindSearchVerification(a,p,[c],[e]),args={plan:p,report:r,searches:[],asOf:'2026-11-24',discoveredCount:3};
 const table=renderSearchResult(args);assert.match(table.reply,/&#124; &lt;tag&gt;/);assert.doesNotMatch(table.reply,/<tag>/);assert.match(table.reply,/#L1-L1/);
 const brief=renderSearchResult({...args,plan:{...p,responseRequirements:[response('a1','format','简短列出结果','brief')]},report:{...r,candidates:Array.from({length:3},(_,i)=>({...r.candidates[0],key:'fixture/tool'+i}))}});
 assert.match(brief.reply,/展示前 2 个/);assert.match(brief.reply,/全部 3 个候选/);assert.equal(brief.repositories.length,3);
});

test('full answer and project requirement allowances retain the provider input byte ceiling',()=>{
 const criteria=Array.from({length:8},(_,i)=>criterion('c'+(i+1),'条'.repeat(200),{value:'件'.repeat(160)}));criteria.forEach(c=>c.label='项'.repeat(100));
 const responseRequirements=Array.from({length:8},(_,i)=>({...response('a'+(i+1),'evidence','引'.repeat(200),'值'.repeat(160)),label:'回'.repeat(100)}));
 const c=candidate(),e=buildSearchEvidence(c,materials(c,'中文材料。'.repeat(600)),1);
 const compiled=searchVerificationInput({request:'需求'.repeat(1000),asOf:'2026-11-24',criteria,responseRequirements,evidence:Array.from({length:5},(_,i)=>({...e,key:'fixture/repo'+i}))});
 assert(Buffer.byteLength(SEARCH_VERIFY_PROMPT)+Buffer.byteLength(JSON.stringify(compiled.payload))+128<=50000);
 assert.equal(compiled.payload.criteria.length,8);assert.equal(compiled.payload.responseRequirements.length,8);assert.equal(compiled.payload.evidence.length,5);
});

const cases=[
 {name:'DOM selector / browser / MIT preference / exclude collections',request:selectorRequest,plan:plan(selectorCriteria(),selectorResponses()),body:'Generates DOM CSS selectors in web browsers. An executable JavaScript library, not a link collection.',verdict:'matched'},
 {name:'offline Windows workflow / Python / low stars / table',request:'找工作流引擎，Windows运行，完全离线，必须Python，最多100星。请用表格列出结果，给出证据链接。',plan:plan([criterion('c1','工作流引擎'),criterion('c2','Windows运行'),criterion('c3','完全离线'),criterion('c4','必须Python',{kind:'language',value:'Python'}),criterion('c5','最多100星',{kind:'stars',op:'lte',value:'100'})],[response('a1','format','用表格列出结果','table'),response('a2','evidence','给出证据链接')]),body:'This workflow engine runs on Windows entirely offline.',verdict:'matched',configure:p=>{p.queries[0].filters.language='Python';p.queries[0].filters.maxStars=100;}},
 {name:'speech recognition / CPU / undocumented memory limit',request:'找语音识别工具，CPU可用，内存不超过4GB。无法确认的说明原因，不写文章。',plan:plan([criterion('c1','语音识别工具'),criterion('c2','CPU可用'),criterion('c3','内存不超过4GB')],[response('a1','unknown-reasons','无法确认的说明原因'),response('a2','result-only','不写文章')]),body:'Speech recognition runs on CPU without a GPU.',unknown:['c3'],verdict:'unconfirmed'},
 {name:'recent release / latest push is insufficient',request:'找数据库工具，正式Release在2026-11-01之后。给出证据链接。',plan:plan([criterion('c1','数据库工具'),criterion('c2','正式Release在2026-11-01之后',{kind:'released',op:'gte',value:'2026-11-01'})],[response('a1','evidence','给出证据链接')]),body:'This library provides database tools.',release:'2020-01-01T00:00:00Z',verdict:'excluded'},
 {name:'generative model / code MIT cannot prove weight commercial rights',request:'找生图模型，代码MIT，权重允许商用。无法确认的说明原因。',plan:plan([criterion('c1','生图模型'),criterion('c2','代码MIT',{kind:'license',value:'MIT'}),criterion('c3','权重允许商用')],[response('a1','unknown-reasons','无法确认的说明原因')]),body:'This model generates images from text prompts.',unknown:['c3'],verdict:'unconfirmed'},
 {name:'answer preference does not convert MIT into a mandatory filter',request:'找浏览器工具，优先MIT。逐项核验条件，不写文章。',plan:plan([criterion('c1','浏览器工具'),criterion('c2','优先MIT',{kind:'license',value:'MIT',requirement:'prefer'})],[response('a1','evidence','逐项核验条件'),response('a2','result-only','不写文章')]),body:'This tool runs in web browsers.',license:'Apache-2.0',verdict:'matched'},
 {name:'actual reporting product features remain documented conditions',request:'找可逐项核验条件的库，支持表格导出。给出证据链接。',plan:plan([criterion('c1','逐项核验条件'),criterion('c2','支持表格导出')],[response('a1','evidence','给出证据链接')]),body:'The library verifies conditions individually and exports tables.',verdict:'matched'},
];
for(const scenario of cases)test('local workflow acceptance: '+scenario.name,async()=>{
 const c={...candidate(),...(scenario.license?{licenseSpdx:scenario.license}:{})},p=structuredClone(scenario.plan);scenario.configure?.(p);
 const store=new Map(),calls={model:0,search:0,materials:0};
 const adapter=createGitHubRepositorySearchAdapter({contractVersion:2,fetchImpl:async()=>{calls.search++;return Response.json({items:[{name:c.name,owner:{login:c.owner},description:c.description,stargazers_count:c.stars,forks_count:c.forks,language:c.language,license:{spdx_id:c.licenseSpdx},pushed_at:c.pushedAt,created_at:c.createdAt}],total_count:1,incomplete_results:false});}});
 const handlers=createSearchStageHandlers({input:{request:scenario.request,asOf:'2026-11-24'},load:async key=>store.get(key),save:async(_ctx,_ex,key,content)=>{const a={id:key,content};store.set(key,a);return a;},model:async(_ctx,_ex,key,_schema,_prompt,payload)=>{
  calls.model++;if(key==='plan')return {output:p,actionId:key};
  assert.deepEqual(payload.responseRequirements,p.responseRequirements);assert(payload.responseTemplate.candidates.every(r=>r.checks.every(x=>p.criteria.some(c=>c.id===x.criterion&&c.kind==='documented'))));
  const answer=structuredClone(payload.responseTemplate);
  for(const r of answer.candidates)for(const check of r.checks){const unknown=scenario.unknown?.includes(check.criterion);Object.assign(check,{status:unknown?'unknown':'pass',reason:unknown?'现有材料未提供该条件证据。':'作者文档支持该项目条件。',references:unknown?[]:[{source:'r1-m1',quote:scenario.body}]});}
  return {output:answer,actionId:key};
 },tool:async(_ctx,_ex,key,name,_v,_cap,request)=>{
  assert(['research.github.repository.search-conditions','research.github.repository.materials.read'].includes(name),'no write or publication tool');
  if(key.startsWith('search'))return {...await adapter({request}),artifactId:key};calls.materials++;return {output:materials(c,scenario.body,scenario.release),artifactId:key};
 }});
 for(const h of Object.values(handlers))await h({},{});
 const result=store.get('agent.github.search-result').content;
 assert.equal(result.search.report.candidates[0].verdict,scenario.verdict);assert.equal(result.repositories.length,scenario.verdict==='matched'?1:0);
 assert.deepEqual(result.search.responseRequirements,p.responseRequirements);assert.equal(result.search.report.candidates[0].checks.length,p.criteria.length);
 if(scenario.unknown)assert.match(result.reply,/现有材料未提供该条件证据/);if(p.responseRequirements.some(r=>r.value==='table'))assert.match(result.reply,/\| 项目 \| 判定 \|/);
 assert.match(result.reply,/#L1-L1/);assert.deepEqual(calls,{model:2,search:1,materials:1});
 const frozen=JSON.stringify([...store]);for(const h of Object.values(handlers))await h({},{});assert.equal(JSON.stringify([...store]),frozen);assert.deepEqual(calls,{model:2,search:1,materials:1});
});
