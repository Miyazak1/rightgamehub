import {normalizeAgentPluginManifest,normalizePluginBinding,pluginBindingKey,pluginFail} from './agent-plugin-contract.mjs';

// Trusted, bundled code only. This registry is an assembly and lifecycle
// boundary, not a sandbox for downloaded Node.js modules.
export function createAgentPluginHost({definitions=[],activePlugins=null}={}){
 const entries=new Map(),families=new Map(),owners={tools:new Map(),kinds:new Map(),contracts:new Map(),workflows:new Map()},legacy=new Map();
 for(const definition of definitions){
  const manifest=normalizeAgentPluginManifest(definition.manifest),key=pluginBindingKey({id:manifest.id,version:manifest.version});
  if(entries.has(key))pluginFail('AGENT_PLUGIN_DUPLICATE');
  if(typeof definition.admit!=='function'||typeof definition.executeTask!=='function'||!Array.isArray(definition.descriptions)||!Array.isArray(definition.workflows)||!Array.isArray(definition.toolContracts))pluginFail('AGENT_PLUGIN_DEFINITION_INVALID');
  if(definition.descriptions.length!==manifest.tools.length||definition.descriptions.some(d=>!manifest.tools.includes(d.name))||new Set(definition.descriptions.map(d=>d.name)).size!==manifest.tools.length)pluginFail('AGENT_PLUGIN_EXPORT_MISMATCH');
  if(definition.workflows.length!==manifest.workflows.length||manifest.workflows.some(w=>!definition.workflows.some(m=>m.workflowKey===w.key&&m.workflowVersion===w.version))||definition.workflows.some(w=>w.requiredCapabilities?.some(c=>!manifest.capabilities.some(m=>m.key===c.key&&m.version===c.version))))pluginFail('AGENT_PLUGIN_EXPORT_MISMATCH');
  if(definition.toolContracts.length!==manifest.backendTools.length||manifest.backendTools.some(t=>!definition.toolContracts.some(c=>c.toolKey===t.key&&c.contractVersion===t.version))||definition.toolContracts.some(t=>!manifest.capabilities.some(c=>c.key===t.capabilityKey&&c.version===t.contractVersion)))pluginFail('AGENT_PLUGIN_EXPORT_MISMATCH');
  const entry={manifest,definition};entries.set(key,entry);if(!families.has(manifest.id))families.set(manifest.id,[]);families.get(manifest.id).push(entry);
  for(const [map,names]of [[owners.tools,manifest.tools],[owners.kinds,manifest.taskKinds.map(t=>t.kind)],[owners.contracts,manifest.backendTools.map(t=>t.key+'@'+t.version)],[owners.workflows,manifest.workflows.map(w=>w.key+'@'+w.version)]])for(const n of names){if(map.has(n)&&map.get(n)!==manifest.id)pluginFail('AGENT_PLUGIN_EXPORT_COLLISION');map.set(n,manifest.id);}
  for(const kind of manifest.legacyTaskKinds){if(legacy.has(kind))pluginFail('AGENT_PLUGIN_LEGACY_COLLISION');legacy.set(kind,{id:manifest.id,version:manifest.version});}
 }
 const visiting=new Set(),visited=new Set();
 function visit(key){if(visiting.has(key))pluginFail('AGENT_PLUGIN_DEPENDENCY_CYCLE');if(visited.has(key))return;const entry=entries.get(key);if(!entry)pluginFail('AGENT_PLUGIN_DEPENDENCY_MISSING');visiting.add(key);entry.manifest.dependencies.forEach(b=>visit(pluginBindingKey(b)));visiting.delete(key);visited.add(key);}
 entries.forEach((_v,k)=>visit(k));
 const selected=new Map(),enabled=new Set();
 for(const raw of activePlugins??definitions.filter(d=>d.manifest.defaultEnabled).map(d=>({id:d.manifest.id,version:d.manifest.version}))){const b=normalizePluginBinding(raw);if(!entries.has(pluginBindingKey(b)))pluginFail('AGENT_PLUGIN_VERSION_UNAVAILABLE');if(selected.has(b.id))pluginFail('AGENT_PLUGIN_ACTIVE_VERSION_CONFLICT');selected.set(b.id,b);enabled.add(b.id);}
 // Disabled installed plugins retain an explicit version for later re-enable.
 for(const [id,list]of families)if(!selected.has(id)){if(list.length!==1)pluginFail('AGENT_PLUGIN_ACTIVE_VERSION_REQUIRED');selected.set(id,{id,version:list[0].manifest.version});}
 function assertAvailable(raw){const b=normalizePluginBinding(raw),entry=entries.get(pluginBindingKey(b));if(!entry)pluginFail('AGENT_PLUGIN_VERSION_UNAVAILABLE',{retryable:true});if(!enabled.has(b.id))pluginFail('AGENT_PLUGIN_DISABLED',{retryable:true});for(const dep of entry.manifest.dependencies)assertAvailable(dep);return entry;}
 for(const id of enabled)assertAvailable(selected.get(id));
 function resolveTask(row){const raw=row.input_json?.plugin??legacy.get(row.kind);if(!raw)pluginFail('AGENT_PLUGIN_TASK_UNBOUND',{retryable:true});const b=normalizePluginBinding(raw),entry=assertAvailable(b);if(!entry.manifest.taskKinds.some(t=>t.kind===row.kind)||owners.kinds.get(row.kind)!==b.id)pluginFail('AGENT_PLUGIN_TASK_BINDING_MISMATCH');return {binding:b,entry};}
 const activeEntries=()=>[...enabled].map(id=>assertAvailable(selected.get(id)));
 const merge=objects=>{const out={};for(const object of objects)for(const [key,value]of Object.entries(object??{})){if(Object.hasOwn(out,key))pluginFail('AGENT_PLUGIN_EXPORT_COLLISION');out[key]=value;}return out;};
 return {
  status:()=>[...entries.values()].map(({manifest:m})=>({id:m.id,version:m.version,kind:m.kind,enabled:enabled.has(m.id),activeVersion:selected.get(m.id)?.version===m.version,hostApiVersion:m.hostApiVersion})),
  descriptions:()=>activeEntries().flatMap(e=>structuredClone(e.definition.descriptions)),
  publicCapabilities:()=>[...new Set(activeEntries().flatMap(e=>e.manifest.publicCapabilities))],
  requiredWorkflows:()=>activeEntries().flatMap(e=>structuredClone(e.manifest.workflows)),
  requirePlugin(id){const b=selected.get(id);if(!b)pluginFail('AGENT_PLUGIN_NOT_INSTALLED');assertAvailable(b);return {...b};},
  exports:()=>activeEntries().map(e=>({binding:{id:e.manifest.id,version:e.manifest.version},workflows:e.definition.workflows,toolContracts:e.definition.toolContracts})),
  responseSchemas:()=>merge(activeEntries().map(e=>e.definition.responseSchemas)),
  validateConfiguration:context=>{for(const e of activeEntries())e.definition.validateConfiguration?.(context);},
  toolConfiguration:context=>{
   const all=activeEntries().map(e=>e.definition.toolConfiguration?.(context)??{});
   return {adapters:merge(all.map(c=>c.adapters)),inputSchemas:merge(all.map(c=>c.inputSchemas)),outputSchemas:merge(all.map(c=>c.outputSchemas))};
  },
  setEnabled(id,value){
   if(!families.has(id)||typeof value!=='boolean')pluginFail('AGENT_PLUGIN_NOT_INSTALLED');
   if(!value){for(const active of activeEntries())if(active.manifest.id!==id&&active.manifest.dependencies.some(d=>d.id===id))pluginFail('AGENT_PLUGIN_DEPENDENCY_IN_USE');enabled.delete(id);}
   else{enabled.add(id);try{assertAvailable(selected.get(id));}catch(e){enabled.delete(id);throw e;}}
  },
  taskPolicy(row){const {entry}=resolveTask(row);return entry.manifest.taskKinds.find(t=>t.kind===row.kind);},
  async admit(name,args,context){
   const id=owners.tools.get(name);if(!id)return null;const binding=selected.get(id),{definition,manifest}=assertAvailable(binding);
   const task=await definition.admit(name,args,context);if(task.error)return {name,...task};
   assertAvailable(binding);if(!manifest.taskKinds.some(t=>t.kind===task.kind))pluginFail('AGENT_PLUGIN_TASK_KIND_INVALID');
   return {task:{...task,plugin:{...binding}},binding:{...binding}};
  },
  bindRuntime(context){
   const runtimes=new Map();
   return {async executeTask(row,options){
    const {entry,binding}=resolveTask(row),key=pluginBindingKey(binding);if(!runtimes.has(key))runtimes.set(key,entry.definition.createRuntime?.(context)??{});
    return entry.definition.executeTask(row,options,{...context,runtime:runtimes.get(key),assertAvailable:()=>resolveTask(row)});
   },async close(){for(const runtime of runtimes.values())await runtime.close?.();runtimes.clear();}};
  },
 };
}
