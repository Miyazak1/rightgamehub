import { decodeChunk,GAME_TRANSFER_CHUNK_BYTES } from './transfer.mjs';

export const SAVE_MAX_DOCUMENT_BYTES=1048576;
export const SAVE_INLINE_BYTES=GAME_TRANSFER_CHUNK_BYTES;
export const saveFailure=(code,message,retryable=false)=>{throw Object.assign(new Error(message),{code,retryable});};
export const saveName=value=>typeof value==='string'&&/^[a-z0-9._-]{1,64}$/u.test(value)&&!value.startsWith('_gamehub.');
export const saveUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
export const saveEtag=value=>typeof value==='string'&&/^"[\x21\x23-\x7e]{1,180}"$/u.test(value);
export function saveFields(input,allowed) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))
    saveFailure('SAVE_REQUEST_INVALID','Save request contains invalid fields.');
}
export function saveResource(input,{slot=true,extra=[]}={}) {
  saveFields(input,['namespace',...(slot?['slot']:[]),...extra]);
  const namespace=input.namespace??'default';
  if(!saveName(namespace)||slot&&!saveName(input.slot))saveFailure('SAVE_REQUEST_INVALID','Invalid save namespace or slot.');
  return {namespace,...(slot?{slot:input.slot}:{})};
}
export function saveMutation(input,kind,{extra=[]}={}) {
  const fields=['expectedEtag','createOnly','idempotencyKey',...(kind==='restore'?['revisionId']:[]),...extra];
  const resource=saveResource(input,{extra:fields});
  if(!saveUuid(input.idempotencyKey))saveFailure('SAVE_REQUEST_INVALID','A UUID idempotency key is required.');
  if(input.createOnly!==undefined&&typeof input.createOnly!=='boolean')saveFailure('SAVE_REQUEST_INVALID','createOnly must be boolean.');
  const createOnly=input.createOnly===true;
  if(createOnly?kind!=='write'||input.expectedEtag!=null:!saveEtag(input.expectedEtag))
    saveFailure('SAVE_PRECONDITION_REQUIRED','Use an exact ETag or explicitly create a new slot.');
  if(kind==='restore'&&!saveUuid(input.revisionId))saveFailure('SAVE_REQUEST_INVALID','A history revision ID is required.');
  return {...resource,createOnly,expectedEtag:createOnly?null:input.expectedEtag,idempotencyKey:input.idempotencyKey,
    ...(kind==='restore'?{revisionId:input.revisionId}:{})};
}
export function saveUpload(input,inline=false) {
  const mutation=saveMutation(input,'write',{extra:['schemaVersion','contentType','encoding','sha256',inline?'chunk':'totalBytes']});
  if(!Number.isInteger(input.schemaVersion)||input.schemaVersion<1||input.schemaVersion>2147483647)
    saveFailure('SAVE_SCHEMA_UNSUPPORTED','Invalid save schema version.');
  const contentType=input.contentType??'application/json';
  if(!['application/json','application/octet-stream'].includes(contentType)||(input.encoding??'identity')!=='identity')
    saveFailure('SAVE_CONTENT_INVALID','Unsupported save type or encoding.');
  if(!/^[a-f0-9]{64}$/u.test(input.sha256??''))saveFailure('SAVE_CONTENT_INVALID','A SHA-256 digest is required.');
  const bytes=inline?decodeChunk(input.chunk):null,totalBytes=inline?bytes.length:input.totalBytes;
  if(!Number.isSafeInteger(totalBytes)||totalBytes<0||totalBytes>SAVE_MAX_DOCUMENT_BYTES)
    saveFailure('SAVE_DOCUMENT_TOO_LARGE','Save document exceeds the hard limit.');
  return {...mutation,schemaVersion:input.schemaVersion,contentType,encoding:'identity',sha256:input.sha256,totalBytes,...(inline?{bytes}:{})};
}
export function saveTransferInput(input,chunk=false,read=false) {
  saveFields(input,['transferId',...(chunk||read?['index']:[]),...(chunk?['chunk']:[])]);
  if(!saveUuid(input.transferId)||(chunk||read)&&(!Number.isSafeInteger(input.index)||input.index<0))
    saveFailure('SAVE_REQUEST_INVALID','Invalid transfer cursor.');
  return input;
}
export function saveConflictDetails(error) {
  if(error?.code!=='SAVE_CONFLICT')return undefined;
  const input=error.details??{},result={};
  if(input.expectedEtag===null||saveEtag(input.expectedEtag))result.expectedEtag=input.expectedEtag;
  if(input.currentRevision===null||typeof input.currentRevision==='string'&&/^[1-9][0-9]{0,18}$/u.test(input.currentRevision))result.currentRevision=input.currentRevision;
  if(input.currentUpdatedAt===null||typeof input.currentUpdatedAt==='string'&&input.currentUpdatedAt.length<=40&&Number.isFinite(Date.parse(input.currentUpdatedAt)))result.currentUpdatedAt=input.currentUpdatedAt;
  return result;
}
