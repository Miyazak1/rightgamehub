import http from 'node:http';
import {verifyQQSignature,validateQQCommand,qqUuid,qqAdminError} from '../../api/src/qq-admin-protocol.mjs';
export async function startQQControlServer({secret,agentUserId,store,napcat,gateway,port=6780,host='0.0.0.0'}){
 if(!/^[a-f0-9]{64}$/iu.test(secret??'')||!qqUuid(agentUserId))throw qqAdminError('QQ_CONTROL_CONFIG_REQUIRED',503);
 let active=0;const rates=new Map();
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}};
  if(req.method!=='POST'||req.url!=='/control')return send(404,{error:{code:'QQ_CONTROL_NOT_FOUND'}});
  if(active>=8)return send(429,{error:{code:'QQ_CONTROL_BUSY'}});active++;
  try{
   if(req.headers['content-type']?.split(';')[0]!=='application/json')throw qqAdminError('QQ_CONTROL_INPUT',400);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw qqAdminError('QQ_CONTROL_INPUT',413);chunks.push(chunk);}
   const raw=Buffer.concat(chunks).toString('utf8'),requestId=verifyQQSignature(secret,req.headers,raw);
   let command;try{command=JSON.parse(raw);}catch{throw qqAdminError('QQ_CONTROL_INPUT',400);}
   validateQQCommand(command,requestId,agentUserId);
   const now=Date.now();for(const [key,value]of rates)if(now-value.at>60000)rates.delete(key);
   const rate=rates.get(command.actorId)??{at:now,count:0};if(++rate.count>60||rates.size>128)throw qqAdminError('QQ_CONTROL_RATE_LIMIT',429);rates.set(command.actorId,rate);
   let data;
   if(command.operation==='status'){
    const view=await store.view(),runtime=await napcat.inspect(await store.repository.check());
    data={...view,runtime:{...runtime,connected:gateway.connected()}};
   }else if(command.operation==='qr'){
    const view=await store.view();data={...await napcat.qr(),loginRevision:view.loginRevision};
    const repo=store.repository,client=await repo.pool.connect();
    try{await repo.transaction(client,c=>repo.event(c,null,'admin-qr-viewed',{actorId:command.actorId,requestId}));}finally{client.release();}
   }else{
    if(command.operation==='refresh'&&(await napcat.inspect(await store.repository.check())).loggedIn)throw qqAdminError('QQ_ALREADY_LOGGED_IN',409);
    data=await store.mutate(requestId,command,()=>napcat.refresh());
   }
   send(200,{data});
  }catch(error){
   const known=/^QQ_[A-Z0-9_]{1,70}$/u.test(error.code??'');
   send(known?(error.statusCode??400):503,{error:{code:known?error.code:'QQ_CONTROL_UNAVAILABLE'}});
  }finally{active--;}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=24;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {address:server.address(),close:()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();})};
}
