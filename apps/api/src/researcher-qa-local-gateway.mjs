import http from 'node:http';
import {parseWholeJson} from './researcher-qa-protocol/model-json.mjs';
import {QaLedgerError} from './researcher-qa-ledger.mjs';
import {QA_GATEWAY_ROUTES,signGatewayMessage} from './researcher-qa-protocol/qa-gateway-contract.mjs';
import {CONTROL_ROUTES} from './researcher-qa-protocol/qa-gateway-control-contract.mjs';

const LIMIT=131072;
const researcherRoutes=new Set([QA_GATEWAY_ROUTES.submit,CONTROL_ROUTES.inspect]);
const callbackRoutes=new Set([QA_GATEWAY_ROUTES.accepted,QA_GATEWAY_ROUTES.usage,CONTROL_ROUTES.authorize,CONTROL_ROUTES.status]);
const routes=new Set([...researcherRoutes,...callbackRoutes]);
function stop(code){throw new QaLedgerError(code);}
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))stop('QA_LOCAL_RESPONSE');}
function destination(origin,route,allowed=routes){const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!allowed.has(route))stop('QA_LOCAL_DESTINATION');return u;}
function signatureToken(token){if(typeof token!=='string'||!token||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))stop('QA_LOCAL_AUTH');}
/** One attempt, fixed loopback address, no proxy/env/redirect/retry behavior. */
export function localQaLedgerPost(origin,route,body,token,timeoutMs=5000){
 const u=destination(origin,route);signatureToken(token);const bytes=Buffer.from(JSON.stringify(body));
 if(bytes.length>LIMIT)stop('QA_LOCAL_BODY_LIMIT');if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)stop('QA_LOCAL_TIMEOUT');
 return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:u.port,path:route,method:'POST',agent:false,headers:{'content-type':'application/json','content-length':bytes.length,'x-research-qa-signature':token}},res=>{let size=0;const parts=[];res.on('data',p=>{size+=p.length;if(size>LIMIT)res.destroy(Error('QA_LOCAL_RESPONSE_LIMIT'));else parts.push(p);});res.on('error',reject);res.on('end',()=>{try{const value=parseWholeJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));if(res.statusCode!==200)stop('QA_LOCAL_REMOTE_STOPPED');resolve(value);}catch(e){reject(e);}});});
 const timer=setTimeout(()=>req.destroy(Error('QA_LOCAL_HTTP_UNCERTAIN')),timeoutMs);req.once('close',()=>clearTimeout(timer));req.on('error',reject);req.end(bytes);
 });
}
/** Explicit test/local listener, never registered in the normal API application. */
export async function startQaLoopbackReceiver(receive,{fault}={}){
 let authority='',closing=false;const active=new Set();
 const server=http.createServer((req,res)=>{const work=(async()=>{try{
  if(closing||req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==authority||req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined)stop('QA_LOCAL_ORIGIN');
  if(req.method!=='POST'||!researcherRoutes.has(req.url)||req.headers['content-type']!=='application/json')stop('QA_LOCAL_REQUEST');
  if(req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-research-qa-signature').length!==1)stop('QA_LOCAL_AUTH');
  const token=req.headers['x-research-qa-signature'];signatureToken(token);
  let size=0;const parts=[];for await(const p of req){size+=p.length;if(size>LIMIT)stop('QA_LOCAL_BODY_LIMIT');parts.push(p);}
  const body=parseWholeJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))),value=await receive(req.url,token,body);
  try{await fault?.('after_receive',req.url);}catch{res.destroy();return;}
  if(!res.destroyed){res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
 }catch{if(!res.destroyed){res.writeHead(409,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:'QA_LOCAL_STOPPED',retry:false}));}}})();active.add(work);void work.finally(()=>active.delete(work));});
 server.headersTimeout=5000;server.requestTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});authority='127.0.0.1:'+server.address().port;
 return {origin:'http://'+authority,async close(){closing=true;await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections();});await Promise.all(active);}};
}
/** Internal platform adapter only. prepared submissions and journal readers must
 * come from trusted platform/service code, never browser JSON. No provider or background execution. */
export function createLocalQaLedgerGateway({mode,ledger,researcherOrigin,usageProof,closureProof,prepareSubmission,resolveGrant,timeoutMs=5000,fault}){
 if(mode!=='simulation-only'||typeof usageProof!=='function'||typeof closureProof!=='function'||typeof prepareSubmission!=='function'||typeof resolveGrant!=='function')stop('QA_LOCAL_CONFIG');destination(researcherOrigin,QA_GATEWAY_ROUTES.submit);
 const postResearcher=(route,body,token)=>{destination(researcherOrigin,route,researcherRoutes);return localQaLedgerPost(researcherOrigin,route,body,token,timeoutMs);};
 const receive=async(route,token,body)=>{
  switch(route){
   case QA_GATEWAY_ROUTES.accepted:return ledger.accepted(token,body);
   case QA_GATEWAY_ROUTES.usage:return ledger.settleUsage(token,body,usageProof);
   case CONTROL_ROUTES.status:return ledger.applyStatus(token,body,closureProof);
   case CONTROL_ROUTES.authorize:{const result=await ledger.authorizeAction(token,body);await fault?.('after_authorize',route);return result;}
   default:stop('QA_LOCAL_ROUTE');
  }
 };
 async function get(actor,id){const subject=actor.userId;return ledger.tx('http_read',async c=>{const q=await ledger.question(c,id);if(q.subject_id!==subject)stop('QA_QUESTION_DENIED');await ledger.authorize(c,q.scope_json,'existing-question');const r=await ledger.reservation(c,id),unresolved=!q.link_json&&(q.status_json?.state==='not_found'||['dispatching','uncertain'].includes(q.delivery_state));return {questionId:id,deliveryState:q.delivery_state,released:q.released,statusVersion:q.status_version,unresolved,resolution:unresolved?'inspect-only':null,heldMicros:r.held_micros,spentMicros:r.spent_micros};});}
 return {mode,receive,get,
  // Trusted local executor port, intentionally absent from the HTTP route table.
  async consumeForExecution(permitId){await fault?.('before_consume');return ledger.consume(permitId);},
  async submit(actor,input){const principal=structuredClone(actor);input=structuredClone(input);const grant=await resolveGrant(structuredClone(principal));const prepared=structuredClone(await prepareSubmission(structuredClone(principal),structuredClone(input))),b=prepared.scope.binding;
   if(!input.question.trim()||b.subject!==principal.userId||prepared.scope.originGrantId!==grant||b.idempotencyKey!==input.idempotencyKey||b.article.platformArticleId!==input.platformArticleId||b.article.platformRevisionId!==input.platformRevisionId||prepared.body.question!==input.question.trim())stop('QA_HTTP_IDENTITY_BINDING');const admitted=await ledger.admit(prepared);await fault?.('after_admit');
   const intent=await ledger.claimDelivery(admitted.questionId);if(!intent.shouldSend){if(['dispatching','uncertain'].includes(intent.state)){const error=new QaLedgerError('QA_LOCAL_DELIVERY_UNRESOLVED');error.questionId=admitted.questionId;throw error;}return {...admitted,shouldSend:false,deliveryState:intent.state};}await fault?.('after_claim_before_send');
   try{const {claims,body}=intent.submission;// Only a successful pending -> dispatching claim may mint this envelope.
    // Preserve the original request ID/body; never re-sign an uncertain send.
    const originalToken=signGatewayMessage(ledger.forward,'submit',claims.sub,body,claims.requestId,ledger.clock());const accepted=await postResearcher(QA_GATEWAY_ROUTES.submit,body,originalToken);exact(accepted,['token','body']);await ledger.accepted(accepted.token,accepted.body);return {...admitted,shouldSend:true};}
   catch{await ledger.recoverDelivery(admitted.questionId);stop('QA_LOCAL_DELIVERY_UNCERTAIN');}
  },
  async refresh(actor,questionId){actor=structuredClone(actor);await get(actor,questionId);const query=await ledger.prepareInspection(questionId);const status=await postResearcher(CONTROL_ROUTES.inspect,query.body,query.token);exact(status,['token','body']);const result=await ledger.applyStatus(status.token,status.body,closureProof);return status.body.state==='not_found'?{...result,unresolved:true,resolution:'inspect-only',deliveryState:(await get(actor,questionId)).deliveryState,automaticResend:false}:result;}
 };
}
