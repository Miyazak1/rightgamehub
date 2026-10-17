const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const moduleUrl=file=>pathToFileURL(path.join(root,file)).href;
const workId='11111111-1111-4111-8111-111111111111';
const releaseId='21111111-1111-4111-8111-111111111111';
const descriptor={schemaVersion:1,workId,releaseId,channel:'fixed',title:{'zh-CN':'二次函数形状探索',en:'Quadratic Shape Explorer'},embedUrl:`https://embed.mooyu.fun/v1/works/${workId}/releases/${releaseId}`,aspectRatio:'16/9',locales:['zh-CN','en'],capabilities:['learningProgress','learningEvents','assessmentResult'],releaseDigest:'a'.repeat(64),publishedAt:'2026-10-14T00:00:00.000Z',embedStatus:'public',sourcePolicy:{mode:'public-https'}};

test('Embed v1 freezes strict envelopes, event names and privacy-safe payloads',async()=>{
  const protocol=await import(moduleUrl('packages/courseware-embed-sdk/src/protocol.mjs'));
  const valid=protocol.createEmbedEnvelope('event','checkpoint.attempted',{checkpointId:'predict-opening',attempt:1,outcome:'correct'},'31111111-1111-4111-8111-111111111111');
  assert.equal(protocol.parseEmbedEnvelope(valid).name,'checkpoint.attempted');
  assert.throws(()=>protocol.parseEmbedEnvelope({...valid,answerText:'student text'}),{code:'EMBED_MESSAGE_INVALID'});
  assert.throws(()=>protocol.createEmbedEnvelope('event','checkpoint.attempted',{checkpointId:'predict-opening',attempt:1,outcome:'correct',answer:'private'}),{code:'EMBED_MESSAGE_INVALID'});
  assert.throws(()=>protocol.parseEmbedEnvelope({...valid,payload:{checkpointId:'predict-opening',attempt:1,outcome:'correct',padding:'x'.repeat(33*1024)}}),{code:'EMBED_MESSAGE_INVALID'});
  assert.deepEqual(protocol.COURSEWARE_EMBED_EVENTS,['courseware.ready','courseware.started','scene.entered','checkpoint.attempted','objective.completed','courseware.completed','courseware.resized','courseware.error']);
});

test('Embed v2 adds bounded state snapshots and experience control without changing v1',async()=>{
  const v1=await import(moduleUrl('packages/courseware-embed-sdk/src/protocol.mjs'));
  const v2=await import(moduleUrl('packages/courseware-embed-sdk/src/protocol-v2.mjs'));
  const progress={schemaVersion:1,workId,releaseId,completedSceneIds:['explore-a'],completedCheckpointIds:[],completedObjectiveIds:[]};
  const snapshot={schemaVersion:1,workId,releaseId,sceneId:'explore-a',experienceMode:'sandbox',variables:{coefficient:-2,'probe-x':2,'show-grid':true},objects:[],progress};
  const exported=v2.createEmbedV2Envelope('response','host.exportState',snapshot,'31111111-1111-4111-8111-111111111112');
  assert.equal(v2.parseEmbedV2Envelope(exported).payload.variables.coefficient,-2);
  assert.equal(v2.createEmbedV2Envelope('command','host.setExperience',{modeId:'target'},'31111111-1111-4111-8111-111111111113').version,2);
  assert.throws(()=>v2.createEmbedV2Envelope('response','host.exportState',{...snapshot,variables:{studentAnswer:'private'}},'31111111-1111-4111-8111-111111111114'),{code:'EMBED_MESSAGE_INVALID'});
  assert.throws(()=>v1.parseEmbedEnvelope(exported),{code:'EMBED_MESSAGE_INVALID'});
  assert.equal(v1.COURSEWARE_EMBED_PROTOCOL,'mooyu.courseware.embed.v1');
});

test('Embed release policy fixes releases, resolves current explicitly and fails closed',async()=>{
  const {resolveEmbedRelease}=await import(moduleUrl('packages/courseware-embed-sdk/src/policy.mjs'));
  assert.deepEqual(resolveEmbedRelease({descriptor,requestedReleaseId:releaseId,parentOrigin:'https://school.example'}),{workId,releaseId,releaseDigest:'a'.repeat(64),channel:'fixed'});
  assert.equal(resolveEmbedRelease({descriptor:{...descriptor,channel:'current'},parentOrigin:'https://school.example'}).channel,'current');
  assert.throws(()=>resolveEmbedRelease({descriptor,requestedReleaseId:'22222222-2222-4222-8222-222222222222',parentOrigin:'https://school.example'}),{code:'EMBED_RELEASE_UNAVAILABLE'});
  assert.throws(()=>resolveEmbedRelease({descriptor:{...descriptor,embedStatus:'revoked'},requestedReleaseId:releaseId,parentOrigin:'https://school.example'}),{code:'EMBED_RELEASE_UNAVAILABLE'});
  assert.throws(()=>resolveEmbedRelease({descriptor,parentOrigin:'http://school.example'}),{code:'EMBED_ORIGIN_DENIED'});
  assert.throws(()=>resolveEmbedRelease({descriptor:{...descriptor,sourcePolicy:{mode:'allowlist',origins:['https://allowed.example']}},parentOrigin:'https://school.example'}),{code:'EMBED_ORIGIN_DENIED'});
});

test('legacy learning messages are minimized before crossing the embed boundary',async()=>{
  const {translateLearningMessage}=await import(moduleUrl('packages/courseware-embed-sdk/src/gateway.mjs'));
  const state={workId,releaseId,locale:'zh-CN',capabilities:['learningEvents'],objectiveIds:['shape-from-a'],requiredCheckpointIds:['predict-opening'],completedObjectiveIds:[],completedSceneIds:[],completedCheckpointIds:[],attempted:0,correct:0,startedAt:null,completed:false,ready:true};
  const beforeReady={...state,ready:false};
  assert.deepEqual(translateLearningMessage({protocol:'mooyu.learning.v1',direction:'courseware-to-host',type:'learning.event',payload:{name:'interaction.changed',sceneId:'explore-a',data:{a:1}}},beforeReady),[]);
  const interaction=translateLearningMessage({protocol:'mooyu.learning.v1',direction:'courseware-to-host',type:'learning.event',payload:{name:'interaction.changed',sceneId:'explore-a',data:{answerText:'never relay',a:-2}}},state);
  assert.deepEqual(interaction.map(item=>item.name),['courseware.started']);
  assert.equal(JSON.stringify(interaction).includes('answerText'),false);
  const assessment=translateLearningMessage({protocol:'mooyu.learning.v1',direction:'courseware-to-host',type:'assessment.result',payload:{checkpointId:'predict-opening',correct:true,attempt:1,answerText:'down'}},state);
  assert.deepEqual(assessment,[{name:'checkpoint.attempted',payload:{checkpointId:'predict-opening',attempt:1,outcome:'correct'}}]);
  const completed=translateLearningMessage({protocol:'mooyu.learning.v1',direction:'courseware-to-host',type:'learning.progress',payload:{completedSceneIds:['explore-a'],completedCheckpointIds:['predict-opening']}},state);
  assert.deepEqual(completed.map(item=>item.name),['objective.completed','courseware.completed']);
  assert.equal(JSON.stringify(completed).includes('answerText'),false);
});

test('the three-origin acceptance server exposes every sample in two independent host containers with strict frame policy',async t=>{
  const {startCoursewareEmbedAcceptance}=await import(moduleUrl('scripts/start-courseware-embed-acceptance.mjs'));
  const server=await startCoursewareEmbedAcceptance({hostPort:0,secondaryHostPort:0,runtimePort:0});t.after(()=>server.close());
  assert.equal(server.hostOrigins.length,2);assert.equal(new Set([...server.hostOrigins,server.runtimeOrigin]).size,3);assert.equal(server.urls.length,12);
  for(const url of server.urls){const response=await fetch(url);assert.equal(response.status,200);const html=await response.text();assert.match(html,new RegExp(server.runtimeOrigin.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));assert.match(html,/data-courseware-frame/u);assert.match(response.headers.get('content-security-policy'),new RegExp(`frame-src ${server.runtimeOrigin.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}`,'u'));}
  const runtime=await fetch(`${server.runtimeOrigin}/runtime/concept-explorer`);assert.equal(runtime.status,200);for(const origin of server.hostOrigins)assert.match(runtime.headers.get('content-security-policy'),new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));
  const gatewayV2=await fetch(`${server.runtimeOrigin}/sdk/gateway-v2.mjs`);assert.equal(gatewayV2.status,200);assert.match(await gatewayV2.text(),/createCoursewareEmbedGatewayV2/u);
  const unchanged=await fetch(`${server.runtimeOrigin}/templates/concept-explorer/dist/index.html`);assert.equal(unchanged.status,200);assert.match(await unchanged.text(),/mooyu\.learning\.v1/u);assert.match(unchanged.headers.get('content-security-policy'),/script-src 'self' 'unsafe-inline'/u);
  const workbench=await fetch(`${server.runtimeOrigin}/templates/concept-explorer/modules/workbench/index.mjs`);assert.equal(workbench.status,200);assert.match(workbench.headers.get('content-type'),/text\/javascript/u);assert.match(await workbench.text(),/createWorkbenchController/u);
  const mission=await fetch(server.missionUrl);assert.equal(mission.status,200);assert.match(await mission.text(),/mission-root/u);assert.doesNotMatch(mission.headers.get('content-security-policy'),/unsafe-inline/u);
  const missionWorkbench=await fetch(`${server.hostOrigin}/source/mission-workbench/index.mjs`);assert.equal(missionWorkbench.status,200);assert.match(await missionWorkbench.text(),/createMissionWorkbench/u);
  const missionSample=await fetch(`${server.hostOrigin}/mission/energy-train.mjs`);assert.equal(missionSample.status,200);assert.match(await missionSample.text(),/physics\.energy-train/u);
});

test('Embed schemas and reference pages are strict, versioned and complete',async()=>{
  for(const file of ['embed-descriptor-v1.schema.json','embed-protocol-v1.schema.json','embed-protocol-v2.schema.json']){const schema=JSON.parse(await fs.readFile(path.join(root,'packages/contracts/courseware',file),'utf8'));assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');assert.match(schema.$id,/^https:\/\/mooyu\.fun\/schemas\/courseware\//u);}
  for(const name of ['concept-explorer','causal-simulation','projectile-motion','algorithm-stepper','kinematics-motion','derivative-optimization']){const html=await fs.readFile(path.join(root,'samples/courseware-embed',`${name}.html`),'utf8');assert.match(html,new RegExp(`/runtime/${name}`,'u'));assert.match(html,/reference-host\.mjs/u);assert.match(html,/data-state-action="export"/u);assert.match(html,/host\.setExperience/u);if(name==='algorithm-stepper'){assert.match(html,/化学平衡调控实验室/u);assert.doesNotMatch(html,/插入排序/u);}}
  const referenceHost=await fs.readFile(path.join(root,'samples/courseware-embed/reference-host.mjs'),'utf8');assert.match(referenceHost,/createCoursewareEmbedHostV2/u);assert.match(referenceHost,/host\.restoreState/u);
  const runtimeGateway=await fs.readFile(path.join(root,'samples/courseware-embed/runtime-gateway.mjs'),'utf8');assert.match(runtimeGateway,/createCoursewareEmbedGatewayV2/u);
  for(const name of ['concept-explorer','causal-simulation','projectile-motion','algorithm-stepper','kinematics-motion','derivative-optimization']){const html=await fs.readFile(path.join(root,'templates/courseware',name,'dist/index.html'),'utf8');assert.match(html,/state\.export/u);assert.match(html,/state\.restore/u);assert.match(html,/state\.snapshot/u);}
  for(const name of ['concept-explorer','causal-simulation','algorithm-stepper']){const html=await fs.readFile(path.join(root,'templates/courseware',name,'dist/index.html'),'utf8');assert.match(html,/connectStructuredRuntime\(\);/u,`${name} must connect when the runtime booted before its listener`);}
  const kinematics=await fs.readFile(path.join(root,'templates/courseware/kinematics-motion/dist/index.html'),'utf8');assert.match(kinematics,/connectRuntime\(\);/u);
  const projectile=await fs.readFile(path.join(root,'templates/courseware/projectile-motion/dist/index.html'),'utf8');
  assert.match(projectile,/runtime\.dispatch\('physics\.projectile','model\.restore'/u);
  assert.match(projectile,/runtime\.dispatch\('challenge\.projectile-rescue','challenge\.restore'/u);
  assert.match(projectile,/type:'projectile-trial'/u);
  assert.match(projectile,/'obstacle-height':reading\.obstacleHeight/u);
  assert.match(projectile,/attempt:answerAttempts/u);
  assert.match(projectile,/'answer-attempts':answerAttempts/u);
  const readme=await fs.readFile(path.join(root,'samples/courseware-embed/README.md'),'utf8');assert.match(readme,/答案原文/u);assert.match(readme,/Chrome、Edge、Firefox、Safari/u);
  const styles=await fs.readFile(path.join(root,'samples/courseware-embed/styles.css'),'utf8');assert.match(styles,/grid-template-rows:auto minmax\(0,1fr\) auto/u);assert.match(styles,/body\{[^}]*overflow:hidden/u);
  assert.doesNotMatch(styles,/iframe\{height:1120px\}|iframe\{height:1240px\}/u);assert.match(styles,/@media\(max-width:900px\)\{html,body\{height:100%;overflow:hidden\}/u);
});
