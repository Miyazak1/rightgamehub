import test from 'node:test';
import assert from 'node:assert/strict';
import {SEARCH_PLAN_PROMPT,SEARCH_PLAN_FORMAT_EXAMPLE,validateSearchPlan,bindSearchPlan} from '../../apps/api/src/agent-plugins/github/search.mjs';

const request='查找用于生成 DOM CSS selector 的 GitHub 项目，必须能在 JavaScript 网页中使用，优先 MIT 许可，排除纯资料合集。请逐项核验条件，给出证据链接；无法确认的说明原因，不写文章。';
function selectorPlan(){
 const p=structuredClone(SEARCH_PLAN_FORMAT_EXAMPLE);
 p.criteria=[
  {id:'c1',label:'生成DOM选择器',requirement:'must',kind:'documented',op:'supports',value:'生成 DOM CSS selector',requestQuote:'生成 DOM CSS selector'},
  {id:'c2',label:'浏览器网页可用',requirement:'must',kind:'documented',op:'supports',value:'JavaScript 网页运行',requestQuote:'必须能在 JavaScript 网页中使用'},
  {id:'c3',label:'MIT许可偏好',requirement:'prefer',kind:'license',op:'eq',value:'MIT',requestQuote:'优先 MIT 许可'},
  {id:'c4',label:'可用工具而非纯资料集合',requirement:'must',kind:'documented',op:'supports',value:'提供实现，非纯资料合集',requestQuote:'排除纯资料合集'}
 ];
 p.queries[0].query='css selector generator';return p;
}
test('complete planner format example is executable and browser-selector conditions keep MIT as preference',()=>{
 assert.deepEqual(bindSearchPlan(SEARCH_PLAN_FORMAT_EXAMPLE,'找支持本地工作流的项目'),SEARCH_PLAN_FORMAT_EXAMPLE);
 assert.ok(SEARCH_PLAN_PROMPT.includes(JSON.stringify(SEARCH_PLAN_FORMAT_EXAMPLE)));
 const p=bindSearchPlan(JSON.stringify(selectorPlan()),request);
 assert.equal(p.criteria.length,4);assert.equal(p.queries[0].filters.license,null);
 p.queries[0].filters.license='mit';
 assert.throws(()=>bindSearchPlan(p,request),{code:'AGENT_GITHUB_SEARCH_UNJUSTIFIED_FILTER'});
});
test('shape failures name a safe schema location without echoing the model response',()=>{
 for(const [mutate,field]of [
  [p=>{p.criteria[0].value=123;},'$.criteria[0].value'],
  [p=>{p.criteria[0].requirement='required';},'$.criteria[0].requirement'],
  [p=>{delete p.criteria[0].requestQuote;},'$.criteria[0]'],
  [p=>{p.criteria[0].kind='browser';},'$.criteria[0].kind'],
  [p=>{p.secretModelText='do-not-record-test-text';},'$']
 ]){
  const p=selectorPlan();mutate(p);
  assert.throws(()=>validateSearchPlan(p),e=>e.code==='AGENT_GITHUB_SEARCH_PLAN_INVALID'&&e.field===field&&!e.message.includes('do-not-record-test-text'));
 }
});
test('clarification retains conditions, while unbound quotes and incomplete query filters remain rejected',()=>{
 const p=selectorPlan();p.clarification='是否需要兼容旧版浏览器？';p.queries=[];
 assert.equal(bindSearchPlan(p,request).queries.length,0);
 const unbound=selectorPlan();unbound.criteria[0].requestQuote='用户没有提出的条件';
 assert.throws(()=>bindSearchPlan(unbound,request),{code:'AGENT_GITHUB_SEARCH_CONDITION_UNBOUND'});
 const incomplete=selectorPlan();delete incomplete.queries[0].filters.license;
 assert.throws(()=>validateSearchPlan(incomplete));
});
test('non-selector needs remain represented: offline platform, stars and release date',()=>{
 const p=structuredClone(SEARCH_PLAN_FORMAT_EXAMPLE);
 const req='需要Windows离线工作流，至少100星，2026-11-01后发布';
 p.criteria=[
  {id:'c1',label:'Windows离线',requirement:'must',kind:'documented',op:'supports',value:'Windows离线运行',requestQuote:'Windows离线工作流'},
  {id:'c2',label:'至少100星',requirement:'must',kind:'stars',op:'gte',value:'100',requestQuote:'至少100星'},
  {id:'c3',label:'正式Release时间',requirement:'must',kind:'released',op:'gte',value:'2026-11-01',requestQuote:'2026-11-01后发布'}
 ];
 p.queries[0].minStars=100;assert.equal(bindSearchPlan(p,req).criteria.length,3);
});
