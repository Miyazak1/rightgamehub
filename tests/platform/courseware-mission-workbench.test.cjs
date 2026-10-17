const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const load=relative=>import(pathToFileURL(path.join(root,relative)).href);

test('mission workbench derives route progress without deciding domain success',async()=>{
  const {deriveMissionViewModel}=await load('packages/courseware-mission-workbench/src/index.mjs');
  const definition={id:'demo',initialNodeId:'a',title:{'zh-CN':'综合任务'},nodes:[{id:'a',kind:'calculation',title:{'zh-CN':'计算'}},{id:'b',kind:'simulation',title:{'zh-CN':'验证'}},{id:'c',kind:'debrief',title:{'zh-CN':'复盘'}}]};
  const state={status:'running',activeNodeId:'b',completedNodeIds:['a'],clocks:{window:72},resources:{battery:60},evidence:[{claimId:'a'}],lastAction:{id:'commit-a',success:true}};
  const view=deriveMissionViewModel({definition,state,assessment:{mastered:false},locale:'zh-CN'});
  assert.equal(view.title,'综合任务');
  assert.equal(view.progress,.5);
  assert.deepEqual(view.nodes.map(node=>node.state),['complete','active','pending']);
  assert.deepEqual(view.clocks,{window:72});
  assert.equal(view.evidenceCount,1);
  assert.equal(view.mastered,false);
});

test('energy train experience stays declarative and maps every mission node',async()=>{
  const [sample,{experience}]=await Promise.all([load('samples/courseware-mission/energy-train.mjs'),load('samples/courseware-mission/energy-train-experience.mjs')]);
  assert.deepEqual(Object.keys(experience.stages),sample.mission.nodes.map(node=>node.id));
  assert.equal(experience.clockId,sample.mission.clocks[0].id);
  assert.equal(experience.resourceId,sample.mission.resources[0].id);
  for(const stage of Object.values(experience.stages)){
    assert.ok(stage.title['zh-CN']);
    assert.ok(stage.story['zh-CN']);
    assert.ok(stage.target['zh-CN']);
  }
});
