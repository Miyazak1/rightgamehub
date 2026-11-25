import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeGroupHistory,HISTORY_SHAPE_PROBE} from '../../scripts/qq-group-history-shape-readonly.mjs';
import {parseInbound} from '../../apps/qq-channel/src/config.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
test('current ingress accepts direct at text but silently ignores the same message with a quote segment',()=>{
 const config={enabled:true,botId:'3922489710',groupId:'905757031',allowedUsers:['495469022'],maxInputBytes:2000};
 const event={post_type:'message',message_type:'group',self_id:3922489710,group_id:905757031,user_id:495469022,message_id:123,
 message:[{type:'at',data:{qq:'3922489710'}},{type:'text',data:{text:'测试'}}]};
 assert(parseInbound(config,event));
 assert.equal(parseInbound(config,{...event,message:[{type:'reply',data:{id:'122'}},...event.message]}),null);
});
test('history shape exposes quote, real mention, time and ID types while suppressing text and other callers',()=>{
 const secret='DO_NOT_PRINT_PRIVATE_TEXT_TOKEN_URL';
 const msg={user_id:495469022,time:Date.parse('2026-11-25T05:05:00Z')/1000,message_id:100,
 message:[{type:'reply',data:{id:secret}},{type:'at',data:{qq:'3922489710'}},{type:'text',data:{text:secret}}]};
 const out=summarizeGroupHistory({messages:[msg,{...msg,user_id:900001,message:[{type:secret}]}]});
 assert.equal(out.incidentCallerMessages.length,1);assert.equal(out.incidentCallerMessages[0].replyPresent,true);
 assert.equal(out.incidentCallerMessages[0].outsideTextAndAt,true);assert.equal(out.incidentCallerMessages[0].atExpectedBot,true);
 assert(!JSON.stringify(out).includes(secret));assert.equal(out.completeIncidentCoverageProven,false);assert.equal(out.historyIsNotWireEvent,true);
 const bad=summarizeGroupHistory({messages:[{...msg,message_id:'100',message:[{type:'text',data:{text:'@小墨鱼'}}]}]});
 assert.equal(bad.incidentCallerMessages[0].atExpectedBot,false);assert.equal(bad.incidentCallerMessages[0].numericSafeMessageId,false);
});
test('one native auth and one history request only; the native channel is never started or used to replay messages',async()=>{
 const calls=[],output=[],secret='DO_NOT_PRINT_NATIVE_TOKEN_OR_ERROR';let stopped=false;
 class NapCatControl{
  async post(path,body,auth,signal){calls.push([path,body]);assert(signal);if(auth){await this.post('/auth/login',{hash:secret},false,signal);}
   if(path==='/auth/login')return {Credential:secret};return {messages:[]};}
  unwrap(v){return v;}stop(){stopped=true;}
 }
 await new AsyncFunction('NapCatControl','process','console',HISTORY_SHAPE_PROBE.replace(/^import .*;\r?\n/m,''))(NapCatControl,{env:{QQ_NAPCAT_TOKEN:secret,QQ_ACCESS_TOKEN:secret}},{log:v=>output.push(JSON.parse(v))});
 assert.deepEqual(calls.map(c=>c[0]),['/Debug/call','/auth/login']);assert.equal(calls[0][1].action,'get_group_msg_history');
 assert.equal(output[0].managementAuthRequests,1);assert.equal(output[0].historyRequests,1);assert.equal(output[0].qqLoginRequested,false);assert(stopped);assert(!JSON.stringify(output).includes(secret));
});
test('errors are bounded and sanitized and cannot cause an automatic retry',async()=>{
 const output=[];let count=0;
 class NapCatControl{async post(){count++;throw Error('https://private.invalid/DO_NOT_PRINT');}stop(){}}
 await new AsyncFunction('NapCatControl','process','console',HISTORY_SHAPE_PROBE.replace(/^import .*;\r?\n/m,''))(NapCatControl,{env:{}},{log:v=>output.push(JSON.parse(v))});
 assert.equal(count,1);assert.equal(output[0].code,'BOUNDED_READ_FAILED');assert(!JSON.stringify(output).includes('private.invalid'));
});
