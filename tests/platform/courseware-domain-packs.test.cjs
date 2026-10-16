const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);
const integrity=`sha256:${'b'.repeat(64)}`;
const moduleManifest=(id,kind,entry,capabilities,commands,dependencies=[])=>({ format:'mooyu.courseware-module',schemaVersion:1,id,version:'1.0.0',kind,apiVersion:1,entry,integrity,hotSwap:kind==='instrument'||kind==='component'?'live':'paused',stateSchemaVersion:1,capabilities,commands,dependencies });

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

test('measurement Instrument Pack reads only its declared Domain dependency', async () => {
  const [runtime,{ default:domain },{ default:instrument }]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/math/quadratic.mjs'),load('packages/courseware-domain-packs/src/instrument/measurement.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({ manifest:moduleManifest('math.quadratic','domain','./quadratic.mjs',['domain.function'],['coefficient.set','sample.set','reference.toggle','model.reset']),...domain });
  session.register({ manifest:moduleManifest('instrument.measurement','instrument','./measurement.mjs',['instrument.measurement'],['instrument.channel.set','measurement.record','comparison.select','measurement.clear'],[{ id:'math.quadratic',apiVersion:1,capabilities:['domain.function'] }]),...instrument });
  session.activate('instrument.measurement');
  assert.equal(session.observe('instrument.measurement',{ sourceQuery:{ kind:'curve' } }).live.points.length,81);
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

test('journey and embed modules keep host concerns optional and isolated', async () => {
  const [runtime,{default:journey},{default:embed}]=await Promise.all([load('packages/courseware-runtime/src/index.mjs'),load('packages/courseware-domain-packs/src/journey/progress.mjs'),load('packages/courseware-domain-packs/src/embed/bridge.mjs')]);
  const session=new runtime.CoursewareRuntime();
  session.register({manifest:moduleManifest('journey.progress','journey','./journey.mjs',['journey.progress'],['scene.complete','checkpoint.complete','progress.reset']),...journey});
  session.register({manifest:{...moduleManifest('embed.bridge','embed','./embed.mjs',['embed.bridge'],['embed.ready','embed.command.received','embed.state.exported']),hotSwap:'session'},...embed});
  session.activate(['journey.progress','embed.bridge']);
  session.dispatch('journey.progress','scene.complete',{id:'explore-a'});session.dispatch('journey.progress','checkpoint.complete',{id:'predict-opening'});session.dispatch('embed.bridge','embed.ready');
  assert.equal(session.observe('journey.progress').completed,true);assert.equal(session.observe('embed.bridge').ready,true);
});
