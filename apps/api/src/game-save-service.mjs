import crypto from 'node:crypto';

export class GameSaveError extends Error {
  constructor(code,statusCode,message,details={},retryable=false) {
    super(message); this.name='GameSaveError'; Object.assign(this,{code,statusCode,details,retryable});
  }
}
export const SAVE_LIMITS=Object.freeze({documentBytes:1048576,liveBytes:1048576,historyBytes:5242880,slots:10});
export const saveHash=value=>crypto.createHash('sha256').update(value).digest();
export const saveName=value=>typeof value==='string'&&/^[a-z0-9._-]{1,64}$/u.test(value)&&!value.startsWith('_gamehub.');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const saveError=(code,status,message,details)=>{throw new GameSaveError(code,status,message,details);};
export function validateSavePayload(bytes,contentType,expectedHash) {
  if(!Buffer.isBuffer(bytes)||bytes.length>SAVE_LIMITS.documentBytes) saveError('SAVE_DOCUMENT_TOO_LARGE',413,'Save document exceeds the hard size limit.');
  if(!['application/json','application/octet-stream'].includes(contentType)) saveError('SAVE_CONTENT_INVALID',422,'Unsupported save content type.');
  const hash=saveHash(bytes).toString('hex');
  if(!/^[a-f0-9]{64}$/u.test(expectedHash??'')||hash!==expectedHash) saveError('SAVE_CONTENT_INVALID',422,'Save document digest does not match.');
  if(contentType==='application/json') {
    let parsed;
    try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
    catch {saveError('SAVE_CONTENT_INVALID',422,'Save document must be valid UTF-8 JSON.');}
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object') saveError('SAVE_CONTENT_INVALID',422,'JSON saves must contain an object.');
    // Iterative traversal bounds nesting without using the JavaScript call stack.
    const stack=[[parsed,1]];let nodes=0;
    while(stack.length) {
      const [value,depth]=stack.pop();
      if(depth>64||++nodes>100000) saveError('SAVE_CONTENT_INVALID',422,'Save document is too complex.');
      if(typeof value==='number'&&!Number.isFinite(value)) saveError('SAVE_CONTENT_INVALID',422,'JSON numbers must be finite.');
      if(value&&typeof value==='object')for(const child of Object.values(value))stack.push([child,depth+1]);
    }
  }
  return hash;
}
export function createGameSaveService({repository,gameSessionService,clock=()=>new Date()}) {
  const resource=input=>{
    if(!input||!uuid.test(input.workId??'')||!saveName(input.namespace)||input.slotKey!==undefined&&!saveName(input.slotKey))
      saveError('SCHEMA_INVALID',400,'Invalid save resource.');
  };
  const perform=(actor,token,input,action)=> {
    resource(input);
    return repository.transaction(async tx=>{
      // Authorization rows stay locked through commit, so revocation cannot race a save.
      const scope=await gameSessionService.resolve(actor,token,{workId:input.workId,namespace:input.namespace,capability:'cloudSave'},tx);
      return action(tx,scope);
    });
  };
  const mutate=async(actor,token,input,kind)=>{
    resource(input);
    if(!saveName(input.slotKey)||!uuid.test(input.idempotencyKey??''))saveError('SCHEMA_INVALID',400,'A slot and UUID idempotency key are required.');
    const createOnly=input.ifNoneMatch==='*';
    if(createOnly ? input.ifMatch!==undefined||kind!=='write' : input.ifNoneMatch!==undefined||typeof input.ifMatch!=='string'||!/^"[\x21\x23-\x7e]{1,180}"$/u.test(input.ifMatch))
      saveError('SAVE_PRECONDITION_REQUIRED',428,'Use one strong If-Match value, or If-None-Match: * for a new slot.');
    let payloadHash=null;
    if(kind==='write') {
      if(!Number.isInteger(input.schemaVersion)||input.schemaVersion<1||input.schemaVersion>2147483647)saveError('SAVE_SCHEMA_UNSUPPORTED',422,'Invalid save schema version.');
      if((input.contentEncoding??'identity')!=='identity')saveError('SAVE_CONTENT_INVALID',422,'Only identity content encoding is supported.');
      payloadHash=validateSavePayload(input.bytes,input.contentType,input.sha256);
    }
    if(kind==='restore'&&!uuid.test(input.revisionId??''))saveError('SCHEMA_INVALID',400,'A history revision ID is required.');
    // Bind every semantic field, including the CAS condition and operation type.
    const digest=saveHash(JSON.stringify([kind,createOnly?'*':input.ifMatch,
      kind==='write'?input.schemaVersion:null,kind==='write'?input.contentType:null,
      kind==='write'?'identity':null,payloadHash,kind==='restore'?input.revisionId:null]));
    const command={...input,kind,createOnly,payloadHash,requestDigest:digest,keyHash:saveHash(input.idempotencyKey.toLowerCase())};
    return perform(actor,token,input,(tx,scope)=>repository.mutate(tx,scope,command,clock()));
  };
  return Object.freeze({
    policy:(actor,token,input)=>perform(actor,token,input,(tx,scope)=>repository.policy(tx,scope,input.namespace)),
    list:(actor,token,input)=>perform(actor,token,input,(tx,scope)=>repository.list(tx,scope,input.namespace)),
    metadata:(actor,token,input)=>perform(actor,token,input,(tx,scope)=>repository.read(tx,scope,input,false)),
    content:(actor,token,input)=>perform(actor,token,input,(tx,scope)=>repository.read(tx,scope,input,true)),
    history:async(actor,token,input)=>{
      if(input.beforeRevision!==undefined&&(!/^[1-9][0-9]{0,18}$/u.test(input.beforeRevision)||BigInt(input.beforeRevision)>9223372036854775807n))saveError('SCHEMA_INVALID',400,'Invalid history cursor.');
      return perform(actor,token,input,(tx,scope)=>repository.history(tx,scope,input));
    },
    write:(actor,token,input)=>mutate(actor,token,input,'write'),
    delete:(actor,token,input)=>mutate(actor,token,input,'delete'),
    restore:(actor,token,input)=>mutate(actor,token,input,'restore'),
  });
}
