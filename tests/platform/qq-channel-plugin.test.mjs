import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {createQQChannelPluginHost} from '../../apps/qq-channel/src/plugin-catalog.mjs';
import {QQ_CHANNEL_PLUGIN_MANIFEST} from '../../apps/qq-channel/src/plugins/qq/index.mjs';
import {createBuiltinAgentPluginHost} from '../../apps/api/src/agent-plugin-catalog.mjs';
import {createAgentPluginHost} from '../../apps/api/src/agent-plugin-host.mjs';
import {qqChannelPlugin} from '../../apps/qq-channel/src/plugins/qq/index.mjs';
import {OneBotGateway} from '../../apps/qq-channel/src/onebot.mjs';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {parseConfig} from '../../apps/qq-channel/src/config.mjs';
const binding={id:'mooyu.qq',version:'1.0.0'};
test('managed control status reports actual plugin state and bounded fault codes without private errors',async()=>{
 const {startQQControlServer}=await import('../../apps/qq-channel/src/control-server.mjs'),{qqSignature}=await import('../../apps/api/src/qq-admin-protocol.mjs'),{randomUUID}=await import('node:crypto');
 const f=fixture(),host=createQQChannelPluginHost({env:{}});let inspect,runtime,server;
 runtime=await host.bindChannel(binding,{...f.context,controlFactory:async options=>{inspect=options.pluginStatus;return server=await startQQControlServer({...options,store:{view:async()=>({}),repository:f.context.repository},host:'127.0.0.1',port:0});},napcatFactory:()=>({inspect:async()=>({loggedIn:true}),maintain:async()=>{throw Object.assign(Error('private credentials never returned'),{code:'QQ_GATEWAY_UNAVAILABLE'});}}),log:event=>{if(event.event==='worker-waiting')runtime.stop();}});
 try{
  await runtime.start();assert.equal(inspect().plugins[0].enabled,true);assert.equal(inspect().channelRuntime.started,true);
  const at=String(Date.now()),id=randomUUID(),body=JSON.stringify({operation:'status',actorId:randomUUID(),agentUserId:f.context.env.QQ_ADMIN_AGENT_USER_ID,args:{}});
  const response=await fetch('http://127.0.0.1:'+server.address.port+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':at,'x-qq-request':id,'x-qq-signature':qqSignature(f.context.channelSecret,at,id,body)},body});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.data.plugins[0].id,'mooyu.qq');assert.equal(result.data.channelRuntime.executionMode,'agent');
  await runtime.run();assert.equal(inspect().channelRuntime.lastFault.code,'QQ_GATEWAY_UNAVAILABLE');assert(!JSON.stringify(inspect()).includes('private credentials'));
  host.setEnabled('mooyu.qq',false);assert.equal(inspect().plugins[0].enabled,false);
 }finally{await runtime.close();}
});
function fixture({controlFailure=false}={}){
 const config=parseConfig({enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']},{QQ_ACCESS_TOKEN:'plugin-fixture-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_plugin'}),events=[];
 const repository={control:true,enableControl:async()=>events.push('control-schema'),enableAgentBridge:async()=>events.push('bridge-schema'),check:async()=>config,locked:async fn=>fn({}),recover:async()=>events.push('recover'),next:async()=>null,agentPending:async()=>null,admit:async event=>{events.push(event);return {accepted:true};}};
 const gateway={start:async()=>{events.push('listen');return {address:'127.0.0.1',port:1234};},stop:async()=>events.push('gateway-close'),connected:()=>true};
 const context={config,pool:{end(){assert.fail('channel must not own the pool');}},repository,managed:true,useAgent:true,channelSecret:'ab'.repeat(32),env:{QQ_ADMIN_AGENT_USER_ID:'11111111-1111-4111-a111-111111111111'},client:async()=>assert.fail('idle channel must not invoke Agent'),provider:()=>assert.fail('Agent mode must not use a channel model'),gatewayFactory:()=>gateway,napcatFactory:()=>({readyGroup:config.groupId,maintain:async()=>events.push('maintain')}),controlFactory:async()=>{if(controlFailure)throw Object.assign(Error(),{code:'QQ_CONTROL_FAILED'});return {address:{port:1235},close:async()=>events.push('control-close')};}};
 return {context,events};
}
test('QQ is a channel plugin independent of GitHub, tool grants and Agent workflows',()=>{
 assert.equal(QQ_CHANNEL_PLUGIN_MANIFEST.kind,'channel');assert.deepEqual(QQ_CHANNEL_PLUGIN_MANIFEST.dependencies,[]);assert.deepEqual(QQ_CHANNEL_PLUGIN_MANIFEST.capabilities,[]);assert.deepEqual(QQ_CHANNEL_PLUGIN_MANIFEST.taskKinds,[]);
 assert.equal(createBuiltinAgentPluginHost({env:{AGENT_PLUGINS_DISABLED:'mooyu.qq'}}).descriptions().length,3);
 assert.equal(createQQChannelPluginHost({env:{AGENT_PLUGINS_DISABLED:'mooyu.github'}}).requirePlugin('mooyu.qq').version,'1.0.0');
 assert.throws(()=>createQQChannelPluginHost({env:{AGENT_PLUGINS_DISABLED:'unknown.plugin'}}),{code:'AGENT_PLUGIN_CONFIGURATION_INVALID'});
});
test('disabled channel cannot construct runtime, open ports or initialize a database',async()=>{
 const f=fixture(),host=createQQChannelPluginHost({env:{AGENT_PLUGINS_DISABLED:'mooyu.qq'}});
 await assert.rejects(host.bindChannel(binding,f.context),{code:'AGENT_PLUGIN_DISABLED'});assert.deepEqual(f.events,[]);
});
test('channel lifecycle pauses without deleting sessions, keeps Agent mode and closes once',async()=>{
 const f=fixture(),host=createQQChannelPluginHost({env:{}}),runtime=await host.bindChannel(binding,f.context);
 assert.deepEqual(f.events,[]);await Promise.all([runtime.start(),runtime.start()]);await runtime.start();assert.equal(f.events.filter(e=>e==='listen').length,1);assert.equal(runtime.status().executionMode,'agent');
 await runtime.tick();await runtime.receive({test:'message'});const before=f.events.length;host.setEnabled('mooyu.qq',false);
 await assert.rejects(runtime.tick(),{code:'AGENT_PLUGIN_DISABLED'});await assert.rejects(runtime.receive({test:'blocked'}),{code:'AGENT_PLUGIN_DISABLED'});assert.equal(f.events.length,before);
 host.setEnabled('mooyu.qq',true);await runtime.tick();host.setEnabled('mooyu.qq',false);await runtime.close();await runtime.close();assert.equal(f.events.filter(e=>e==='gateway-close').length,1);assert.equal(f.events.filter(e=>e==='control-close').length,1);assert.equal(runtime.status().stopped,true);
});
test('partial channel startup failure releases its listener and leaves the injected pool intact',async()=>{
 const f=fixture({controlFailure:true}),runtime=await createQQChannelPluginHost({env:{}}).bindChannel(binding,f.context);
 await assert.rejects(runtime.start(),{code:'QQ_CONTROL_FAILED'});assert.equal(f.events.filter(e=>e==='gateway-close').length,1);await runtime.close();
});
test('host config errors are reported before constructing repositories',async()=>{
 await assert.rejects(createQQChannelPluginHost({env:{}}).bindChannel(binding,{}),{code:'QQ_PLUGIN_CONFIG_REQUIRED'});
});
test('revocation during listener startup closes the partial channel before starting control',async()=>{
 const f=fixture(),gateway=f.context.gatewayFactory();let release;
 gateway.start=()=>new Promise(r=>release=()=>r({address:'127.0.0.1',port:0}));
 const host=createQQChannelPluginHost({env:{}}),runtime=await host.bindChannel(binding,{...f.context,gatewayFactory:()=>gateway}),starting=runtime.start();
 await new Promise(r=>setImmediate(r));assert.equal(typeof release,'function');host.setEnabled('mooyu.qq',false);release();
 await assert.rejects(starting,{code:'AGENT_PLUGIN_DISABLED'});assert.equal(f.events.filter(e=>e==='gateway-close').length,1);assert.ok(!f.events.includes('control-close'));
});
test('plugin preserves the legacy direct-provider path only when Agent mode is explicitly off',async()=>{
 const f=fixture();let calls=0,saved;
 Object.assign(f.context.repository,{control:false,history:async()=>[],next:async()=>({status:'queued',message_id:'1',user_id:'100000003',input_text:'你好'}),reserve:async(_c,row)=>({...row,attempt_count:1}),generated:async(_c,_row,reply)=>saved=reply});
 const runtime=await createQQChannelPluginHost({env:{}}).bindChannel(binding,{...f.context,managed:false,useAgent:false,provider:async()=>{calls++;return {reply:'旧文字模式仍可用',usage:{inputTokens:1,outputTokens:1}};}});
 await runtime.start();assert.equal((await runtime.tick()).generated,true);assert.equal(calls,1);assert.equal(saved,'旧文字模式仍可用');assert.equal(runtime.status().executionMode,'legacy');assert.ok(!f.events.includes('bridge-schema'));await runtime.close();
});
test('plugin default OneBot receive hook works through an authenticated real local socket', {timeout:5000},async t=>{
 const {WebSocket}=createRequire(new URL('../../apps/qq-channel/package.json',import.meta.url))('ws'),f=fixture(),logs=[];
 let accepted;const incoming=new Promise(r=>accepted=r);f.context.repository.admit=async event=>{accepted(event);return {accepted:true};};
 const runtime=await createQQChannelPluginHost({env:{}}).bindChannel(binding,{...f.context,log:v=>logs.push(v),gatewayFactory:(c,o)=>new OneBotGateway({...c,port:0,host:'127.0.0.1'},o)});t.after(()=>runtime.close());await runtime.start();
 const socket=new WebSocket('ws://127.0.0.1:'+logs.find(v=>v.event==='listening').port+'/onebot/v11',{headers:{authorization:'Bearer '+f.context.config.accessToken,'x-self-id':f.context.config.botId}});t.after(()=>socket.close());await once(socket,'open');
 socket.send(JSON.stringify({post_type:'message',message_type:'group',self_id:100000001,group_id:100000002,user_id:100000003,message_id:42,message:[]}));assert.equal((await incoming).message_id,42);
});
test('host closes an async-created channel when revoked during binding or when its hooks are invalid',async()=>{
 let release,closed=0;const runtime={start:async()=>{},run:async()=>{},tick:async()=>{},receive:async()=>{},stop:()=>{},close:async()=>closed++};
 const host=createAgentPluginHost({definitions:[{...qqChannelPlugin,createChannelRuntime:()=>new Promise(r=>release=()=>r(runtime))}]});
 const pending=host.bindChannel(binding,{});host.setEnabled('mooyu.qq',false);release();await assert.rejects(pending,{code:'AGENT_PLUGIN_DISABLED'});assert.equal(closed,1);
 const invalid=createAgentPluginHost({definitions:[{...qqChannelPlugin,createChannelRuntime:()=>({close:()=>closed++})}]});
 await assert.rejects(invalid.bindChannel(binding,{}),{code:'AGENT_PLUGIN_CHANNEL_INVALID'});assert.equal(closed,2);
 await assert.rejects(createBuiltinAgentPluginHost({env:{}}).bindChannel({id:'mooyu.github',version:'1.0.0'},{}),{code:'AGENT_PLUGIN_KIND_MISMATCH'});
});
test('stop wakes the channel polling loop without destroying a login or database', {timeout:5000},async()=>{
 const f=fixture(),runtime=await createQQChannelPluginHost({env:{}}).bindChannel(binding,f.context),running=runtime.run();
 await new Promise(r=>setImmediate(r));runtime.stop();await running;await runtime.close();assert.equal(runtime.status().stopped,true);
});
test('legacy CLI disabled-plugin startup exits without contacting the configured database',t=>{
 const tempRoot=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(tempRoot,'qq-plugin-cli-'));t.after(()=>{const target=fs.realpathSync(dir);if(!target.startsWith(tempRoot+path.sep)||!path.basename(target).startsWith('qq-plugin-cli-'))throw Error('TEMP_IDENTITY_REQUIRED');fs.rmSync(target,{recursive:true});});
 const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify({enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']}));
 const r=spawnSync(process.execPath,['apps/qq-channel/src/cli.mjs',file,'--run'],{cwd:path.resolve(import.meta.dirname,'../..'),encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,AGENT_PLUGINS_DISABLED:'mooyu.qq',QQ_ADMIN_ENABLED:'false',QQ_AGENT_INTERACTIONS_ENABLED:'false',QQ_ACCESS_TOKEN:'fixture-cli-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1:1/mooyu_qq_local_plugin',PAPER_STUDY_ENABLED:'false'}});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).event,'disabled');assert.ok(!r.stdout.includes('fixture-cli-token'));
});
