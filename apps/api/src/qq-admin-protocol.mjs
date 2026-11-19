import {createHmac,timingSafeEqual} from 'node:crypto';
export const qqUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
export class QQAdminError extends Error{constructor(code,statusCode=400){super(code);this.code=code;this.statusCode=statusCode;this.retryable=false;}}
export const qqAdminError=(code,statusCode=400)=>new QQAdminError(code,statusCode);
export const qqMutableKeys=['enabled','groupId','allowedUsers','dailyCalls','dailyTokens','userDailyCalls','userMinuteMessages','groupMinuteMessages'];
export const qqPolicyView=config=>Object.fromEntries(qqMutableKeys.map(key=>[key,structuredClone(config[key])]));
export function qqSignature(secret,timestamp,requestId,body){return createHmac('sha256',secret).update(`qq-admin-v1\n${timestamp}\n${requestId}\n${body}`).digest('hex');}
export function verifyQQSignature(secret,headers,body,now=Date.now()){
 const timestamp=headers['x-qq-time'],requestId=headers['x-qq-request'],signature=headers['x-qq-signature'];
 if(!/^[a-f0-9]{64}$/iu.test(secret??'')||!/^\d{13}$/u.test(timestamp??'')||Math.abs(now-Number(timestamp))>30000||!qqUuid(requestId)||!/^[a-f0-9]{64}$/u.test(signature??''))throw qqAdminError('QQ_CONTROL_UNAUTHORIZED',401);
 const expected=qqSignature(secret,timestamp,requestId,body);
 if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw qqAdminError('QQ_CONTROL_UNAUTHORIZED',401);
 return requestId;
}
export function validateQQCommand(body,requestId,agentUserId){
 if(!body||Object.getPrototypeOf(body)!==Object.prototype||Object.keys(body).some(key=>!['operation','actorId','agentUserId','args'].includes(key))||!qqUuid(body.actorId)||body.agentUserId!==agentUserId||!qqUuid(requestId)||!['status','qr','refresh','configure'].includes(body.operation))throw qqAdminError('QQ_CONTROL_INPUT',400);
 if(!body.args||Object.getPrototypeOf(body.args)!==Object.prototype)throw qqAdminError('QQ_CONTROL_INPUT',400);
 const keys=body.operation==='configure'?['expectedRevision','settings']:body.operation==='refresh'?['expectedLoginRevision']:[];
 if(Object.keys(body.args).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(body.args,key)))throw qqAdminError('QQ_CONTROL_INPUT',400);
 if(body.operation==='configure'&&(!Number.isSafeInteger(body.args.expectedRevision)||body.args.expectedRevision<1||!body.args.settings||Object.keys(body.args.settings).sort().join(',')!==[...qqMutableKeys].sort().join(',')))throw qqAdminError('QQ_CONTROL_INPUT',400);
 if(body.operation==='refresh'&&(!Number.isSafeInteger(body.args.expectedLoginRevision)||body.args.expectedLoginRevision<1))throw qqAdminError('QQ_CONTROL_INPUT',400);
 return body;
}
