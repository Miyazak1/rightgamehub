import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInteractionInput,normalizeInteractionOrigin,normalizeGitHubInteraction,forceExplicitDraft,interactionId,AGENT_CONVERSATION_WORKFLOW} from '../../apps/api/src/agent-interaction-contracts.mjs';
import {agentChannelSignature,verifyAgentChannelSignature} from '../../apps/api/src/agent-channel-protocol.mjs';
import {qqSignature} from '../../apps/api/src/qq-admin-protocol.mjs';
import {createAgentInteractionService} from '../../apps/api/src/agent-interaction-service.mjs';
import {createAgentInteractionWorker} from '../../apps/api/src/agent-interaction-worker.mjs';
import {validateConversationOutput,validateConversationAttempt} from '../../apps/api/src/agent-interaction-conversation.mjs';
import {loadAgentInteractionConfig} from '../../apps/api/src/agent-interaction-config.mjs';
import {createRequire} from 'node:module';
import {registerAgentInteractionRoutes} from '../../apps/api/src/agent-interaction-routes.mjs';
import {createQQAgentClient} from '../../apps/qq-channel/src/agent-bridge.mjs';

const agentId='10000000-0000-4000-8000-000000000001',userId='20000000-0000-4000-8000-000000000001',requestId='30000000-0000-4000-8000-000000000001';
const qq={channel:'qq',actorRef:'495469022',botId:'3922489710',groupId:'905757031',conversationRef:'3922489710:905757031:495469022',eventRef:'12345'};
test('the production QQ client and API route verify channel origin without accepting operator impersonation',async()=>{
 const fastify=createRequire(new URL('../../apps/api/package.json',import.meta.url))('fastify'),app=fastify(),f=fixture(),secret='c'.repeat(64);
 registerAgentInteractionRoutes(app,{service:f.service,channelSecret:secret,requireAuth:async()=>{throw Object.assign(new Error('AUTH_REQUIRED'),{statusCode:401});}});
 const client=createQQAgentClient({url:'http://api:3090',secret,agentId,fetchImpl:async(_url,options)=>{const result=await app.inject({method:'POST',url:'/v1/internal/agent/qq',headers:options.headers,payload:options.body});return new Response(result.body,{status:result.statusCode});}});
 try{
  const accepted=await client({operation:'submit',origin:qq,input:{requestId,message:'查找开源项目'}});assert.equal(accepted.state,'queued');
  assert.equal((await client({operation:'status',origin:qq,interactionId:accepted.id})).id,accepted.id);
  await assert.rejects(client({operation:'submit',origin:{...qq,platformUserId:userId},input:{requestId,message:'冒充管理员'}}),{code:'AGENT_INTERACTION_ORIGIN'});
  assert.equal((await app.inject({method:'POST',url:'/v1/internal/agent/qq',payload:{operation:'submit'}})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/v1/me/agent/interactions/'+accepted.id})).statusCode,401);
 }finally{await app.close();}
});
test('interaction origins distinguish Agent, requester and channel and cannot carry operator impersonation',()=>{
 assert.deepEqual(normalizeInteractionOrigin(qq),qq);
 for(const change of [{platformUserId:userId},{actorRef:qq.botId},{conversationRef:'other-user'},{actorRef:'9007199254740999'}])assert.throws(()=>normalizeInteractionOrigin({...qq,...change}));
 assert.throws(()=>normalizeInteractionInput({requestId,message:'写文章',actorId:userId}));
 assert.throws(()=>normalizeGitHubInteraction({kind:'github-article',topic:'项目研究',repositoryUrl:'https://example.com/private',publication:'inherit'}));
 assert.equal(forceExplicitDraft('只写草稿，不要发布',{publication:'inherit'}).publication,'draft');
 assert.notEqual(interactionId([agentId,'web',userId,'1']),interactionId([agentId,'qq',userId,'1']));
 assert.equal(AGENT_CONVERSATION_WORKFLOW.requiredCapabilities[0].key,'provider.text.generate');
});
test('QQ interaction signatures are semantic, expiring and separated from administrative signatures',()=>{
 const secret='a'.repeat(64),now=1795170000000,body={operation:'submit',agentId,origin:qq,input:{requestId,message:'查找 GitHub 项目'}};
 const headers={'x-agent-channel-time':String(now),'x-agent-channel-request':requestId,'x-agent-channel-signature':agentChannelSignature(secret,String(now),requestId,body)};
 assert.equal(verifyAgentChannelSignature(secret,headers,{input:body.input,origin:qq,agentId,operation:'submit'},now),requestId);
 assert.throws(()=>verifyAgentChannelSignature(secret,headers,{...body,operation:'status'},now),{code:'AGENT_CHANNEL_UNAUTHORIZED'});
 assert.throws(()=>verifyAgentChannelSignature(secret,headers,body,now+31000));
 assert.throws(()=>verifyAgentChannelSignature(secret,{...headers,'x-agent-channel-signature':qqSignature(secret,String(now),requestId,JSON.stringify(body))},body,now));
});
function fixture(){
 let canInvoke=false,enabled=true,accepts=0;const rows=new Map(),agent={id:agentId,display_name:'小墨鱼',operator_user_id:userId};
 const repository={agent:async()=>agent,principal:async()=>({owner:false,canInvoke}),accept:async({agentId,origin,input,kind='message',parentId=null})=>{accepts++;const row={id:interactionId([agentId,origin,kind]),agent_user_id:agentId,origin_json:origin,input_json:input,channel:origin.channel,actor_ref:origin.actorRef,conversation_ref:origin.conversationRef,kind,parent_id:parentId,state:'queued'};rows.set(row.id,row);return row;},get:async id=>rows.get(id),children:async()=>[],progress:async()=>null,attachTask:async(row,spec)=>repository.accept({agentId,origin:row.origin_json,input:spec,kind:spec.kind,parentId:row.id}),publicArticles:async()=>[],ownTasks:async()=>[]};
 const service=createAgentInteractionService({repository,agentId,readQQPolicy:async()=>({agentId,botId:qq.botId,groupId:qq.groupId,allowedUsers:[qq.actorRef],enabled})});
 return {service,repository,rows,setInvoke:value=>canInvoke=value,disable:()=>enabled=false,count:()=>accepts};
}
test('QQ chat admission does not confer writing authority; delegation and live channel revocation are checked',async()=>{
 const f=fixture(),accepted=await f.service.receive(qq,{requestId,message:'请找 GitHub 项目写文章'}),row=await f.repository.get(accepted.id);
 const tools=await f.service.tools(row);await assert.rejects(tools.execute(null,'github_write_article',{topic:'找适合学生使用的开源项目'}),{code:'AGENT_INTERACTION_INVOKE_DENIED'});assert.equal(f.count(),1);
 f.setInvoke(true);const task=await tools.execute(null,'github_write_article',{topic:'找适合学生使用的开源项目'});assert.equal(task.result.status,'queued');assert.equal(task.task.kind,'github-article');assert.equal(f.count(),2);
 await assert.rejects(tools.execute(null,'get_my_learning_data',{}),{code:'AGENT_INTERACTION_TOOL_DENIED'});
 f.disable();await assert.rejects(f.service.status(qq,accepted.id),{code:'AGENT_INTERACTION_CHANNEL_DENIED'});
});
test('interaction status never exposes another requester or group, including guessed task UUIDs',async()=>{
 const f=fixture(),accepted=await f.service.receive(qq,{requestId,message:'看看你最近发表的文章'});
 await assert.rejects(f.service.status({...qq,actorRef:'123456789',conversationRef:qq.botId+':'+qq.groupId+':123456789'},accepted.id),{code:'AGENT_INTERACTION_CHANNEL_DENIED'});
 f.rows.get(accepted.id).actor_ref='another';await assert.rejects(f.service.status(qq,accepted.id),{code:'AGENT_INTERACTION_NOT_FOUND'});
});
test('a long GitHub task does not hold the conversation processing slot',async()=>{
 let release;const jobs={message:{id:'message',kind:'message',origin_json:qq},task:{id:'task',kind:'github-article',origin_json:qq}},settled=[];
 const worker=createAgentInteractionWorker({agentId,repository:{claim:async(_id,kind)=>{const row=jobs[kind];delete jobs[kind];return row;},settle:async(row,value)=>settled.push([row.id,value])},service:{authorize:async()=>{}},conversation:async()=>({reply:'任务仍在进行'}),github:()=>new Promise(resolve=>release=()=>resolve({reply:'已完成'}))});
 const long=worker.tick('task');while(!release)await new Promise(resolve=>setImmediate(resolve));await worker.tick('message');assert.equal(settled[0][0],'message');release();await long;assert.equal(settled[1][0],'task');worker.stop();
});
test('core output and enabled identity binding remain strict and papers cannot be enabled through the channel',()=>{
 assert.deepEqual(validateConversationOutput({reply:'你好'}),{reply:'你好'});
 assert.throws(()=>validateConversationOutput({reply:'你好',publish:true}));
 assert.equal(validateConversationAttempt('[历史消息所属题目：平台] 回显').accepted,false);
 assert.deepEqual(validateConversationAttempt('{"reply":"已收到"}'),{accepted:true,completion:{reply:'已收到'}});
 assert.equal(validateConversationAttempt({reply:'你好',publish:true}).accepted,false);
 assert.equal(loadAgentInteractionConfig({}).enabled,false);
 const env={AGENT_INTERACTIONS_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_ENABLED:'true',AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID:agentId};assert.equal(loadAgentInteractionConfig(env).agentId,agentId);
 assert.throws(()=>loadAgentInteractionConfig({...env,QQ_ADMIN_ENABLED:'true',QQ_ADMIN_AGENT_USER_ID:userId}));
 assert.throws(()=>loadAgentInteractionConfig({...env,PAPER_STUDY_ENABLED:'true'}));
});
