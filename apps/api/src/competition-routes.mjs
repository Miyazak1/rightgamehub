import {competitionSchemas as schemas} from '../../../packages/contracts/src/competition-schema.mjs';
const object=(properties)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export function registerCompetitionRoutes(app,{service,requireAuth,identifyOptional}) {
  const workId={type:'string',pattern:'^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-fA-F-]{36})$'},uuid={type:'string',format:'uuid'};
  const session={type:'object',required:['x-gamehub-session'],properties:{'x-gamehub-session':{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}}};
  const respond=async(reply,task)=>{reply.header('Cache-Control','private, no-store');return {data:await task};};
  app.get('/v1/works/:workId/leaderboards',{schema:{params:object({workId})}},(request,reply)=>respond(reply,service.boards(request.params.workId)));
  app.get('/v1/works/:workId/leaderboards/:boardId',{preHandler:identifyOptional,schema:{params:object({workId,boardId:{type:'string',minLength:1,maxLength:48}}),querystring:{type:'object',additionalProperties:false,properties:{date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},puzzleId:{type:'string',minLength:1,maxLength:120},limit:{type:'integer',minimum:1,maximum:50},offset:{type:'integer',minimum:0,maximum:100000}}}}},(request,reply)=>respond(reply,service.leaderboard(request.actor,request.params.workId,request.params.boardId,request.query)));
  const options={preHandler:requireAuth,schema:{headers:session}};
  const token=request=>request.headers['x-gamehub-session'];
  app.get('/v1/competition/modes',options,(request,reply)=>respond(reply,service.modes(request.actor,token(request))));
  app.post('/v1/competition/runs',{...options,schema:{...options.schema,body:schemas.CompetitionStart}},(request,reply)=>respond(reply,service.start(request.actor,token(request),request.body)));
  app.get('/v1/competition/runs/:runId',{...options,schema:{...options.schema,params:object({runId:uuid})}},(request,reply)=>respond(reply,service.get(request.actor,token(request),request.params.runId)));
  app.post('/v1/competition/runs/:runId/finish',{...options,bodyLimit:16384,schema:{...options.schema,params:object({runId:uuid}),body:schemas.CompetitionFinish}},(request,reply)=>respond(reply,service.finish(request.actor,token(request),request.params.runId,request.body)));
  app.post('/v1/competition/runs/:runId/abandon',{...options,schema:{...options.schema,params:object({runId:uuid})}},(request,reply)=>respond(reply,service.abandon(request.actor,token(request),request.params.runId)));
  app.post('/v1/admin/competition/runs/:runId/decision',{preHandler:requireAuth,schema:{params:object({runId:uuid}),body:schemas.CompetitionDecision}},(request,reply)=>respond(reply,service.moderate(request.actor,request.params.runId,request.body)));
}
