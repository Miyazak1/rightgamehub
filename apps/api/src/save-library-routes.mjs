import {schemas} from '@gamehub/contracts';
export function registerSaveLibraryRoutes(app,{service,requireAuth}) {
  app.register(async saves=>{
    saves.addHook('onRequest',async(request,reply)=>{
      reply.header('Cache-Control','private, no-store');reply.header('X-Content-Type-Options','nosniff');await requireAuth(request);
    });
    const base='/v1/me/save-library';
    saves.get(base,{schema:{querystring:schemas.SaveLibraryQuery}},async request=>({data:await service.list(request.actor,request.query)}));
    saves.get(base+'/:slotId/history',{schema:{params:schemas.SaveLibrarySlotParams,querystring:schemas.SaveLibraryHistoryQuery}},
      async request=>({data:await service.history(request.actor,{...request.params,...request.query})}));
    saves.get(base+'/:slotId/revisions/:revisionId/content',{schema:{params:schemas.SaveLibraryRevisionParams}},async(request,reply)=>{
      const result=await service.content(request.actor,{...request.params,expectedEtag:request.headers['if-match'],requestId:request.id});
      reply.header('ETag',result.metadata.etag);reply.header('X-Content-SHA256',result.metadata.sha256);
      reply.header('X-GameHub-Save-Schema',String(result.metadata.schemaVersion));reply.header('Content-Disposition','attachment; filename="save.bin"');
      return reply.type(result.metadata.contentType).send(result.bytes);
    });
    saves.post(base+'/:slotId/restore',{bodyLimit:1024,schema:{params:schemas.SaveLibrarySlotParams,body:schemas.RestoreGameSaveRequest}},async(request,reply)=>{
      const result=await service.restore(request.actor,{...request.params,...request.body,ifMatch:request.headers['if-match'],ifNoneMatch:request.headers['if-none-match'],idempotencyKey:request.headers['idempotency-key'],requestId:request.id});
      reply.header('ETag',result.etag);return {data:result};
    });
  });
}
