import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseInbound,parseConfig} from '../../apps/qq-channel/src/config.mjs';
import {parseInboundWithContext} from '../../apps/qq-channel/src/message-context.mjs';
import {normalizeQQMessageSource,normalizeChannelReferenceResolution} from '../../apps/api/src/agent-channel-message-contracts.mjs';
import {agentContextChannelSignature,verifyAgentContextChannelSignature} from '../../apps/api/src/agent-channel-context-protocol.mjs';
import {agentChannelSignature,verifyAgentChannelSignature} from '../../apps/api/src/agent-channel-protocol.mjs';
import {QQService} from '../../apps/qq-channel/src/service.mjs';

const config=parseConfig({enabled:true,botId:'100000001',groupId:'200000001',allowedUsers:['300000001']},
 {QQ_ACCESS_TOKEN:'isolated-token-'.repeat(4),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_unit'});
const event={post_type:'message',message_type:'group',self_id:100000001,group_id:200000001,user_id:300000001,message_id:123,
 message:[{type:'reply',data:{id:'99'}},{type:'at',data:{qq:'100000001'}},{type:'text',data:{text:'解释引用'}}]};
const origin={channel:'qq',actorRef:'300000001',botId:'100000001',groupId:'200000001',conversationRef:'100000001:200000001:300000001',eventRef:'123'};

test('opt-in native reply parsing keeps actual @, text, allowlist and group restrictions; V1 stays strict',()=>{
 assert.equal(parseInbound(config,event),null);
 const input=parseInboundWithContext(config,event);
 assert.equal(input.text,'解释引用');assert.deepEqual(input.channelSource.mentions,['100000001']);assert.equal(input.channelSource.replyMessageId,'99');
 for(const patch of [{message:event.message.filter(p=>p.type!=='at')},{group_id:200000002},{self_id:100000002},{user_id:300000002},
  {message:[...event.message,{type:'image',data:{url:'http://private'}}]},{message:[...event.message,{type:'reply',data:{id:'98'}}]},
  {message:[{type:'reply',data:{id:'99',text:'forged'}},...event.message.slice(1)]},
  {message:[{type:'reply',data:{id:'9007199254740999'}},...event.message.slice(1)]},
  {message:[{type:'text',data:{text:'@小墨鱼 [CQ:reply,id=99]'}}]}])assert.equal(parseInboundWithContext(config,{...event,...patch}),null);
 assert.equal(parseInboundWithContext({...config,enabled:false},event),null);
});

test('channel source identifiers and mentions must match the signed origin and resolved references require a visible-text digest',()=>{
 const source=parseInboundWithContext(config,event).channelSource;
 assert.deepEqual(normalizeQQMessageSource(origin,source),source);
 for(const change of [{groupId:'200000002'},{userId:'300000002'},{messageId:'124'},{mentions:[]},{mentions:['100000001','100000001']},{preview:'forged'}])assert.throws(()=>normalizeQQMessageSource(origin,{...source,...change}));
 assert.throws(()=>normalizeChannelReferenceResolution(source,{state:'resolved',reason:'native-source-mapped',nativeMessageId:'99'},{reference:{}}));
 assert.throws(()=>normalizeChannelReferenceResolution(source,{state:'forbidden',reason:'scope-mismatch',nativeMessageId:'99'},{}));
});

test('V2 MAC binds its path and payload and cannot be replayed as V1 or forged by a changed quote',()=>{
 const secret='a'.repeat(64),timestamp=String(Date.now()),requestId=randomUUID(),body={agentId:randomUUID(),operation:'submit',origin,input:{source:{replyMessageId:'99'}}};
 const headers={'x-agent-channel-time':timestamp,'x-agent-channel-request':requestId,'x-agent-channel-signature':agentContextChannelSignature(secret,timestamp,requestId,body)};
 assert.doesNotThrow(()=>verifyAgentContextChannelSignature(secret,headers,body));
 assert.throws(()=>verifyAgentChannelSignature(secret,headers,body),{code:'AGENT_CHANNEL_UNAUTHORIZED'});
 assert.throws(()=>verifyAgentContextChannelSignature(secret,{...headers,'x-agent-channel-signature':agentChannelSignature(secret,timestamp,requestId,body)},body),{code:'AGENT_CHANNEL_UNAUTHORIZED'});
 assert.throws(()=>verifyAgentContextChannelSignature(secret,headers,{...body,input:{source:{replyMessageId:'100'}}}),{code:'AGENT_CHANNEL_UNAUTHORIZED'});
 assert.throws(()=>verifyAgentContextChannelSignature(secret,headers,body,Date.now()+60000),{code:'AGENT_CHANNEL_UNAUTHORIZED'});
});

test('new native context cannot fall back to the standalone QQ model loop',()=>{
 assert.throws(()=>new QQService({config,repository:{messageContext:{},agentBridge:false}}),{code:'QQ_CONTEXT_AGENT_BRIDGE_REQUIRED'});
});
