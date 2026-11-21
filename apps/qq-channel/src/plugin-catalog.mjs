import {createAgentPluginHost} from '../../api/src/agent-plugin-host.mjs';
import {disabledAgentPlugins} from '../../api/src/agent-plugin-config.mjs';
import {qqChannelPlugin} from './plugins/qq/index.mjs';
export function createQQChannelPluginHost({env=process.env}={}){
 const disabled=disabledAgentPlugins(env);
 return createAgentPluginHost({definitions:[qqChannelPlugin],activePlugins:disabled.includes('mooyu.qq')?[]:[{id:'mooyu.qq',version:'1.0.0'}]});
}
