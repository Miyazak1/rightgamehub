import {createCoursewareEmbedGatewayV2} from '/sdk/gateway-v2.mjs';

const samples={
  'concept-explorer':{workId:'11111111-1111-4111-8111-111111111111',releaseId:'21111111-1111-4111-8111-111111111111',objectiveIds:['shape-from-a'],requiredCheckpointIds:['predict-opening']},
  'causal-simulation':{workId:'12222222-2222-4222-8222-222222222222',releaseId:'22222222-2222-4222-8222-222222222223',objectiveIds:['relate-force-mass-acceleration'],requiredCheckpointIds:['predict-double-mass']},
  'projectile-motion':{workId:'14444444-4444-4444-8444-444444444444',releaseId:'24444444-4444-4444-8444-444444444444',objectiveIds:['predict-projectile-trajectory'],requiredCheckpointIds:['predict-range-angle']},
  'algorithm-stepper':{workId:'13333333-3333-4333-8333-333333333333',releaseId:'23333333-3333-4333-8333-333333333333',objectiveIds:['trace-insertion-sort'],requiredCheckpointIds:['identify-prefix']},
  'kinematics-motion':{workId:'15555555-5555-4555-8555-555555555555',releaseId:'25555555-5555-4555-8555-555555555555',objectiveIds:['connect-motion-representations','predict-uniform-acceleration'],requiredCheckpointIds:['predict-vt-slope']},
  'derivative-optimization':{workId:'16666666-6666-4666-8666-666666666666',releaseId:'26666666-6666-4666-8666-666666666666',objectiveIds:['rate-to-derivative','derivative-to-shape','optimize-with-evidence'],requiredCheckpointIds:['predict-slope','match-sign-intervals','justify-optimum']},
};
const scenes={'concept-explorer':'explore-a','causal-simulation':'run-force-trials','projectile-motion':'launch-projectile','algorithm-stepper':'control-equilibrium','kinematics-motion':'link-motion-graphs','derivative-optimization':'secant-to-tangent'};
const key=location.pathname.split('/').filter(Boolean).at(-1),sample=samples[key],frame=document.querySelector('#courseware');
if(!sample){frame.remove();const message=document.createElement('p');message.className='unavailable';message.textContent='课件样本不可用。';document.body.append(message);}
else{
  frame.src=`/templates/${key}/dist/index.html`;
  createCoursewareEmbedGatewayV2({coursewareFrame:frame,descriptor:{...sample,sceneId:scenes[key],locales:['zh-CN','en'],capabilities:['learningProgress','learningEvents','assessmentResult'],sourcePolicy:{mode:'public-https'}},objectiveIds:sample.objectiveIds,requiredCheckpointIds:sample.requiredCheckpointIds,allowLoopback:true});
}
