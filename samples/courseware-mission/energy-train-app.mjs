import {CoursewareRuntime} from '/source/runtime/index.mjs';
import newton from '/source/domain/physics/newton-cart.mjs';
import energy from '/source/domain/physics/work-energy.mjs';
import braking from '/source/domain/physics/braking.mjs';
import {createMissionModule,evaluateLearningEvidence} from '/source/mission-engine/index.mjs';
import {createMissionWorkbench} from '/source/mission-workbench/index.mjs';
import {mission,bindings,evidenceModel} from '/mission/energy-train.mjs';
import {experience} from '/mission/energy-train-experience.mjs';

const integrity=`sha256:${'b'.repeat(64)}`;
const manifest=(id,kind,entry,capabilities,commands,dependencies=[])=>({format:'mooyu.courseware-module',schemaVersion:1,id,version:'1.0.0',kind,apiVersion:1,entry,integrity,hotSwap:kind==='component'||kind==='instrument'?'live':'paused',stateSchemaVersion:1,capabilities,commands,dependencies});
const runtime=new CoursewareRuntime({locale:'zh-CN',motion:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'system'});
runtime.register({manifest:manifest('physics.newton-cart','domain','./newton.mjs',['domain.motion'],['force.set','mass.set','simulation.run','simulation.pause','simulation.reset','simulation.step','measurement.record']),...newton});
runtime.register({manifest:manifest('physics.work-energy','domain','./energy.mjs',['domain.work-energy'],['mass.set','speed.set','height.set','friction.set','path-length.set','model.reset']),...energy});
runtime.register({manifest:manifest('physics.braking','domain','./braking.mjs',['domain.braking'],['speed.set','deceleration.set','runway.set','model.reset']),...braking});
const dependencies=[{id:'physics.newton-cart',apiVersion:1,capabilities:['domain.motion']},{id:'physics.work-energy',apiVersion:1,capabilities:['domain.work-energy']},{id:'physics.braking',apiVersion:1,capabilities:['domain.braking']}];
runtime.register({manifest:manifest('scenario.energy-train','scenario','./mission.mjs',['scenario.mission'],['mission.start','mission.act','mission.advance','mission.reset'],dependencies),...createMissionModule({mission,bindings})});
runtime.activate('scenario.energy-train');
runtime.dispatch('physics.newton-cart','force.set',{value:4});
runtime.dispatch('physics.newton-cart','mass.set',{value:2});
runtime.dispatch('physics.work-energy','speed.set',{value:7});
runtime.dispatch('physics.braking','deceleration.set',{value:1});

const workbench=createMissionWorkbench({root:document.querySelector('#mission-root'),runtime,missionModuleId:'scenario.energy-train',evidenceModel,evaluateEvidence:evaluateLearningEvidence,experience,locale:'zh-CN'});
globalThis.mooyuMissionDemo=Object.freeze({runtime,workbench});
