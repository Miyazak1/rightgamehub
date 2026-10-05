import { schemas } from '@gamehub/contracts';
import { GameSaveError,SAVE_LIMITS } from './game-save-service.mjs';

export function registerGameSaveRoutes(app,{service,requireAuth}) {
  app.register(async saves=>{
    saves.addHook('onRequest',async(request,reply)=>{
      reply.header('Cache-Control','private, no-store');
      reply.header('X-Content-Type-Options','nosniff');
      await requireAuth(request);
      if(request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')
        throw new GameSaveError('SAVE_CONTENT_INVALID',422,'Only identity content encoding is supported.');
    });
    saves.setErrorHandler((error,request,reply)=>{
      if(error.code==='FST_ERR_CTP_BODY_TOO_LARGE')throw new GameSaveError('SAVE_DOCUMENT_TOO_LARGE',413,'Save document exceeds the hard size limit.');
      throw error;
    });
    const headers={type:'object',required:['x-gamehub-session'],properties:{
      'x-gamehub-session':{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'},
    }};
    const query=schemas.GameSaveQuery;
    const params=schemas.GameSaveParams;
    const slotParams=schemas.GameSaveSlotParams;
    const base='/v1/me/game-saves/:workId/slots';
    const input=request=>({...request.params,...request.query});
    const call=(method,request,extra={})=>service[method](request.actor,request.headers['x-gamehub-session'],{...input(request),...extra});
    const cas=request=>({ifMatch:request.headers['if-match'],ifNoneMatch:request.headers['if-none-match'],idempotencyKey:request.headers['idempotency-key']});
    const respond=(reply,result)=>{if(result.etag)reply.header('ETag',result.etag);return {data:result};};
    saves.get('/v1/works/:workId/save-policy',{schema:{headers,params,querystring:query}},
      async(request,reply)=>respond(reply,await call('policy',request)));
    saves.get(base,{schema:{headers,params,querystring:query}},
      async(request,reply)=>respond(reply,await call('list',request)));
    saves.get(base+'/:slotKey/metadata',{schema:{headers,params:slotParams,querystring:query}},
      async(request,reply)=>respond(reply,await call('metadata',request)));
    saves.get(base+'/:slotKey/content',{schema:{headers,params:slotParams,querystring:query}},async(request,reply)=>{
      const result=await call('content',request,{expectedEtag:request.headers['if-match']});
      reply.header('ETag',result.metadata.etag);
      reply.header('X-Content-SHA256',result.metadata.sha256);
      reply.header('X-GameHub-Save-Schema',String(result.metadata.schemaVersion));
      reply.header('Content-Disposition','attachment; filename="save.bin"');
      return reply.type(result.metadata.contentType).send(result.bytes);
    });
    saves.get(base+'/:slotKey/history',{schema:{headers,params:slotParams,querystring:schemas.GameSaveHistoryQuery}},
      async(request,reply)=>respond(reply,await call('history',request)));
    saves.delete(base+'/:slotKey',{schema:{headers,params:slotParams,querystring:query}},
      async(request,reply)=>respond(reply,await call('delete',request,cas(request))));
    saves.post(base+'/:slotKey/write-receipt',{bodyLimit:1024,schema:{headers,params:slotParams,querystring:query,body:schemas.GameSaveWriteReceiptRequest}},
      async(request,reply)=>respond(reply,await call('writeReceipt',request,{...request.body,...cas(request)})));
    saves.post(base+'/:slotKey/restore',{bodyLimit:1024,schema:{headers,params:slotParams,querystring:query,body:schemas.RestoreGameSaveRequest}},
      async(request,reply)=>respond(reply,await call('restore',request,{...cas(request),revisionId:request.body.revisionId})));
    saves.register(async raw=>{
      raw.removeContentTypeParser(['application/json','application/octet-stream']);
      raw.addContentTypeParser(['application/json','application/octet-stream'],{parseAs:'buffer',bodyLimit:SAVE_LIMITS.documentBytes},
        (_request,body,done)=>done(null,body));
      raw.put(base+'/:slotKey',{bodyLimit:SAVE_LIMITS.documentBytes,schema:{headers,params:slotParams,querystring:query}},async(request,reply)=>{
        const type=request.headers['content-type'];
        if(!/^(application\/json|application\/octet-stream)(?:;\s*charset=utf-8)?$/iu.test(type??''))
          throw new GameSaveError('SAVE_CONTENT_INVALID',422,'Unsupported save content type or charset.');
        const schema=request.headers['x-gamehub-save-schema'];
        if(!/^[1-9][0-9]{0,9}$/u.test(schema??''))throw new GameSaveError('SAVE_SCHEMA_UNSUPPORTED',422,'A positive save schema header is required.');
        return respond(reply,await call('write',request,{...cas(request),bytes:request.body,
          schemaVersion:Number(schema),contentType:type.split(';')[0].toLowerCase(),sha256:request.headers['x-content-sha256'],
          contentEncoding:request.headers['content-encoding']??'identity'}));
      });
    });
  });
}
