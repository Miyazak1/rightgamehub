const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

test('growth content copy keeps source truth and campaign attribution',async()=>{
  const {buildXhsDraft}=await import('../../packages/platform-client/src/growth-content-copy.mjs');
  const draft=buildXhsDraft({id:'work-123456789',title:'轨道秩序',kind:'game',description:'一个原子轨道解谜游戏。',estimatedMinutes:3,openSource:true,repositoryUrl:'https://github.com/example/orbit',licenseSpdx:'MIT',tags:['物理解谜']},{origin:'https://mooyu.fun',now:new Date('2026-10-12T04:00:00.000Z')});
  assert.match(draft.title,/开源/u);
  assert.match(draft.body,/源码：已公开（MIT）/u);
  assert.match(draft.body,/#物理解谜/u);
  assert.equal(draft.campaignKey,'xhs-20261012-work-123');
  assert.match(draft.url,/\/w\/work-123456789\?gh_src=campaign&gh_campaign=xhs-20261012-work-123$/u);
  const unknown=buildXhsDraft({id:'zip-work',title:'上传作品',kind:'game',description:'',tags:[]},{now:new Date('2026-10-12T04:00:00.000Z')});
  assert.doesNotMatch(unknown.body,/源码：已公开/u);
  assert.match(unknown.body,/来源与授权信息：见作品详情页/u);
});

test('admin integrates the five-slide studio without automated publishing',async()=>{
  const [app,studio]=await Promise.all([fs.readFile('packages/platform-client/src/App.jsx','utf8'),fs.readFile('packages/platform-client/src/GrowthContentStudio.jsx','utf8')]);
  assert.match(app,/<GrowthContentStudio api=\{api\} demo=\{demo\} demoWorks=\{demoWorks\}\/>/u);
  for(const slide of ['cover','overview','play','source','cta'])assert.match(studio,new RegExp(`'${slide}'`,'u'));
  assert.match(studio,/系统不会自动发布，也不会自动联系作者/u);
  assert.match(studio,/workXhsPromoUrl/u);
});
