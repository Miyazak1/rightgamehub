import {QaLedgerError} from './researcher-qa-ledger.mjs';
import {QA_GATEWAY_ROUTES} from './researcher-qa-protocol/qa-gateway-contract.mjs';
import {CONTROL_ROUTES} from './researcher-qa-protocol/qa-gateway-control-contract.mjs';
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const uuid={type:'string',format:'uuid'};
const input=object({platformArticleId:uuid,platformRevisionId:uuid,question:{type:'string',minLength:1,maxLength:500,pattern:'\\S'},idempotencyKey:{type:'string',pattern:'^[-a-zA-Z0-9]{8,100}$'}});
const params=object({questionId:uuid});
function mapped(error,internal){const code=error.code??error.message;
 if(error.validation||[400,413,415].includes(error.statusCode))return [error.statusCode??400,'QA_HTTP_INPUT'];
 if(['QA_GRANT_REVOKED','QA_SNAPSHOT_DENIED','QA_QUESTION_DENIED','QA_HTTP_IDENTITY_BINDING','QA_AGENT_DENIED','QA_HUMAN_REQUIRED'].includes(code))return [403,'QA_HTTP_FORBIDDEN'];
 if(code==='QA_QUESTION_NOT_FOUND')return internal?[403,'QA_HTTP_PROTOCOL_DENIED']:[404,'QA_HTTP_NOT_FOUND'];
 if(['QA_BUDGET_STOP','QA_QUESTION_BUDGET','QA_TOKEN_BUDGET_STOP'].includes(code))return [409,'QA_HTTP_BUDGET_STOP'];
 if(code==='QA_LOCAL_DELIVERY_UNRESOLVED')return [409,'QA_HTTP_DELIVERY_UNRESOLVED'];
 if(code==='QA_LOCAL_DELIVERY_UNCERTAIN'||code==='QA_LOCAL_HTTP_UNCERTAIN')return [409,'QA_HTTP_UNCERTAIN'];
 if(internal&&/^QA_(?:CONTROL|GATEWAY)_/.test(code))return [403,'QA_HTTP_PROTOCOL_DENIED'];
 if(error instanceof QaLedgerError||/^QA_(?:CONTROL|GATEWAY)_/.test(code??''))return [409,'QA_HTTP_STOPPED'];
 return [500,'QA_HTTP_INTERNAL'];
}
function protocolBody(path){
 if(path===CONTROL_ROUTES.authorize)return {type:'object',additionalProperties:false,required:['scope','link','kind','actionDigest'],properties:{scope:{},link:{},kind:{},callIndex:{},readIndex:{},actionDigest:{}}};
 const names=path===QA_GATEWAY_ROUTES.accepted?['link']:path===QA_GATEWAY_ROUTES.usage?['link','receipt']:['scope','inReplyTo','link','statusVersion','state','executionClosed','slots','checkpointHash','resultHash','generatedAt'];
 return object(Object.fromEntries(names.map(k=>[k,{}])));
}
/** Opt-in local routes; production runtime supplies no gateway dependency. */
export function registerResearchQaHttpRoutes(app,{gateway,requireAuth}){
 if(gateway.mode!=='simulation-only')throw Error('QA_HTTP_DISABLED');
 app.register(async local=>{
  local.addHook('onRequest',async(request,reply)=>{reply.header('Cache-Control','no-store');if(request.url.includes('?'))return reply.code(400).send({error:{code:'QA_HTTP_INPUT',retryable:false}});if(request.raw.socket.remoteAddress!=='127.0.0.1'||request.headers['x-forwarded-for']!==undefined||request.headers.forwarded!==undefined||request.headers.origin!==undefined||request.headers['sec-fetch-site']!==undefined)return reply.code(403).send({error:{code:'QA_HTTP_LOCAL_ONLY',retryable:false}});});
  local.setErrorHandler((error,request,reply)=>{const [status,code]=mapped(error,request.url.startsWith('/internal/'));reply.code(status).send({error:{code,retryable:status===500,...(code==='QA_HTTP_DELIVERY_UNRESOLVED'&&error instanceof QaLedgerError?{reconcileRequired:true,questionId:error.questionId}:{})}});});
  const auth=async(request,reply)=>{try{await requireAuth(request);}catch(error){if(error.statusCode!==401)throw error;return reply.code(401).send({error:{code:'QA_HTTP_AUTH',retryable:false}});}};
  local.post('/v1/me/research-qa',{bodyLimit:65536,preHandler:auth,schema:{body:input}},async request=>({data:await gateway.submit(request.actor,request.body)}));
  local.get('/v1/me/research-qa/:questionId',{preHandler:auth,schema:{params}},async request=>({data:await gateway.get(request.actor,request.params.questionId)}));
  local.post('/v1/me/research-qa/:questionId/reconcile',{bodyLimit:1024,preHandler:auth,schema:{params,body:object({})}},async request=>({data:await gateway.refresh(request.actor,request.params.questionId)}));
  for(const path of [QA_GATEWAY_ROUTES.accepted,QA_GATEWAY_ROUTES.usage,CONTROL_ROUTES.authorize,CONTROL_ROUTES.status]){
   local.post(path,{bodyLimit:65536,schema:{body:protocolBody(path)},preHandler:async(request,reply)=>{
    const token=request.headers['x-research-qa-signature'];
    if(typeof token!=='string'||token.length<1||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||request.raw.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-research-qa-signature').length!==1)return reply.code(401).send({error:{code:'QA_HTTP_SIGNATURE_REQUIRED',retryable:false}});
   }},async request=>gateway.receive(path,request.headers['x-research-qa-signature'],request.body));
  }
 });
}
