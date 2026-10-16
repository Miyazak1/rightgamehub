export const COURSEWARE_EMBED_V2_PROTOCOL = 'mooyu.courseware.embed.v2';
export const COURSEWARE_EMBED_V2_VERSION = 2;
export const COURSEWARE_EMBED_V2_MAX_BYTES = 64 * 1024;
export const COURSEWARE_EMBED_V2_MAX_MESSAGES_PER_SECOND = 20;

export const COURSEWARE_EMBED_V2_EVENTS = Object.freeze([
  'courseware.ready', 'courseware.started', 'scene.entered', 'checkpoint.attempted',
  'objective.completed', 'courseware.completed', 'courseware.resized', 'courseware.error',
]);
export const COURSEWARE_EMBED_V2_COMMANDS = Object.freeze([
  'host.setLocale', 'host.setTheme', 'host.setMotion', 'host.pause', 'host.resume',
  'host.restoreProgress', 'host.exportProgress', 'host.setExperience', 'host.restoreState', 'host.exportState',
]);
export const COURSEWARE_EMBED_V2_ERRORS = Object.freeze([
  'EMBED_MESSAGE_INVALID', 'EMBED_ORIGIN_DENIED', 'EMBED_RELEASE_UNAVAILABLE',
  'EMBED_RATE_LIMITED', 'EMBED_COMMAND_UNSUPPORTED', 'EMBED_PROGRESS_INVALID', 'EMBED_STATE_INVALID',
]);

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const idPattern=/^[a-z][a-z0-9._-]{0,63}$/u;
const noncePattern=/^[A-Za-z0-9_-]{16,128}$/u;
const localePattern=/^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const errorPattern=/^[A-Z][A-Z0-9_]{2,63}$/u;
const isObject=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const exactKeys=(value,keys)=>Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>key in value);
const exactPayload=(payload,keys)=>isObject(payload)&&exactKeys(payload,keys);
const ids=value=>Array.isArray(value)&&value.length<=100&&new Set(value).size===value.length&&value.every(item=>idPattern.test(item));
const scalar=value=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.length<=256);
const variables=value=>isObject(value)&&Object.keys(value).length<=64&&Object.entries(value).every(([key,item])=>idPattern.test(key)&&scalar(item));
const objects=value=>Array.isArray(value)&&value.length<=64&&value.every(item=>exactPayload(item,['id','type','x','y','properties'])&&idPattern.test(item.id)&&idPattern.test(item.type)&&Number.isFinite(item.x)&&Number.isFinite(item.y)&&variables(item.properties));

export function validEmbedV2Progress(payload){
  return exactPayload(payload,['schemaVersion','workId','releaseId','completedSceneIds','completedCheckpointIds','completedObjectiveIds'])
    && payload.schemaVersion===1&&uuidPattern.test(payload.workId)&&uuidPattern.test(payload.releaseId)
    && ids(payload.completedSceneIds)&&ids(payload.completedCheckpointIds)&&ids(payload.completedObjectiveIds);
}

export function validEmbedV2State(payload){
  return exactPayload(payload,['schemaVersion','workId','releaseId','sceneId','experienceMode','variables','objects','progress'])
    && payload.schemaVersion===1&&uuidPattern.test(payload.workId)&&uuidPattern.test(payload.releaseId)
    && idPattern.test(payload.sceneId)&&idPattern.test(payload.experienceMode)&&variables(payload.variables)&&objects(payload.objects)
    && validEmbedV2Progress(payload.progress)&&payload.progress.workId===payload.workId&&payload.progress.releaseId===payload.releaseId;
}

function validPayload(message){
  const {type,name,payload}=message;
  if(type==='connect')return name==='host.connect'&&exactPayload(payload,['nonce'])&&noncePattern.test(payload.nonce);
  if(type==='connected')return name==='courseware.connected'&&exactPayload(payload,['connectionId','nonce'])&&uuidPattern.test(payload.connectionId)&&noncePattern.test(payload.nonce);
  if(type==='error')return COURSEWARE_EMBED_V2_ERRORS.includes(name)&&exactPayload(payload,['recoverable'])&&typeof payload.recoverable==='boolean';
  if(type==='response')return (name==='host.exportProgress'&&validEmbedV2Progress(payload))||(name==='host.exportState'&&validEmbedV2State(payload));
  if(type==='event'){
    if(!COURSEWARE_EMBED_V2_EVENTS.includes(name))return false;
    if(name==='courseware.ready')return exactPayload(payload,['workId','releaseId','locale','capabilities'])&&uuidPattern.test(payload.workId)&&uuidPattern.test(payload.releaseId)&&localePattern.test(payload.locale)&&Array.isArray(payload.capabilities)&&payload.capabilities.length<=10&&new Set(payload.capabilities).size===payload.capabilities.length&&payload.capabilities.every(item=>['learningProgress','learningEvents','assessmentResult','fullscreen','fileExport','stateSnapshot','experienceMode'].includes(item));
    if(name==='courseware.started')return exactPayload(payload,['startedAt'])&&!Number.isNaN(Date.parse(payload.startedAt));
    if(name==='scene.entered')return exactPayload(payload,['sceneId'])&&idPattern.test(payload.sceneId);
    if(name==='checkpoint.attempted')return exactPayload(payload,['checkpointId','attempt','outcome'])&&idPattern.test(payload.checkpointId)&&Number.isInteger(payload.attempt)&&payload.attempt>=1&&payload.attempt<=10000&&['correct','incorrect','skipped'].includes(payload.outcome);
    if(name==='objective.completed')return exactPayload(payload,['objectiveId','completedAt'])&&idPattern.test(payload.objectiveId)&&!Number.isNaN(Date.parse(payload.completedAt));
    if(name==='courseware.completed')return exactPayload(payload,['objectiveIds','checkpointSummary','durationBucket'])&&ids(payload.objectiveIds)&&exactPayload(payload.checkpointSummary,['attempted','correct'])&&Number.isInteger(payload.checkpointSummary.attempted)&&payload.checkpointSummary.attempted>=0&&Number.isInteger(payload.checkpointSummary.correct)&&payload.checkpointSummary.correct>=0&&['under-1m','1-5m','5-15m','15-30m','over-30m','unknown'].includes(payload.durationBucket);
    if(name==='courseware.resized')return exactPayload(payload,['height','aspectRatio'])&&Number.isInteger(payload.height)&&payload.height>=200&&payload.height<=10000&&/^[1-9][0-9]{0,3}\/[1-9][0-9]{0,3}$/u.test(payload.aspectRatio);
    return name==='courseware.error'&&exactPayload(payload,['code','recoverable'])&&errorPattern.test(payload.code)&&typeof payload.recoverable==='boolean';
  }
  if(type!=='command'||!COURSEWARE_EMBED_V2_COMMANDS.includes(name))return false;
  if(name==='host.setLocale')return exactPayload(payload,['locale'])&&localePattern.test(payload.locale);
  if(name==='host.setTheme')return exactPayload(payload,['theme'])&&['light','dark','system'].includes(payload.theme);
  if(name==='host.setMotion')return exactPayload(payload,['motion'])&&['full','reduced','system'].includes(payload.motion);
  if(name==='host.setExperience')return exactPayload(payload,['modeId'])&&idPattern.test(payload.modeId);
  if(['host.pause','host.resume','host.exportProgress','host.exportState'].includes(name))return exactPayload(payload,[]);
  if(name==='host.restoreProgress')return validEmbedV2Progress(payload);
  return name==='host.restoreState'&&validEmbedV2State(payload);
}

export function parseEmbedV2Envelope(value,{types}={}){
  if(!isObject(value)||bytes(value)>COURSEWARE_EMBED_V2_MAX_BYTES)throw Object.assign(new Error('Embed v2 message is invalid or too large.'),{code:'EMBED_MESSAGE_INVALID'});
  if(!exactKeys(value,['protocol','version','type','id','name','payload'])||value.protocol!==COURSEWARE_EMBED_V2_PROTOCOL||value.version!==COURSEWARE_EMBED_V2_VERSION||!uuidPattern.test(value.id??'')||!isObject(value.payload))throw Object.assign(new Error('Embed v2 envelope is invalid.'),{code:'EMBED_MESSAGE_INVALID'});
  if(types&&!types.includes(value.type))throw Object.assign(new Error('Embed v2 message direction is invalid.'),{code:'EMBED_MESSAGE_INVALID'});
  if(!validPayload(value))throw Object.assign(new Error('Embed v2 payload is invalid.'),{code:'EMBED_MESSAGE_INVALID'});
  return value;
}

export function createEmbedV2Envelope(type,name,payload={},id=globalThis.crypto?.randomUUID?.()){
  return parseEmbedV2Envelope({protocol:COURSEWARE_EMBED_V2_PROTOCOL,version:COURSEWARE_EMBED_V2_VERSION,type,id,name,payload});
}
