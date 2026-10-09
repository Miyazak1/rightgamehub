import { schemas } from '@gamehub/contracts';
import { GameShareError } from './game-share-service.mjs';
export function registerGameShareRoutes(app,{service,requireAuth}) {
  const reads=new Map();
  const noStore=async(_req,reply)=>{reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');};
  app.register(async routes=>{
    routes.addHook('onRequest',noStore);
    routes.post('/v1/game-shares',{preHandler:requireAuth,bodyLimit:24000,schema:{body:schemas.CreateGameShareRequest,headers:{type:'object',required:['x-gamehub-session'],properties:{'x-gamehub-session':{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}}}}},async(req,reply)=>reply.code(201).send({data:await service.create(req.actor,req.headers['x-gamehub-session'],req.body)}));
    routes.get('/v1/game-shares/:code',{schema:{params:schemas.GameShareParams}},async req=>{
      const now=Date.now();let entry=reads.get(req.ip);if(!entry||entry.until<=now){entry={until:now+60000,count:0};if(reads.size>=2048)reads.delete(reads.keys().next().value);reads.set(req.ip,entry);}
      if(++entry.count>60)throw new GameShareError('SHARE_RATE_LIMITED',429,'读取过于频繁，请稍后重试。',true);
      return {data:await service.get(req.params.code)};
    });
    routes.delete('/v1/game-shares/:code',{preHandler:requireAuth,schema:{params:schemas.GameShareParams}},async req=>({data:await service.revoke(req.actor,req.params.code)}));
  });
  app.addHook('onReady',async()=>service.start?.());
  app.addHook('onClose',async()=>service.stop?.());
}
