import {validateQQCommand} from './qq-admin-protocol.mjs';
const params={type:'object',additionalProperties:false,required:['agentUserId'],properties:{agentUserId:{type:'string',format:'uuid'}}};
const revision={type:'integer',minimum:1,maximum:2147483646};
const policy={type:'object',additionalProperties:false,required:['enabled','groupId','allowedUsers','dailyCalls','dailyTokens','userDailyCalls','userMinuteMessages','groupMinuteMessages'],properties:{
 enabled:{type:'boolean'},groupId:{type:'string',pattern:'^[1-9][0-9]{4,15}$'},allowedUsers:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',pattern:'^[1-9][0-9]{4,15}$'}},
 dailyCalls:{type:'integer',minimum:1,maximum:200},dailyTokens:{type:'integer',minimum:1024,maximum:2000000},userDailyCalls:{type:'integer',minimum:1,maximum:100},userMinuteMessages:{type:'integer',minimum:1,maximum:10},groupMinuteMessages:{type:'integer',minimum:1,maximum:30}
}};
export function registerAgentQQAdminRoutes(app,{service,requireAuth}){
 const root='/v1/admin/agents/:agentUserId/qq',guard=[async(_request,reply)=>{reply.header('Cache-Control','no-store, private').header('Pragma','no-cache');},requireAuth,async request=>service.authorize(request.actor,request.params.agentUserId)];
 const run=operation=>async(request,reply)=>{reply.header('Cache-Control','no-store, private').header('Pragma','no-cache');const {requestId,...args}=request.body??{};return {data:await service.execute(request.actor,request.params.agentUserId,operation,args,requestId)};};
 const strict=operation=>async request=>{const {requestId,...args}=request.body??{};validateQQCommand({operation,actorId:'11111111-1111-4111-8111-111111111111',agentUserId:request.params.agentUserId,args},requestId,request.params.agentUserId);};
 app.get(root,{preHandler:guard,schema:{params}},run('status'));
 app.get(root+'/qrcode',{preHandler:guard,schema:{params}},run('qr'));
 app.post(root+'/qrcode/refresh',{preHandler:guard,preValidation:strict('refresh'),bodyLimit:16384,schema:{params,body:{type:'object',additionalProperties:false,required:['requestId','expectedLoginRevision'],properties:{requestId:{type:'string',format:'uuid'},expectedLoginRevision:revision}}}},run('refresh'));
 const clearPassword=async request=>{if(request.body&&typeof request.body==='object')delete request.body.password;};
 app.post(root+'/login/password',{logLevel:'silent',onRequest:async(_request,reply)=>{reply.header('Cache-Control','no-store, private').header('Pragma','no-cache');},preHandler:guard,preValidation:strict('password'),onError:clearPassword,onResponse:clearPassword,bodyLimit:4096,schema:{params},errorHandler:(error,_request,reply)=>{
  const known=/^QQ_[A-Z0-9_]{1,70}$/u.test(error.code??'');
  reply.code(known?(error.statusCode??400):(error.statusCode<500?400:503)).send({error:{code:known?error.code:error.statusCode<500?'QQ_CONTROL_INPUT':'QQ_CONTROL_UNAVAILABLE'}});
 }},async(request,reply)=>{try{return await run('password')(request,reply);}finally{await clearPassword(request);}});
 app.put(root+'/settings',{preHandler:guard,preValidation:strict('configure'),bodyLimit:16384,schema:{params,body:{type:'object',additionalProperties:false,required:['requestId','expectedRevision','settings'],properties:{requestId:{type:'string',format:'uuid'},expectedRevision:revision,settings:policy}}}},run('configure'));
}
