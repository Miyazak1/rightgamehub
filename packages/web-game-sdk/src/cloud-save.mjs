import { encodeChunk,decodeChunk,sha256Hex,GAME_TRANSFER_CHUNK_BYTES } from './transfer.mjs';
import { saveResource,saveMutation,saveFailure,SAVE_INLINE_BYTES,SAVE_MAX_DOCUMENT_BYTES } from './cloud-save-protocol.mjs';

/** Online transport only. The caller retains an immutable operation for retry. */
export function createCloudSaveClient({request}) {
  let transferring=false;
  const payloadOperation=async action=>{
    if(transferring)saveFailure('SAVE_TRANSFER_BUSY','Another save read or write is active.',true);
    transferring=true;
    try{return await action();}finally{transferring=false;}
  };
  const abort=async cursor=>{
    if(cursor?.transferId)await request('cloudSave.transfer.abort',{transferId:cursor.transferId}).catch(()=>{});
  };
  const missingAsNull=async action=>{
    try{return await action();}catch(error){if(error.code==='SAVE_SLOT_NOT_FOUND')return null;throw error;}
  };
  return Object.freeze({
    getPolicy:(input={})=>request('cloudSave.policy.get',saveResource(input,{slot:false})),
    listSlots:(input={})=>request('cloudSave.slots.list',saveResource(input,{slot:false})),
    getMetadata:input=>missingAsNull(()=>request('cloudSave.slots.metadata',saveResource(input))),
    getSyncStatus:input=>request('cloudSave.sync.status',saveResource(input)),
    history:input=>{
      const resource=saveResource(input,{extra:['beforeRevision']});
      return request('cloudSave.slots.history',{...resource,...(input.beforeRevision!==undefined?{beforeRevision:input.beforeRevision}:{})});
    },
    delete:input=>request('cloudSave.slots.delete',saveMutation(input,'delete')),
    restore:input=>request('cloudSave.slots.restore',saveMutation(input,'restore')),
    write:async input=>{
      const command=saveMutation(input,'write',{extra:['data','schemaVersion','contentType']});
      const contentType=input.contentType??(input.data instanceof Uint8Array?'application/octet-stream':'application/json');
      let bytes;
      if(contentType==='application/json') {
        if(!input.data||typeof input.data!=='object'||Array.isArray(input.data))saveFailure('SAVE_CONTENT_INVALID','JSON saves require an object.');
        try {
          const encoded=JSON.stringify(input.data),value=JSON.parse(encoded);
          if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('object required');
          bytes=new TextEncoder().encode(encoded);
        } catch {saveFailure('SAVE_CONTENT_INVALID','Save data cannot be serialized as a JSON object.');}
      } else if(contentType==='application/octet-stream'&&input.data instanceof Uint8Array)bytes=input.data.slice();
      else saveFailure('SAVE_CONTENT_INVALID','Binary saves require a Uint8Array.');
      if(bytes.length>SAVE_MAX_DOCUMENT_BYTES)saveFailure('SAVE_DOCUMENT_TOO_LARGE','Save document exceeds the hard limit.');
      if(!Number.isInteger(input.schemaVersion)||input.schemaVersion<1||input.schemaVersion>2147483647)saveFailure('SAVE_SCHEMA_UNSUPPORTED','Invalid save schema version.');
      return payloadOperation(async()=>{
        const upload={...command,schemaVersion:input.schemaVersion,contentType,encoding:'identity',sha256:await sha256Hex(bytes)};
        if(bytes.length<=SAVE_INLINE_BYTES)return request('cloudSave.slots.write',{...upload,chunk:encodeChunk(bytes)});
        let cursor;
        try {
          cursor=await request('cloudSave.transfer.begin',{...upload,totalBytes:bytes.length});
          if(cursor.completed)return cursor.result;
          if(cursor.totalBytes!==bytes.length||cursor.chunkBytes!==GAME_TRANSFER_CHUNK_BYTES)
            saveFailure('SAVE_RESPONSE_INVALID','Invalid upload cursor.');
          for(let index=0;index<Math.ceil(bytes.length/GAME_TRANSFER_CHUNK_BYTES);index++)
            await request('cloudSave.transfer.append',{transferId:cursor.transferId,index,chunk:encodeChunk(bytes.subarray(index*GAME_TRANSFER_CHUNK_BYTES,(index+1)*GAME_TRANSFER_CHUNK_BYTES))});
          return await request('cloudSave.transfer.commit',{transferId:cursor.transferId});
        } finally {await abort(cursor);}
      });
    },
    read:input=>payloadOperation(()=>missingAsNull(async()=>{
      const resource=saveResource(input);let cursor;
      try {
        const result=await request('cloudSave.slots.read',resource);
        if(result.deleted){const {transfer,...meta}=result;return {...meta,data:null};}
        cursor=result.transfer;
        if(!cursor||!Number.isSafeInteger(cursor.totalBytes)||cursor.totalBytes<0||cursor.totalBytes>SAVE_MAX_DOCUMENT_BYTES
          ||cursor.totalBytes!==result.bytes||cursor.chunkBytes!==GAME_TRANSFER_CHUNK_BYTES||cursor.sha256!==result.sha256)
          saveFailure('SAVE_RESPONSE_INVALID','Invalid save download cursor.');
        const bytes=new Uint8Array(cursor.totalBytes),count=Math.ceil(bytes.length/GAME_TRANSFER_CHUNK_BYTES);
        for(let index=0;index<count;index++) {
          const part=await request('cloudSave.transfer.read',{transferId:cursor.transferId,index}),chunk=decodeChunk(part.chunk);
          const expected=Math.min(GAME_TRANSFER_CHUNK_BYTES,bytes.length-index*GAME_TRANSFER_CHUNK_BYTES);
          if(part.transferId!==cursor.transferId||part.index!==index||chunk.length!==expected||part.done!==(index===count-1))
            saveFailure('SAVE_RESPONSE_INVALID','Invalid save download chunk.');
          bytes.set(chunk,index*GAME_TRANSFER_CHUNK_BYTES);
        }
        if(await sha256Hex(bytes)!==result.sha256)saveFailure('SAVE_CONTENT_INVALID','Downloaded save digest does not match.');
        let data=bytes;
        if(result.contentType==='application/json') {
          try {
            data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
            if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('object required');
          } catch {saveFailure('SAVE_CONTENT_INVALID','Downloaded save is not a JSON object.');}
        } else if(result.contentType!=='application/octet-stream')saveFailure('SAVE_CONTENT_INVALID','Unsupported save content type.');
        const {transfer,...meta}=result;
        return {...meta,data};
      } finally {await abort(cursor);}
    })),
  });
}
