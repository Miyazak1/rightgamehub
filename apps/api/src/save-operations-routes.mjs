import {schemas} from '@gamehub/contracts';
export function registerSaveOperationsRoutes(app,{service,requireAuth}) {
  app.register(async routes=>{
    routes.addHook('onRequest',async(request,reply)=>{reply.header('Cache-Control','private, no-store');reply.header('X-Content-Type-Options','nosniff');await requireAuth(request);});
    routes.get('/v1/creator/save-health',{schema:{querystring:schemas.SaveHealthQuery}},async request=>({data:await service.health(request.actor,request.query)}));
    const base='/v1/admin/save-operations';
    routes.get(base+'/health',{schema:{querystring:schemas.SaveHealthQuery}},async request=>({data:await service.health(request.actor,{...request.query,admin:true})}));
    routes.get(base+'/capacity',async request=>({data:await service.capacity(request.actor)}));
    routes.get(base+'/audit',async request=>({data:await service.audit(request.actor)}));
    routes.patch(base+'/capacity',{bodyLimit:4096,schema:{body:schemas.SaveCapacityRequest}},async request=>({data:await service.setCapacity(request.actor,{...request.body,requestId:request.id})}));
    routes.patch(base+'/policies/:policyId',{bodyLimit:4096,schema:{params:schemas.SavePolicyParams,body:schemas.SavePolicyPauseRequest}},async request=>({data:await service.pausePolicy(request.actor,{...request.params,...request.body,requestId:request.id})}));
    routes.post(base+'/works/:workId/maintenance',{bodyLimit:4096,schema:{params:schemas.GameSaveParams,body:schemas.SaveMaintenanceRequest}},async request=>({data:await service.maintain(request.actor,{...request.params,...request.body,requestId:request.id})}));
  });
}
