import {createAgentPluginHost} from './agent-plugin-host.mjs';
import {pluginFail} from './agent-plugin-contract.mjs';
import {githubAgentPlugin} from './agent-plugins/github/index.mjs';

// A reviewed, in-repository catalog. No dynamic paths, downloads, installs or
// capability grants are inferred from environment strings or plugin metadata.
export function createBuiltinAgentPluginHost({env=process.env}={}){
 const definitions=[githubAgentPlugin],text=env.AGENT_PLUGINS_DISABLED??'';
 if(typeof text!=='string'||text.length>1024)pluginFail('AGENT_PLUGIN_CONFIGURATION_INVALID');
 const disabled=text?text.split(',').map(x=>x.trim()):[];
 if(disabled.some(id=>!definitions.some(d=>d.manifest.id===id))||new Set(disabled).size!==disabled.length)pluginFail('AGENT_PLUGIN_CONFIGURATION_INVALID');
 return createAgentPluginHost({definitions,activePlugins:definitions.filter(d=>d.manifest.defaultEnabled&&!disabled.includes(d.manifest.id)).map(d=>({id:d.manifest.id,version:d.manifest.version}))});
}
