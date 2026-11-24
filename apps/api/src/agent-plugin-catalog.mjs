import {createAgentPluginHost} from './agent-plugin-host.mjs';
import {githubAgentPlugin} from './agent-plugins/github/index.mjs';
import {disabledAgentPlugins} from './agent-plugin-config.mjs';

// A reviewed, in-repository catalog. No dynamic paths, downloads, installs or
// capability grants are inferred from environment strings or plugin metadata.
export function createBuiltinAgentPluginHost({env=process.env}={}){
 const definitions=[githubAgentPlugin],disabled=disabledAgentPlugins(env);
 return createAgentPluginHost({definitions,activePlugins:definitions.filter(d=>d.manifest.defaultEnabled&&!disabled.includes(d.manifest.id)).map(d=>({id:d.manifest.id,version:d.manifest.version}))});
}
