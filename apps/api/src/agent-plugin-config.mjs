import {pluginFail} from './agent-plugin-contract.mjs';
export const BUNDLED_AGENT_PLUGIN_IDS=Object.freeze(['mooyu.github','mooyu.qq']);
export function disabledAgentPlugins(env={}){
 const text=env.AGENT_PLUGINS_DISABLED??'';if(typeof text!=='string'||text.length>1024)pluginFail('AGENT_PLUGIN_CONFIGURATION_INVALID');
 const ids=text?text.split(',').map(v=>v.trim()):[];
 if(new Set(ids).size!==ids.length||ids.some(id=>!BUNDLED_AGENT_PLUGIN_IDS.includes(id)))pluginFail('AGENT_PLUGIN_CONFIGURATION_INVALID');return ids;
}
