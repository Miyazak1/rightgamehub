import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAgentPluginManifest} from '../../apps/api/src/agent-plugin-contract.mjs';
import {createAgentPluginHost} from '../../apps/api/src/agent-plugin-host.mjs';
import {createBuiltinAgentPluginHost} from '../../apps/api/src/agent-plugin-catalog.mjs';
import {GITHUB_PLUGIN_MANIFEST} from '../../apps/api/src/agent-plugins/github/index.mjs';
const binding=(id='test.alpha',version='1.0.0')=>({id,version});
function plugin({id='test.alpha',version='1.0.0',dependencies=[],enabled=true,legacy=true,...overrides}={}){
 const suffix=id.split('.').at(-1),name=suffix+'_tool',kind=suffix+'-task';
 return {manifest:{schemaVersion:'agent-plugin-v1',id,version,hostApiVersion:1,kind:'capability',displayName:suffix,defaultEnabled:enabled,dependencies,capabilities:[],tools:[name],backendTools:[],taskKinds:[{kind,requiresInvoke:false}],workflows:[],publicCapabilities:[suffix+'-research'],legacyTaskKinds:legacy?[kind]:[]},descriptions:[{name,arguments:{},purpose:'fixture'}],workflows:[],toolContracts:[],admit:async()=>({kind,topic:'fixture'}),executeTask:async()=>({usedVersion:version}),...overrides};
}
const row=(version='1.0.0')=>({kind:'alpha-task',input_json:{topic:'unchanged',plugin:binding('test.alpha',version)}});
test('plugin manifests reject incompatible protocols, undeclared fields and reserved core tools',()=>{
 assert.equal(normalizeAgentPluginManifest(GITHUB_PLUGIN_MANIFEST).id,'mooyu.github');
 for(const change of [{hostApiVersion:2},{version:'latest'},{entry:'file:///arbitrary.mjs'},{tools:['get_agent_work']},{taskKinds:[{kind:'message',requiresInvoke:false}]},{dependencies:[{id:'test.dep',version:'*'}]}])assert.throws(()=>normalizeAgentPluginManifest({...plugin().manifest,...change}));
});
test('registry rejects duplicate ownership and missing or cyclic dependencies before loading code',()=>{
 assert.throws(()=>createAgentPluginHost({definitions:[plugin(),plugin()]}),{code:'AGENT_PLUGIN_DUPLICATE'});
 const b=plugin({id:'test.beta'});b.manifest.tools=['alpha_tool'];b.descriptions=[{name:'alpha_tool'}];assert.throws(()=>createAgentPluginHost({definitions:[plugin(),b]}),{code:'AGENT_PLUGIN_EXPORT_COLLISION'});
 assert.throws(()=>createAgentPluginHost({definitions:[plugin({dependencies:[binding('test.missing')]})]}),{code:'AGENT_PLUGIN_DEPENDENCY_MISSING'});
 assert.throws(()=>createAgentPluginHost({definitions:[plugin({dependencies:[binding('test.beta')]}),plugin({id:'test.beta',dependencies:[binding()]})]}),{code:'AGENT_PLUGIN_DEPENDENCY_CYCLE'});
});
test('enable is separate from installation and does not silently enable dependencies',()=>{
 const alpha=plugin({enabled:false}),beta=plugin({id:'test.beta',enabled:false,dependencies:[binding()]});const h=createAgentPluginHost({definitions:[alpha,beta]});
 assert.deepEqual(h.descriptions(),[]);assert.throws(()=>h.setEnabled('test.beta',true),{code:'AGENT_PLUGIN_DISABLED'});
 h.setEnabled('test.alpha',true);h.setEnabled('test.beta',true);assert.equal(h.descriptions().length,2);
 assert.throws(()=>h.setEnabled('test.alpha',false),{code:'AGENT_PLUGIN_DEPENDENCY_IN_USE'});h.setEnabled('test.beta',false);h.setEnabled('test.alpha',false);assert.deepEqual(h.descriptions(),[]);
});
test('new admission pins a version; retained and unbound legacy tasks keep their exact old version',async()=>{
 const old=plugin(),next=plugin({version:'2.0.0',enabled:false,legacy:false});const h=createAgentPluginHost({definitions:[old,next],activePlugins:[binding('test.alpha','2.0.0')]});
 const accepted=await h.admit('alpha_tool',{},{});assert.deepEqual(accepted.task.plugin,binding('test.alpha','2.0.0'));
 const runtime=h.bindRuntime({});assert.equal((await runtime.executeTask(row(),{})).usedVersion,'1.0.0');assert.equal((await runtime.executeTask({kind:'alpha-task',input_json:{topic:'old'}},{})).usedVersion,'1.0.0');
 const original=row('9.0.0'),before=structuredClone(original);await assert.rejects(runtime.executeTask(original,{}),e=>e.code==='AGENT_PLUGIN_VERSION_UNAVAILABLE'&&e.retryable);assert.deepEqual(original,before);
 await assert.rejects(runtime.executeTask({...row(),kind:'other-task'},{}),{code:'AGENT_PLUGIN_TASK_BINDING_MISMATCH'});
});
test('disable prevents admission and further execution without loading or deleting retained tasks',async()=>{
 let loaded=0,closed=0;const d=plugin({createRuntime:()=>{loaded++;return {close:async()=>closed++};}}),h=createAgentPluginHost({definitions:[d]}),r=h.bindRuntime({});
 await r.executeTask(row(),{});await r.executeTask(row(),{});assert.equal(loaded,1);h.setEnabled('test.alpha',false);
 await assert.rejects(h.admit('alpha_tool',{},{}),e=>e.code==='AGENT_PLUGIN_DISABLED'&&e.retryable);await assert.rejects(r.executeTask(row(),{}),{code:'AGENT_PLUGIN_DISABLED'});assert.equal(loaded,1);
 h.setEnabled('test.alpha',true);assert.equal((await r.executeTask(row(),{})).usedVersion,'1.0.0');await r.close();assert.equal(closed,1);
});
test('revocation during asynchronous admission or a task stage is rechecked',async()=>{
 let release,entered;const wait=()=>new Promise(r=>{release=r;entered=true;});
 const d=plugin({admit:async()=>{await wait();return {kind:'alpha-task'};},executeTask:async(_row,_options,context)=>{await wait();context.assertAvailable();return {done:true};}}),h=createAgentPluginHost({definitions:[d]});
 const admission=h.admit('alpha_tool',{},{});assert.ok(entered);h.setEnabled('test.alpha',false);release();await assert.rejects(admission,{code:'AGENT_PLUGIN_DISABLED'});
 h.setEnabled('test.alpha',true);entered=false;const task=h.bindRuntime({}).executeTask(row(),{});assert.ok(entered);h.setEnabled('test.alpha',false);release();await assert.rejects(task,{code:'AGENT_PLUGIN_DISABLED'});
});
test('export collisions and undeclared workflows fail closed rather than replacing host validators',()=>{
 const a=plugin({responseSchemas:{'test.answer@1':v=>v}}),b=plugin({id:'test.beta',responseSchemas:{'test.answer@1':v=>v}});
 assert.throws(()=>createAgentPluginHost({definitions:[a,b]}).responseSchemas(),{code:'AGENT_PLUGIN_EXPORT_COLLISION'});
 assert.throws(()=>createAgentPluginHost({definitions:[plugin({workflows:[{workflowKey:'undeclared.workflow',workflowVersion:1}]})]}),{code:'AGENT_PLUGIN_EXPORT_MISMATCH'});
});
test('builtin catalog preserves GitHub by default and disables only that capability',async()=>{
 const enabled=createBuiltinAgentPluginHost({env:{}});assert.equal(enabled.descriptions().length,3);assert.equal(enabled.taskPolicy({kind:'github-article',input_json:{}}).requiresInvoke,true);
 const disabled=createBuiltinAgentPluginHost({env:{AGENT_PLUGINS_DISABLED:'mooyu.github'}});assert.deepEqual(disabled.descriptions(),[]);assert.deepEqual(disabled.requiredWorkflows(),[]);assert.deepEqual(disabled.toolConfiguration({env:{}}),{adapters:{},inputSchemas:{},outputSchemas:{}});
 await assert.rejects(disabled.admit('github_write_article',{},{row:{}}),{code:'AGENT_PLUGIN_DISABLED'});
 for(const value of ['unknown.plugin','mooyu.github,mooyu.github',',mooyu.github'])assert.throws(()=>createBuiltinAgentPluginHost({env:{AGENT_PLUGINS_DISABLED:value}}),{code:'AGENT_PLUGIN_CONFIGURATION_INVALID'});
});
