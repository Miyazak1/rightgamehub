import {createCoursewareEmbedGatewayV2} from '/sdk/gateway-v2.mjs';

const samples={
  'concept-explorer':{workId:'11111111-1111-4111-8111-111111111111',releaseId:'21111111-1111-4111-8111-111111111111',objectiveIds:['shape-from-a'],requiredCheckpointIds:['predict-opening']},
  'causal-simulation':{workId:'12222222-2222-4222-8222-222222222222',releaseId:'22222222-2222-4222-8222-222222222223',objectiveIds:['relate-force-mass-acceleration'],requiredCheckpointIds:['predict-double-mass']},
  'algorithm-stepper':{workId:'13333333-3333-4333-8333-333333333333',releaseId:'23333333-3333-4333-8333-333333333333',objectiveIds:['trace-insertion-sort'],requiredCheckpointIds:['identify-prefix']},
};
const key=location.pathname.split('/').filter(Boolean).at(-1),sample=samples[key],frame=document.querySelector('#courseware');
if(!sample){frame.remove();const message=document.createElement('p');message.className='unavailable';message.textContent='课件样本不可用。';document.body.append(message);}
else{
  frame.src=`/templates/${key}/dist/index.html`;
  createCoursewareEmbedGatewayV2({coursewareFrame:frame,descriptor:{...sample,sceneId:key==='concept-explorer'?'explore-a':key==='causal-simulation'?'run-force-trials':'control-equilibrium',locales:['zh-CN','en'],capabilities:['learningProgress','learningEvents','assessmentResult'],sourcePolicy:{mode:'public-https'}},objectiveIds:sample.objectiveIds,requiredCheckpointIds:sample.requiredCheckpointIds,allowLoopback:true});
}
