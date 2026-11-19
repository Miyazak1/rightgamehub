import {PARITY_METHODS as additions} from './parity-methods.mjs';
import {managementArgument} from './management-contract.mjs';
export const PARITY_METHODS=Object.freeze({...additions,
  listCreatorContributionTasks:['number?','task-options?'],listContributionTasks:['text?','number?','task-options?'],
  listResearchTopicCandidateEvaluationPredictions:['id','id','prediction-options?'],
  communityPost:['id','community-options?'],communityReview:['community-options?'],
  communitySave:['nullable-id','object','community-options'],communitySubmit:['post','community-options'],
  communityWithdraw:['post','boolean?'],communityDecide:['post','object','community-options'],
  communityReserve:['id','object','community-options'],communityImage:['id','community-options?'],
  communityUpload:['id','image-bytes'],uploadAvatar:['file'],uploadAdminAgentAvatar:['id','file'],uploadMultiplayerRulePackage:['id','file','text'],
  trackAnalytics:['array'],listSaveLibrary:['id?'],getSaveLibraryHistory:['id','revision?'],
  readSaveLibraryRevision:['id','id','etag'],restoreSaveLibraryRevision:['id','save-input'],
  getGameSavePolicy:['save-scope'],listGameSaves:['save-scope'],getGameSaveMetadata:['save-scope'],
  readGameSave:['save-scope','etag'],getGameSaveWriteReceipt:['save-scope','save-input'],
  writeGameSave:['save-scope','save-input'],deleteGameSave:['save-scope','save-input'],
  listGameSaveHistory:['save-scope','revision?'],restoreGameSave:['save-scope','save-input'],
  getGuessBaikeLeaderboard:['text','text?'],listResearchTopicMethodTemplates:['id','text?'],
  getResearchTopicCandidateEvaluation:['id','nullable-id?'],
});
export const BLOB_RESULT_METHODS=Object.freeze(['communityImage','downloadAdminMultiplayerRulePackage','downloadAdminMultiplayerRuleBuild']);
export const FILE_OPERATIONS=Object.freeze({uploadWorkCover:1,uploadContent:1,uploadAvatar:0,uploadAdminAgentAvatar:1,uploadMultiplayerRulePackage:1});
export const GRANT_UPLOAD_METHODS=Object.freeze(['uploadContent','uploadMultiplayerRulePackage']);
const fail=()=>{throw Object.assign(Error('DESKTOP_BUSINESS_INPUT_INVALID'),{code:'DESKTOP_BUSINESS_INPUT_INVALID',status:400});};
const ownRecord=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(k=>!keys.includes(k)))fail();return value;};
function bytes(value,maximum){const result=value instanceof ArrayBuffer?new Uint8Array(value):value;if(!(result instanceof Uint8Array)||result.byteLength>maximum)fail();return result;}
export function parityArgument(kind,value){
  if(kind.endsWith('?')&&value===undefined)return undefined;kind=kind.replace('?','');
  if(kind==='nullable-id')return value===null?null:managementArgument('id',value);
  if(kind==='task-options'||kind==='prediction-options'){
    const input=ownRecord(value??{},kind==='task-options'?['offset','mine','projectId','standalone','signal']:['evaluationKey','limit','signal']);const result={};
    for(const key of ['offset','limit'])if(input[key]!==undefined)result[key]=managementArgument('number',input[key]);
    for(const key of ['mine','standalone'])if(input[key]!==undefined)result[key]=managementArgument('boolean',input[key]);
    for(const key of ['projectId','evaluationKey'])if(input[key]!==undefined)result[key]=managementArgument('id',input[key]);return result;
  }
  if(kind==='value'||kind==='array'){
    if(kind==='array'&&!Array.isArray(value))fail();return managementArgument('object',{value}).value;
  }
  if(kind==='community-options'){
    const input=ownRecord(value??{},['version','key','manage','cursor','preview','variant','signal']);const result={};
    for(const key of ['key','cursor','variant'])if(input[key]!==undefined)result[key]=managementArgument('text',input[key]);
    for(const key of ['manage','preview'])if(input[key]!==undefined)result[key]=managementArgument('boolean',input[key]);
    if(input.version!==undefined)result.version=managementArgument('revision',input.version);return result;
  }
  if(kind==='post'){
    if(!value||typeof value!=='object')fail();const out={id:managementArgument('id',value.id),version:managementArgument('revision',value.version)};
    if(value.revisionId!==undefined)out.revisionId=managementArgument('id',value.revisionId);return out;
  }
  if(kind==='image-bytes')return bytes(value,2097152);
  if(kind==='etag'){if(typeof value!=='string'||!value||value.length>300||/[\r\n\0]/u.test(value))fail();return value;}
  if(kind==='save-scope'){
    const input=ownRecord(value,['workId','releaseId','channel','namespace','slotKey','gameSessionId']);
    const out={workId:managementArgument('id',input.workId),namespace:managementArgument('id',input.namespace)};
    for(const key of ['releaseId','channel','slotKey','gameSessionId'])if(input[key]!==undefined)out[key]=managementArgument('id',input[key]);return out;
  }
  if(kind==='save-input'){
    const input=ownRecord(value,['bytes','sha256','contentType','schemaVersion','idempotencyKey','expectedEtag','createOnly','revisionId']);
    const {bytes:raw,...rest}=input;const result=managementArgument('object',rest);
    if(raw!==undefined)result.bytes=bytes(raw,1048576);
    if(result.expectedEtag!==undefined)parityArgument('etag',result.expectedEtag);
    for(const key of ['idempotencyKey','contentType','sha256'])if(result[key]!==undefined&&(/[\r\n\0]/u.test(String(result[key]))||typeof result[key]!=='string'))fail();
    return result;
  }
  return managementArgument(kind,value);
}
export function businessPayloadSize(value){
  const ancestors=new Set();
  const size=(item,depth=0)=>{
    if(depth>32)fail();
    if(item instanceof ArrayBuffer||item instanceof Uint8Array)return item.byteLength+64;
    if(item===undefined)return 4;
    if(item===null||['string','number','boolean'].includes(typeof item))return JSON.stringify(item).length;
    if(!item||typeof item!=='object'||ancestors.has(item))fail();ancestors.add(item);
    let count=2;
    if(Array.isArray(item)){for(const child of item)count+=size(child,depth+1)+1;}
    else for(const [key,child]of Object.entries(item))count+=JSON.stringify(key).length+size(child,depth+1)+2;
    ancestors.delete(item);return count;
  };return size(value);
}
