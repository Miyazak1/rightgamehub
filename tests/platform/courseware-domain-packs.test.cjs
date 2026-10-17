const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const integrity=`sha256:${'b'.repeat(64)}`;
const moduleManifest=(id,kind,entry,capabilities,commands,dependencies=[])=>({ format:'mooyu.courseware-module',schemaVersion:1,id,version:'1.0.0',kind,apiVersion:1,entry,integrity,hotSwap:kind==='instrument'||kind==='component'?'live':'paused',stateSchemaVersion:1,capabilities,commands,dependencies });
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

test('math Domain Pack exposes deterministic quadratic geometry', async () => {
  const [runtime,{ default:implementation }]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/math/quadratic.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({ manifest:moduleManifest('math.quadratic','domain','./quadratic.mjs',['domain.function'],['coefficient.set','sample.set','reference.toggle','model.reset']),...implementation });
  session.activate('math.quadratic');
  session.dispatch('math.quadratic','coefficient.set',{ value:-2 });
  session.dispatch('math.quadratic','sample.set',{ x:3 });
  const reading=session.observe('math.quadratic',{ kind:'curve' });
  assert.equal(reading.opening,'down'); assert.equal(reading.width,'narrow'); assert.deepEqual(reading.sample,{ x:3,y:-18 }); assert.equal(reading.points.length,81);
});

test('physics Domain Pack supports free construction values and records controlled trials', async () => {
  const [runtime,{ default:implementation }]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/physics/newton-cart.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({ manifest:moduleManifest('physics.newton-cart','domain','./newton-cart.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...implementation });
  session.activate('physics.newton-cart');
  session.dispatch('physics.newton-cart','mass.set',{ value:4 }); session.dispatch('physics.newton-cart','force.set',{ value:8 });
  session.dispatch('physics.newton-cart','simulation.step',{ seconds:.25 }); session.dispatch('physics.newton-cart','measurement.record');
  const reading=session.observe('physics.newton-cart');
  assert.equal(reading.acceleration,2); assert.equal(reading.velocity,.5); assert.equal(reading.trials.length,1);
});

test('chemistry Domain Pack separates catalyst speed from equilibrium composition', async () => {
  const [runtime,{ default:implementation }]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/chemistry/equilibrium.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({ manifest:moduleManifest('chemistry.equilibrium','domain','./equilibrium.mjs',['domain.equilibrium'],['volume.set','temperature.set','catalyst.toggle','feed.set','simulation.run','simulation.pause','simulation.step','simulation.reset']),...implementation });
  session.activate('chemistry.equilibrium');
  const before=session.observe('chemistry.equilibrium');
  session.dispatch('chemistry.equilibrium','catalyst.toggle',{ active:true });
  const after=session.observe('chemistry.equilibrium');
  assert.deepEqual(after.composition,before.composition); assert.equal(after.constant,before.constant); assert.equal(after.catalyst,true);
});

test('projectile Domain Pack calculates a deterministic trajectory and obstacle clearance', async () => {
  const [runtime,{default:implementation}]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/physics/projectile.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('physics.projectile','domain','./projectile.mjs',['domain.projectile'],['speed.set','angle.set','gravity.set','target.set','obstacle.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...implementation});
  session.activate('physics.projectile');
  const initial=session.observe('physics.projectile');
  assert.ok(initial.range>27&&initial.range<31);assert.ok(initial.clearance>0);
  session.dispatch('physics.projectile','simulation.run');session.dispatch('physics.projectile','simulation.step',{seconds:.08});
  assert.ok(session.observe('physics.projectile').x>0);
  for(let index=0;index<14;index+=1)session.dispatch('physics.projectile','measurement.record');
  const recorded=session.observe('physics.projectile');
  assert.equal(recorded.trials.length,12);assert.equal(recorded.trials[0].id,3);assert.equal(recorded.trials.at(-1).id,14);assert.equal(recorded.trialSequence,14);
});

test('measurement Instrument Pack reads only its declared Domain dependency', async () => {
  const [runtime,{ default:domain },{ default:instrument }]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/math/quadratic.mjs'),load('packages/courseware-domain-packs/src/instrument/measurement.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({ manifest:moduleManifest('math.quadratic','domain','./quadratic.mjs',['domain.function'],['coefficient.set','sample.set','reference.toggle','model.reset']),...domain });
  session.register({ manifest:moduleManifest('instrument.measurement','instrument','./measurement.mjs',['instrument.measurement'],['instrument.channel.set','measurement.record','comparison.select','measurement.clear'],[{ id:'math.quadratic',apiVersion:1,capabilities:['domain.function'] }]),...instrument });
  session.activate('instrument.measurement');
  assert.equal(session.observe('instrument.measurement',{ sourceQuery:{ kind:'curve' } }).live.points.length,81);
});

test('workbench component discovers modes and synchronizes DOM, runtime and learning events', async () => {
  const [runtime,workbench]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/component/workbench.mjs')]);
  const button=dataset=>({dataset,attributes:{},listeners:new Map(),setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,listener){this.listeners.set(name,listener);},removeEventListener(name){this.listeners.delete(name);},click(){this.listeners.get('click')?.();}});
  const experienceButtons=[button({experienceMode:'textbook'}),button({experienceMode:'sandbox'}),button({experienceMode:'target'})];
  const viewButtons=[button({mode:'explore'}),button({mode:'model'}),button({mode:'analyse'})];
  const rootElement={dataset:{experience:'textbook',mode:'explore'},querySelectorAll(selector){return selector==='[data-experience-mode]'?experienceButtons:selector==='[data-mode]'?viewButtons:[];}};
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:{...moduleManifest('component.workbench','component','./workbench.mjs',['component.workbench','component.workbench.modes'],['capabilities.configure','experience.set','panel.set','locale.set','motion.set']),version:'1.1.0',stateSchemaVersion:2},...workbench.default});
  session.activate('component.workbench');
  const events=[];
  const controller=workbench.createWorkbenchController({root:rootElement,sceneId:'explore-a',getRuntime:()=>session,emit:(name,data)=>events.push({name,data})});
  controller.bind();controller.connectRuntime();experienceButtons[1].click();viewButtons[2].click();
  assert.deepEqual(controller.capabilities.experienceModes,['textbook','sandbox','target']);
  assert.deepEqual(controller.capabilities.viewModes,['explore','model','analyse']);
  assert.equal(rootElement.dataset.experience,'sandbox');assert.equal(rootElement.dataset.mode,'analyse');
  assert.equal(experienceButtons[1].attributes['aria-pressed'],'true');assert.equal(viewButtons[2].attributes['aria-pressed'],'true');
  assert.deepEqual(session.observe('component.workbench'),{experience:'sandbox',panel:'analyse',locale:'zh-CN',motion:'system',capabilities:{experienceModes:['textbook','sandbox','target'],viewModes:['explore','model','analyse']}});
  assert.deepEqual(events.map(event=>event.name),['experience.mode.changed','view.mode.changed']);
  controller.destroy();assert.equal(experienceButtons[0].listeners.size,0);assert.equal(viewButtons[0].listeners.size,0);
});

test('scenario challenges evaluate authoritative Domain state instead of UI labels', async () => {
  const [runtime,{default:math},{default:mathChallenge},{default:physics},{default:physicsChallenge}]=await Promise.all([
    load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/math/quadratic.mjs'),load('packages/courseware-domain-packs/src/challenge/quadratic-target.mjs'),
    load('packages/courseware-domain-packs/src/physics/newton-cart.mjs'),load('packages/courseware-domain-packs/src/challenge/supply-cart.mjs'),
  ]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('math.quadratic','domain','./quadratic.mjs',['domain.function'],['coefficient.set','sample.set','reference.toggle','model.reset']),...math});
  session.register({manifest:moduleManifest('challenge.quadratic-target','challenge','./target.mjs',['challenge.evaluate'],['challenge.attempt','challenge.reset'],[{id:'math.quadratic',apiVersion:1,capabilities:['domain.function']}]),...mathChallenge});
  session.register({manifest:moduleManifest('physics.newton-cart','domain','./cart.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...physics});
  session.register({manifest:moduleManifest('challenge.supply-cart','challenge','./supply.mjs',['challenge.evaluate'],['challenge.attempt','challenge.reset'],[{id:'physics.newton-cart',apiVersion:1,capabilities:['domain.motion']}]),...physicsChallenge});
  session.activate(['challenge.quadratic-target','challenge.supply-cart']);
  session.dispatch('math.quadratic','coefficient.set',{value:-2}); session.dispatch('challenge.quadratic-target','challenge.attempt');
  assert.equal(session.observe('challenge.quadratic-target').solved,true);
  session.dispatch('physics.newton-cart','mass.set',{value:4}); session.dispatch('physics.newton-cart','force.set',{value:9}); session.dispatch('challenge.supply-cart','challenge.attempt');
  const supply=session.observe('challenge.supply-cart'); assert.equal(supply.solved,true); assert.ok(supply.last.metrics.position>=6.5&&supply.last.metrics.position<=8.5);
});

test('projectile rescue challenge evaluates target range and obstacle clearance from domain state', async () => {
  const [runtime,{default:domain},{default:challenge}]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/physics/projectile.mjs'),load('packages/courseware-domain-packs/src/challenge/projectile-rescue.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('physics.projectile','domain','./projectile.mjs',['domain.projectile'],['speed.set','angle.set','gravity.set','target.set','obstacle.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record','model.restore']),...domain});
  session.register({manifest:moduleManifest('challenge.projectile-rescue','challenge','./challenge.mjs',['challenge.evaluate'],['challenge.attempt','challenge.reset','challenge.restore'],[{id:'physics.projectile',apiVersion:1,capabilities:['domain.projectile']}]),...challenge});
  session.activate('challenge.projectile-rescue');session.dispatch('challenge.projectile-rescue','challenge.attempt');
  const result=session.observe('challenge.projectile-rescue');assert.equal(result.solved,true);assert.equal(result.last.reason,'success');
  session.dispatch('challenge.projectile-rescue','challenge.reset');session.dispatch('physics.projectile','target.set',{value:45});
  for(let attempt=0;attempt<5;attempt+=1)session.dispatch('challenge.projectile-rescue','challenge.attempt');
  const exhausted=session.observe('challenge.projectile-rescue');assert.equal(exhausted.attempts,5);assert.equal(exhausted.solved,false);
  session.dispatch('challenge.projectile-rescue','challenge.attempt');assert.deepEqual(session.observe('challenge.projectile-rescue'),exhausted);
  const trial={id:7,speed:21,angle:43,range:36,maxHeight:8.7,clearance:.2};
  session.dispatch('physics.projectile','model.restore',{speed:21,angle:43,gravity:9.8,targetX:36,obstacleX:19,obstacleHeight:8.5,time:.4,trials:[trial],trialSequence:9});
  session.dispatch('challenge.projectile-rescue','challenge.restore',{attempts:3,solved:true,reason:'success',metrics:{...trial,targetX:36}});
  const restoredModel=session.observe('physics.projectile'),restoredChallenge=session.observe('challenge.projectile-rescue');
  assert.equal(restoredModel.obstacleHeight,8.5);assert.equal(restoredModel.trials[0].id,7);assert.equal(restoredModel.trialSequence,9);assert.equal(restoredModel.time,.4);
  session.dispatch('physics.projectile','measurement.record');assert.equal(session.observe('physics.projectile').trials.at(-1).id,10);
  assert.equal(restoredChallenge.attempts,3);assert.equal(restoredChallenge.solved,true);assert.equal(restoredChallenge.last.reason,'success');
});

test('derivative optimization challenge preserves exhaustion until reset', async () => {
  const [runtime,{default:domain},{default:challenge}]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('templates/courseware/derivative-optimization/modules/domain/index.mjs'),load('templates/courseware/derivative-optimization/modules/challenge/index.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('math.derivative','domain','./derivative.mjs',['domain.derivative'],['function.set','probe.set','delta.set','derivative.toggle','optimization.cut.set','model.reset']),...domain});
  session.register({manifest:moduleManifest('challenge.optimization-target','challenge','./challenge.mjs',['challenge.evaluate'],['challenge.attempt','challenge.reset'],[{id:'math.derivative',apiVersion:1,capabilities:['domain.derivative']}]),...challenge});
  session.activate('challenge.optimization-target');
  for(let attempt=0;attempt<4;attempt+=1)session.dispatch('challenge.optimization-target','challenge.attempt');
  const exhausted=session.observe('challenge.optimization-target');assert.equal(exhausted.attempts,4);assert.equal(exhausted.solved,false);
  session.dispatch('math.derivative','optimization.cut.set',{value:20/6});session.dispatch('challenge.optimization-target','challenge.attempt');
  assert.deepEqual(session.observe('challenge.optimization-target'),exhausted);
  session.dispatch('challenge.optimization-target','challenge.reset');assert.equal(session.observe('challenge.optimization-target').attempts,0);
});

test('every bounded reference challenge preserves exhaustion until reset', async () => {
  const modules=await Promise.all([
    load('packages/courseware-domain-packs/src/challenge/quadratic-target.mjs'),
    load('packages/courseware-domain-packs/src/challenge/supply-cart.mjs'),
    load('packages/courseware-domain-packs/src/challenge/safe-no2-batch.mjs'),
    load('templates/courseware/kinematics-motion/modules/challenge/index.mjs'),
  ]);
  const observations=[
    {coefficient:1},
    {mass:1,force:1,acceleration:1},
    {composition:{no2:0},concentrations:{no2:0},progress:0,temperature:298},
    {initialVelocity:0,acceleration:0},
  ];
  for(const [index,{default:challenge}] of modules.entries()){
    let state=challenge.createState(),context={dependencies:[{id:'domain'}],observe:()=>observations[index]};
    for(let attempt=0;attempt<state.maxAttempts;attempt+=1)state=challenge.reduce({state,command:{name:'challenge.attempt',payload:{}},context});
    const exhausted=structuredClone(state);assert.equal(exhausted.attempts,exhausted.maxAttempts);assert.equal(exhausted.solved,false);
    context={dependencies:[{id:'domain'}],observe:()=>{throw new Error('exhausted challenge must not read the domain');}};
    state=challenge.reduce({state,command:{name:'challenge.attempt',payload:{}},context});assert.deepEqual(state,exhausted);
    state=challenge.reduce({state,command:{name:'challenge.reset',payload:{}},context});assert.equal(state.attempts,0);
  }
});

test('journey and embed modules keep host concerns optional and isolated', async () => {
  const [runtime,{default:journey},{default:embed}]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/journey/progress.mjs'),load('packages/courseware-domain-packs/src/embed/bridge.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('journey.progress','journey','./journey.mjs',['journey.progress'],['scene.complete','checkpoint.complete','progress.reset']),...journey});
  session.register({manifest:{...moduleManifest('embed.bridge','embed','./embed.mjs',['embed.bridge'],['embed.ready','embed.command.received','embed.state.exported']),hotSwap:'session'},...embed});
  session.activate(['journey.progress','embed.bridge']);
  session.dispatch('journey.progress','scene.complete',{id:'explore-a'});session.dispatch('journey.progress','checkpoint.complete',{id:'predict-opening'});session.dispatch('embed.bridge','embed.ready');
  assert.equal(session.observe('journey.progress').completed,true);assert.equal(session.observe('embed.bridge').ready,true);
});

test('composite mission orchestrates three authoritative physics capabilities without duplicating formulas', async () => {
  const [runtime,missionEngine,{default:newton},{default:energy},{default:braking},sample]=await Promise.all([
    load('packages/courseware-runtime/src/index.mjs'),
    load('packages/courseware-mission-engine/src/index.mjs'),
    load('packages/courseware-domain-packs/src/physics/newton-cart.mjs'),
    load('packages/courseware-domain-packs/src/physics/work-energy.mjs'),
    load('packages/courseware-domain-packs/src/physics/braking.mjs'),
    load('samples/courseware-mission/energy-train.mjs'),
  ]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('physics.newton-cart','domain','./newton.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...newton});
  session.register({manifest:moduleManifest('physics.work-energy','domain','./energy.mjs',['domain.work-energy'],['mass.set','speed.set','height.set','friction.set','path-length.set','model.reset']),...energy});
  session.register({manifest:moduleManifest('physics.braking','domain','./braking.mjs',['domain.braking'],['speed.set','deceleration.set','runway.set','model.reset']),...braking});
  const dependencies=[
    {id:'physics.newton-cart',apiVersion:1,capabilities:['domain.motion']},
    {id:'physics.work-energy',apiVersion:1,capabilities:['domain.work-energy']},
    {id:'physics.braking',apiVersion:1,capabilities:['domain.braking']},
  ];
  const releaseDigest=`sha256:${'c'.repeat(64)}`;
  session.register({manifest:moduleManifest('scenario.energy-train','scenario','./mission.mjs',['scenario.mission'],['mission.start','mission.act','mission.advance','mission.reset'],dependencies),...missionEngine.createMissionModule({mission:sample.mission,bindings:sample.bindings,releaseDigest})});
  session.activate('scenario.energy-train');
  session.dispatch('physics.newton-cart','force.set',{value:4});
  session.dispatch('scenario.energy-train','mission.start');
  const branchPoint=session.snapshot();
  session.dispatch('physics.newton-cart','force.set',{value:8});
  session.restore(branchPoint);
  session.dispatch('physics.newton-cart','force.set',{value:6});
  assert.equal(session.observe('scenario.energy-train').activeNodeId,'accelerate');
  for(const actionId of ['commit-traction','commit-climb','commit-braking','complete-debrief']) session.dispatch('scenario.energy-train','mission.act',{actionId});
  const result=session.observe('scenario.energy-train');
  assert.equal(result.status,'succeeded');
  assert.equal(result.outcomeId,'route-complete');
  assert.deepEqual(result.completedNodeIds,['accelerate','climb','brake','debrief']);
  assert.deepEqual(result.clocks,{window:122});
  assert.deepEqual(result.resources,{battery:40});
  assert.deepEqual(result.evidence.map(item=>item.claimId),['newton.configure','energy.balance','braking.calculate','system.explain']);
  const assessment=missionEngine.evaluateLearningEvidence(sample.evidenceModel,result.evidence);
  assert.equal(assessment.mastered,true);
  assert.deepEqual(assessment.objectives.map(item=>item.id),['newton.second-law','mechanical-energy','uniform-deceleration']);
  assert.ok(result.metrics['traction.acceleration']>2.9);
  const replay=session.observe('scenario.energy-train',{kind:'replay'});
  assert.equal(replay.commands.length,6);
  assert.deepEqual(replay.commands.map(item=>item.sequence),[0,1,2,3,4,5]);
  assert.deepEqual(replay.commands.map(item=>item.moduleId),['scenario.energy-train','physics.newton-cart',...Array(4).fill('scenario.energy-train')]);
  assert.equal(replay.format,'mooyu.mission-replay');assert.equal(replay.schemaVersion,1);assert.equal(replay.releaseDigest,releaseDigest);
  assert.equal(replay.initialSnapshot.modules['scenario.energy-train'].state.status,'ready');
  assert.equal(replay.initialSnapshot.modules['physics.newton-cart'].state.force,4);
  assert.match(replay.finalStateDigest,/^sha256:[a-f0-9]{64}$/u);
  const {node,metrics,...authoritativeState}=result;
  assert.equal(replay.finalStateDigest,`sha256:${crypto.createHash('sha256').update(canonical(authoritativeState)).digest('hex')}`);
  const replayed=new runtime.CoursewareRuntime();
  replayed.register({manifest:moduleManifest('physics.newton-cart','domain','./newton.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...newton});
  replayed.register({manifest:moduleManifest('physics.work-energy','domain','./energy.mjs',['domain.work-energy'],['mass.set','speed.set','height.set','friction.set','path-length.set','model.reset']),...energy});
  replayed.register({manifest:moduleManifest('physics.braking','domain','./braking.mjs',['domain.braking'],['speed.set','deceleration.set','runway.set','model.reset']),...braking});
  replayed.register({manifest:moduleManifest('scenario.energy-train','scenario','./mission.mjs',['scenario.mission'],['mission.start','mission.act','mission.advance','mission.reset'],dependencies),...missionEngine.createMissionModule({mission:sample.mission,bindings:sample.bindings,releaseDigest})});
  replayed.activate('scenario.energy-train');replayed.restore(replay.initialSnapshot);
  for(const command of replay.commands)replayed.dispatch(command.moduleId,command.name,command.payload);
  const {node:replayedNode,metrics:replayedMetrics,...replayedState}=replayed.observe('scenario.energy-train');
  assert.equal(replay.finalStateDigest,`sha256:${crypto.createHash('sha256').update(canonical(replayedState)).digest('hex')}`);
});

test('mission pressure is deterministic state and failed attempts consume declared time and resources', async () => {
  const [runtime,missionEngine,{default:newton},{default:energy},{default:braking},sample]=await Promise.all([
    load('packages/courseware-runtime/src/index.mjs'),
    load('packages/courseware-mission-engine/src/index.mjs'),
    load('packages/courseware-domain-packs/src/physics/newton-cart.mjs'),
    load('packages/courseware-domain-packs/src/physics/work-energy.mjs'),
    load('packages/courseware-domain-packs/src/physics/braking.mjs'),
    load('samples/courseware-mission/energy-train.mjs'),
  ]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('physics.newton-cart','domain','./newton.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...newton});
  session.register({manifest:moduleManifest('physics.work-energy','domain','./energy.mjs',['domain.work-energy'],['mass.set','speed.set','height.set','friction.set','path-length.set','model.reset']),...energy});
  session.register({manifest:moduleManifest('physics.braking','domain','./braking.mjs',['domain.braking'],['speed.set','deceleration.set','runway.set','model.reset']),...braking});
  const releaseDigest=`sha256:${'d'.repeat(64)}`;
  session.register({manifest:moduleManifest('scenario.energy-train','scenario','./mission.mjs',['scenario.mission'],['mission.start','mission.act','mission.advance','mission.reset'],[
    {id:'physics.newton-cart',apiVersion:1,capabilities:['domain.motion']},{id:'physics.work-energy',apiVersion:1,capabilities:['domain.work-energy']},{id:'physics.braking',apiVersion:1,capabilities:['domain.braking']},
  ]),...missionEngine.createMissionModule({mission:sample.mission,bindings:sample.bindings,releaseDigest})});
  session.activate('scenario.energy-train');
  session.dispatch('physics.newton-cart','mass.set',{value:10});
  session.dispatch('scenario.energy-train','mission.start');
  for(let step=0;step<1001;step+=1)session.dispatch('scenario.energy-train','mission.advance',{amount:0});
  for(let attempt=0;attempt<7;attempt+=1) session.dispatch('scenario.energy-train','mission.act',{actionId:'commit-traction'});
  const result=session.observe('scenario.energy-train');
  assert.equal(result.status,'failed');
  assert.equal(result.outcomeId,'battery-empty');
  assert.equal(result.activeNodeId,'accelerate');
  assert.equal(result.clocks.window,54);
  assert.equal(result.resources.battery,0);
  assert.equal(result.evidence.length,0);
  const replay=session.observe('scenario.energy-train',{kind:'replay'});
  assert.equal(replay.commands.length,1009);
  assert.equal(replay.commands[0].name,'mission.start');
  assert.equal(replay.commands.at(-1).sequence,1008);
});

test('learning evidence requires an observed matching kind even at a zero threshold', async () => {
  const missionEngine=await load('packages/courseware-mission-engine/src/index.mjs');
  const model={
    format:'mooyu.learning-evidence-model',
    schemaVersion:1,
    objectiveIds:['objective'],
    claims:[{id:'claim',objectiveId:'objective',kind:'calculation',weight:1,minimumStrength:0,required:true}],
  };
  const empty=missionEngine.evaluateLearningEvidence(model,[]);
  assert.equal(empty.claims[0].observed,false);
  assert.equal(empty.claims[0].satisfied,false);
  assert.equal(empty.objectives[0].score,0);
  assert.equal(empty.mastered,false);
  const mismatched=missionEngine.evaluateLearningEvidence(model,[{claimId:'claim',kind:'prediction',strength:1}]);
  assert.equal(mismatched.claims[0].satisfied,false);
  assert.equal(mismatched.mastered,false);
  const partialModel={...model,claims:[{...model.claims[0],minimumStrength:.8}]};
  const partial=missionEngine.evaluateLearningEvidence(partialModel,[{claimId:'claim',kind:'calculation',strength:.4}]);
  assert.equal(partial.claims[0].observed,true);
  assert.equal(partial.claims[0].satisfied,false);
  assert.equal(partial.objectives[0].score,.5);
  assert.equal(partial.mastered,false);
  const matching=missionEngine.evaluateLearningEvidence(model,[{claimId:'claim',kind:'calculation',strength:0}]);
  assert.equal(matching.claims[0].observed,true);
  assert.equal(matching.claims[0].satisfied,true);
  assert.equal(matching.objectives[0].score,1);
  assert.equal(matching.mastered,true);
});
