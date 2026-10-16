import {
  COURSEWARE_EMBED_MAX_MESSAGES_PER_SECOND, createEmbedEnvelope, isAllowedParentOrigin, parseEmbedEnvelope,
} from './protocol.mjs';

const learningTypes = new Set(['ready','learning.event','learning.progress','assessment.result']);
const safeIds = values => Array.isArray(values) ? values.filter(value => typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/u.test(value)).slice(0,100) : [];
const durationBucket = milliseconds => milliseconds < 60_000 ? 'under-1m' : milliseconds < 300_000 ? '1-5m' : milliseconds < 900_000 ? '5-15m' : milliseconds < 1_800_000 ? '15-30m' : 'over-30m';

export function isLearningMessage(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && value.protocol === 'mooyu.learning.v1' && value.direction === 'courseware-to-host'
    && learningTypes.has(value.type) && value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload));
}

export function translateLearningMessage(message, state) {
  if (!isLearningMessage(message)) return [];
  const result=[]; const startedAt=state.startedAt ?? new Date().toISOString();
  const start = () => { if (!state.startedAt) { state.startedAt=startedAt; result.push({name:'courseware.started',payload:{startedAt}}); } };
  if (message.type === 'ready') {
    state.ready=true;
    const sceneId=message.payload.sceneId;
    result.push({name:'courseware.ready',payload:{workId:state.workId,releaseId:state.releaseId,locale:state.locale,capabilities:state.capabilities}});
    if (typeof sceneId === 'string') result.push({name:'scene.entered',payload:{sceneId}});
    return result;
  }
  if (message.type === 'learning.event') {
    if (!state.ready) return result;
    start();
    if (message.payload.name === 'scene.entered' && typeof message.payload.sceneId === 'string') result.push({name:'scene.entered',payload:{sceneId:message.payload.sceneId}});
    if (message.payload.name === 'checkpoint.attempted' && typeof message.payload.checkpointId === 'string') result.push({name:'checkpoint.attempted',payload:{checkpointId:message.payload.checkpointId,attempt:1,outcome:'skipped'}});
    return result;
  }
  if (message.type === 'assessment.result') {
    start(); const checkpointId=message.payload.checkpointId;
    if (typeof checkpointId === 'string' && Number.isInteger(message.payload.attempt) && message.payload.attempt >= 1) {
      state.attempted += 1; if (message.payload.correct === true) state.correct += 1;
      result.push({name:'checkpoint.attempted',payload:{checkpointId,attempt:message.payload.attempt,outcome:message.payload.correct === true ? 'correct' : 'incorrect'}});
    }
    return result;
  }
  start();
  state.completedSceneIds = safeIds(message.payload.completedSceneIds);
  state.completedCheckpointIds = safeIds(message.payload.completedCheckpointIds);
  const complete = state.requiredCheckpointIds.every(id => state.completedCheckpointIds.includes(id)) && state.completedSceneIds.length > 0;
  if (complete && !state.completed) {
    state.completed=true; state.completedObjectiveIds=[...state.objectiveIds]; const completedAt=new Date().toISOString();
    for (const objectiveId of state.completedObjectiveIds) result.push({name:'objective.completed',payload:{objectiveId,completedAt}});
    result.push({name:'courseware.completed',payload:{objectiveIds:state.completedObjectiveIds,checkpointSummary:{attempted:state.attempted,correct:state.correct},durationBucket:durationBucket(Date.now()-Date.parse(state.startedAt))}});
  }
  return result;
}

export function createCoursewareEmbedGateway({
  windowImpl = globalThis.window, coursewareFrame, descriptor, objectiveIds = [], requiredCheckpointIds = [],
  allowLoopback = false, MessagePortRate = COURSEWARE_EMBED_MAX_MESSAGES_PER_SECOND, logger = console,
} = {}) {
  if (!windowImpl?.addEventListener || !coursewareFrame?.contentWindow || !descriptor?.workId || !descriptor?.releaseId) throw new TypeError('A window, courseware frame and descriptor are required.');
  const state={workId:descriptor.workId,releaseId:descriptor.releaseId,locale:descriptor.locales?.[0] ?? 'zh-CN',capabilities:descriptor.capabilities ?? [],objectiveIds:safeIds(objectiveIds),requiredCheckpointIds:safeIds(requiredCheckpointIds),completedObjectiveIds:[],completedSceneIds:[],completedCheckpointIds:[],attempted:0,correct:0,startedAt:null,completed:false,ready:false};
  let port=null; let closed=false; let sent=[]; let received=[]; let cached=[];
  const post = (name,payload) => {
    if (!port) { cached.push({name,payload}); if (cached.length > 32) cached.shift(); return; }
    const now=Date.now(); sent=sent.filter(value=>now-value<1000);
    if (sent.length >= MessagePortRate) { try { port.postMessage(createEmbedEnvelope('error','EMBED_RATE_LIMITED',{recoverable:false})); } finally { port.close?.(); port=null; } return; }
    sent.push(now); port.postMessage(createEmbedEnvelope('event',name,payload));
  };
  const sendError = (id,name,recoverable=false) => port?.postMessage(createEmbedEnvelope('error',name,{recoverable},id));
  const onPortMessage = event => {
    const receivedAt=Date.now();received=received.filter(value=>receivedAt-value<1000);
    if(received.length>=MessagePortRate){sendError(globalThis.crypto.randomUUID(),'EMBED_RATE_LIMITED');port?.close?.();port=null;return;}
    received.push(receivedAt);
    let command;
    try { command=parseEmbedEnvelope(event.data,{types:['command']}); } catch { sendError(globalThis.crypto.randomUUID(),'EMBED_MESSAGE_INVALID'); return; }
    const legacy = name => coursewareFrame.contentWindow.postMessage({protocol:'mooyu.learning.v1',direction:'host-to-courseware',type:'host.command',timestamp:new Date().toISOString(),requestId:command.id,payload:{name,value:command.payload}},windowImpl.location.origin);
    if (command.name === 'host.setLocale') { state.locale=command.payload.locale; legacy('locale.set'); }
    else if (command.name === 'host.setTheme') legacy('theme.set');
    else if (command.name === 'host.setMotion') legacy('motion.set');
    else if (command.name === 'host.pause') legacy('pause');
    else if (command.name === 'host.resume') legacy('resume');
    else if (command.name === 'host.restoreProgress') {
      if (command.payload.workId !== state.workId || command.payload.releaseId !== state.releaseId) { sendError(command.id,'EMBED_PROGRESS_INVALID'); return; }
      state.completedSceneIds=[...command.payload.completedSceneIds]; state.completedCheckpointIds=[...command.payload.completedCheckpointIds]; state.completedObjectiveIds=[...command.payload.completedObjectiveIds]; legacy('progress.restore');
    } else if (command.name === 'host.exportProgress') {
      port.postMessage(createEmbedEnvelope('response','host.exportProgress',{schemaVersion:1,workId:state.workId,releaseId:state.releaseId,completedSceneIds:state.completedSceneIds,completedCheckpointIds:state.completedCheckpointIds,completedObjectiveIds:state.completedObjectiveIds},command.id));
    } else sendError(command.id,'EMBED_COMMAND_UNSUPPORTED');
  };
  const onConnect = event => {
    if (closed || event.source !== windowImpl.parent || !event.ports?.[0]) return;
    let message;
    try { message=parseEmbedEnvelope(event.data,{types:['connect']}); } catch { return; }
    const policy=descriptor.sourcePolicy ?? {mode:'disabled'};
    const allowed=policy.mode !== 'disabled' && isAllowedParentOrigin(event.origin,{allowLoopback,allowlist:policy.mode === 'allowlist' ? policy.origins : null});
    if (!allowed) { event.ports[0].postMessage(createEmbedEnvelope('error','EMBED_ORIGIN_DENIED',{recoverable:false},message.id)); event.ports[0].close?.(); return; }
    port?.close?.(); port=event.ports[0]; port.addEventListener?.('message',onPortMessage); if (!port.addEventListener) port.onmessage=onPortMessage; port.start?.();
    port.postMessage(createEmbedEnvelope('connected','courseware.connected',{connectionId:globalThis.crypto.randomUUID(),nonce:message.payload.nonce}));
    for (const item of cached) post(item.name,item.payload); cached=[];
  };
  const onLearning = event => {
    if (closed || event.source !== coursewareFrame.contentWindow || event.origin !== windowImpl.location.origin || !isLearningMessage(event.data)) return;
    try { for (const item of translateLearningMessage(event.data,state)) post(item.name,item.payload); }
    catch { logger?.warn?.('Dropped invalid courseware learning event.'); }
  };
  const close=()=>{if(closed)return;closed=true;port?.close?.();port=null;windowImpl.removeEventListener('message',onConnect);windowImpl.removeEventListener('message',onLearning);};
  windowImpl.addEventListener('message',onConnect); windowImpl.addEventListener('message',onLearning);
  return Object.freeze({close,get state(){return {...state};}});
}
