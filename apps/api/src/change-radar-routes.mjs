const envelope=data=>({data});
const idParams={type:'object',additionalProperties:false,required:['watchId'],properties:{watchId:{type:'string',format:'uuid'}}};
const editable={title:{type:'string',minLength:1,maxLength:120},condition:{type:'string',maxLength:500},intervalMinutes:{type:'integer',minimum:15,maximum:10080},status:{type:'string',enum:['active','paused']}};

export function registerChangeRadarRoutes(app,{service,requireAuth}){
  app.get('/v1/me/change-watches',{preHandler:requireAuth},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.list(request.actor));});
  app.post('/v1/me/change-watches',{preHandler:requireAuth,schema:{body:{type:'object',additionalProperties:false,required:['title','url','intervalMinutes'],properties:{title:editable.title,condition:editable.condition,intervalMinutes:editable.intervalMinutes,url:{type:'string',minLength:8,maxLength:2048}}}}},async(request,reply)=>{reply.header('Cache-Control','no-store');return reply.status(201).send(envelope(await service.create(request.actor,request.body)));});
  app.get('/v1/me/change-watches/:watchId',{preHandler:requireAuth,schema:{params:idParams}},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.get(request.actor,request.params.watchId));});
  app.patch('/v1/me/change-watches/:watchId',{preHandler:requireAuth,schema:{params:idParams,body:{type:'object',additionalProperties:false,minProperties:1,properties:editable}}},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.update(request.actor,request.params.watchId,request.body));});
  app.delete('/v1/me/change-watches/:watchId',{preHandler:requireAuth,schema:{params:idParams}},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.remove(request.actor,request.params.watchId));});
  app.get('/v1/me/change-watches/:watchId/snapshots',{preHandler:requireAuth,schema:{params:idParams}},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.snapshots(request.actor,request.params.watchId));});
  app.post('/v1/me/change-watches/:watchId/check',{preHandler:requireAuth,schema:{params:idParams}},async(request,reply)=>{reply.header('Cache-Control','no-store');return envelope(await service.checkNow(request.actor,request.params.watchId));});
}
