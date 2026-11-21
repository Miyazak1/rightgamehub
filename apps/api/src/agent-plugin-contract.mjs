export const AGENT_PLUGIN_PROTOCOL_VERSION=1;
export class AgentPluginError extends Error{
 constructor(code,{retryable=false}={}){super(code);this.code=code;this.statusCode=503;this.retryable=retryable;}
}
export const pluginFail=(code,options)=>{throw new AgentPluginError(code,options);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(v)&&v.length<=100;
const version=v=>typeof v==='string'&&/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(v)&&v.length<=40;
const name=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{1,79}$/u.test(v);
const unique=(items,key)=>new Set(items.map(key)).size===items.length;
export function normalizePluginBinding(v){
 if(!exact(v,['id','version'])||!id(v.id)||!version(v.version))pluginFail('AGENT_PLUGIN_BINDING_INVALID');return {id:v.id,version:v.version};
}
export function normalizeAgentPluginManifest(v){
 const keys=['schemaVersion','id','version','hostApiVersion','kind','displayName','defaultEnabled','dependencies','capabilities','tools','backendTools','taskKinds','workflows','publicCapabilities','legacyTaskKinds'];
 if(!exact(v,keys)||v.schemaVersion!=='agent-plugin-v1'||v.hostApiVersion!==AGENT_PLUGIN_PROTOCOL_VERSION||!id(v.id)||!version(v.version)||!['capability','channel','agent','presentation'].includes(v.kind)||typeof v.displayName!=='string'||!v.displayName.trim()||v.displayName.length>120||typeof v.defaultEnabled!=='boolean')pluginFail('AGENT_PLUGIN_MANIFEST_INVALID');
 for(const key of ['dependencies','capabilities','tools','backendTools','taskKinds','workflows','publicCapabilities','legacyTaskKinds'])if(!Array.isArray(v[key])||v[key].length>64)pluginFail('AGENT_PLUGIN_MANIFEST_INVALID');
 v.dependencies.forEach(normalizePluginBinding);
 if(!unique(v.dependencies,d=>d.id+'@'+d.version)||v.dependencies.some(d=>d.id===v.id))pluginFail('AGENT_PLUGIN_DEPENDENCY_INVALID');
 for(const c of v.capabilities)if(!exact(c,['key','version'])||!id(c.key)||!Number.isSafeInteger(c.version)||c.version<1)pluginFail('AGENT_PLUGIN_CAPABILITY_INVALID');
 if(!unique(v.capabilities,c=>c.key+'@'+c.version))pluginFail('AGENT_PLUGIN_CAPABILITY_INVALID');
 if(v.tools.some(t=>!name(t)||t==='get_agent_work')||!unique(v.tools,x=>x)||v.publicCapabilities.some(t=>!name(t))||!unique(v.publicCapabilities,x=>x))pluginFail('AGENT_PLUGIN_TOOL_INVALID');
 for(const t of v.taskKinds)if(!exact(t,['kind','requiresInvoke'])||!name(t.kind)||t.kind==='message'||typeof t.requiresInvoke!=='boolean')pluginFail('AGENT_PLUGIN_TASK_KIND_INVALID');
 if(!unique(v.taskKinds,t=>t.kind)||v.legacyTaskKinds.some(k=>!v.taskKinds.some(t=>t.kind===k))||!unique(v.legacyTaskKinds,x=>x))pluginFail('AGENT_PLUGIN_TASK_KIND_INVALID');
 for(const w of v.workflows)if(!exact(w,['key','version'])||!id(w.key)||!Number.isSafeInteger(w.version)||w.version<1)pluginFail('AGENT_PLUGIN_WORKFLOW_INVALID');
 for(const t of v.backendTools)if(!exact(t,['key','version'])||!id(t.key)||!Number.isSafeInteger(t.version)||t.version<1)pluginFail('AGENT_PLUGIN_TOOL_INVALID');
 if(!unique(v.backendTools,t=>t.key+'@'+t.version))pluginFail('AGENT_PLUGIN_TOOL_INVALID');
 if(!unique(v.workflows,w=>w.key+'@'+w.version)||Buffer.byteLength(JSON.stringify(v))>32768)pluginFail('AGENT_PLUGIN_MANIFEST_INVALID');
 return structuredClone(v);
}
export const pluginBindingKey=v=>{const b=normalizePluginBinding(v);return b.id+'@'+b.version;};
