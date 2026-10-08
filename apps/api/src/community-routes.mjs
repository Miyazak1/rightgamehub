import { CommunityError } from './community-errors.mjs';
const params = name => ({type:'object',required:[name],additionalProperties:false,properties:{[name]:{type:'string',format:'uuid'}}});
const body = {type:'object',additionalProperties:false,required:['channel','title','blocks'],properties:{channel:{type:'string',enum:['game','ai','computing']},title:{type:'string',minLength:1,maxLength:120},blocks:{type:'array',minItems:1,maxItems:32,items:{type:'object'}}}};
export function registerCommunityRoutes(app,{service,media,requireAuth}) {
  app.addHook('onRequest',async(request,reply)=>{
    const pathname=request.url.split('?')[0];
    if(!pathname.startsWith('/v1/community/')&&!pathname.startsWith('/v1/admin/community/'))return;
    reply.header('Cache-Control','no-store');
    if(pathname!=='/v1/community/capabilities'&&!service.config.enabled)throw new CommunityError('COMMUNITY_DISABLED',503,'分享板块暂未开放。');
    if(pathname.includes('/media')&&request.method!=='GET'&&!service.config.imagesEnabled)throw new CommunityError('COMMUNITY_IMAGES_DISABLED',503,'图片上传暂未开放。');
  });
  const optionalAuth=async request=>{if(request.headers.authorization)await requireAuth(request);};
  const send=(reply,data)=>{if(data?.version)reply.header('ETag','"'+data.version+'"');return {data};};
  app.get('/v1/community/capabilities',{preHandler:optionalAuth},async request=>({data:await service.capabilities(request.actor)}));
  app.get('/v1/community/posts',{preHandler:optionalAuth,schema:{querystring:{type:'object',additionalProperties:false,properties:{channel:{type:'string',enum:['game','ai','computing']},author:{type:'string',format:'uuid'},cursor:{type:'string',maxLength:800}}}}},async request=>({data:await service.list(request.actor,request.query)}));
  for(const kind of ['posts','bookmarks'])app.get('/v1/community/me/'+kind,{preHandler:requireAuth,schema:{querystring:{type:'object',additionalProperties:false,properties:{cursor:{type:'string',maxLength:800}}}}},async request=>({data:await service.list(request.actor,{...request.query,kind:kind==='posts'?'mine':'bookmarks'})}));
  app.get('/v1/community/me/posts/:postId',{preHandler:requireAuth,schema:{params:params('postId')}},async(request,reply)=>send(reply,await service.get(request.actor,request.params.postId,{manage:true})));
  app.get('/v1/community/posts/:postId',{preHandler:optionalAuth,schema:{params:params('postId')}},async(request,reply)=>send(reply,await service.get(request.actor,request.params.postId)));
  app.post('/v1/community/posts',{preHandler:requireAuth,bodyLimit:32768,schema:{body}},async(request,reply)=>send(reply,await service.save(request.actor,null,request.body,null,request.headers['idempotency-key'])));
  app.patch('/v1/community/posts/:postId',{preHandler:requireAuth,bodyLimit:32768,schema:{params:params('postId'),body}},async(request,reply)=>send(reply,await service.save(request.actor,request.params.postId,request.body,request.headers['if-match'],request.headers['idempotency-key'])));
  app.post('/v1/community/posts/:postId/submit',{preHandler:requireAuth,schema:{params:params('postId')}},async(request,reply)=>send(reply,await service.submit(request.actor,request.params.postId,request.headers['if-match'],request.headers['idempotency-key'])));
  app.post('/v1/community/posts/:postId/withdraw',{preHandler:requireAuth,schema:{params:params('postId')}},async(request,reply)=>send(reply,await service.withdraw(request.actor,request.params.postId,request.headers['if-match'])));
  app.delete('/v1/community/posts/:postId',{preHandler:requireAuth,schema:{params:params('postId')}},async request=>({data:await service.withdraw(request.actor,request.params.postId,request.headers['if-match'],true)}));
  for(const type of ['like','bookmark'])for(const method of ['PUT','DELETE'])app.route({method,url:'/v1/community/posts/:postId/'+type,preHandler:requireAuth,schema:{params:params('postId')},handler:async request=>({data:await service.interaction(request.actor,request.params.postId,type,method==='PUT')})});
  app.post('/v1/community/posts/:postId/reports',{preHandler:requireAuth,schema:{params:params('postId'),body:{type:'object',additionalProperties:false,required:['category','details'],properties:{category:{type:'string',enum:['unsafe','harassment','copyright','spam','other']},details:{type:'string',minLength:1,maxLength:1000}}}}},async request=>({data:await service.report(request.actor,request.params.postId,request.body)}));
  app.get('/v1/admin/community/review',{preHandler:requireAuth,schema:{querystring:{type:'object',additionalProperties:false,properties:{cursor:{type:'string',maxLength:800}}}}},async request=>({data:await service.reviewQueue(request.actor,request.query)}));
  app.post('/v1/admin/community/posts/:postId/decisions',{preHandler:requireAuth,schema:{params:params('postId'),body:{type:'object',additionalProperties:false,required:['action','revisionId','reason'],properties:{action:{type:'string',enum:['approve','reject','hide','restore','dismiss_reports']},revisionId:{type:'string',format:'uuid'},reason:{type:'string',minLength:1,maxLength:1000}}}}},async(request,reply)=>send(reply,await service.decide(request.actor,request.params.postId,request.body,request.headers['if-match'],request.headers['idempotency-key'])));
  app.put('/v1/admin/community/members/:userId',{preHandler:requireAuth,schema:{params:params('userId'),body:{type:'object',additionalProperties:false,required:['allowed','reason'],properties:{allowed:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:1000}}}}},async request=>({data:await service.allowMember(request.actor,request.params.userId,request.body)}));
  app.post('/v1/community/posts/:postId/media',{preHandler:requireAuth,schema:{params:params('postId'),body:{type:'object',additionalProperties:false,required:['bytes','contentType','sha256'],properties:{bytes:{type:'integer',minimum:1,maximum:2097152},contentType:{type:'string',enum:['image/jpeg','image/png','image/webp']},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}},async request=>({data:await media.reserve(request.actor,request.params.postId,request.body,request.headers['idempotency-key'])}));
  app.put('/v1/community/media/:assetId/content',{preHandler:requireAuth,bodyLimit:2097152,schema:{params:params('assetId')}},async request=>{
    if(!request.body?.[Symbol.asyncIterator])throw new CommunityError('MEDIA_INVALID',400,'需要二进制图片请求。');
    const timer=setTimeout(()=>request.body.destroy(new CommunityError('UPLOAD_TIMEOUT',408,'图片上传超时。')),15000);
    try{return {data:await media.upload(request.actor,request.params.assetId,request.body)};}finally{clearTimeout(timer);}
  });
  app.post('/v1/community/media/:assetId/complete',{preHandler:requireAuth,schema:{params:params('assetId')}},async request=>({data:await media.complete(request.actor,request.params.assetId)}));
  app.get('/v1/community/me/media/:assetId',{preHandler:requireAuth,schema:{params:params('assetId')}},async request=>({data:await media.status(request.actor,request.params.assetId)}));
  app.get('/v1/community/media/:assetId/:variant',{preHandler:optionalAuth,schema:{params:{type:'object',additionalProperties:false,required:['assetId','variant'],properties:{assetId:{type:'string',format:'uuid'},variant:{enum:['thumb','display']}}},querystring:{type:'object',additionalProperties:false,properties:{preview:{type:'boolean'}}}}},async(request,reply)=>{
    const bytes=await media.content(request.actor,request.params.assetId,request.params.variant,{preview:request.query.preview===true});
    return reply.header('X-Content-Type-Options','nosniff').type('image/webp').send(bytes);
  });
}
