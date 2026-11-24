import {QQ_CHANNEL_PLUGIN_MANIFEST} from './manifest.mjs';
import {createQQChannelRuntime} from './runtime.mjs';
export {QQ_CHANNEL_PLUGIN_MANIFEST,createQQChannelRuntime};
export const qqChannelPlugin=Object.freeze({manifest:QQ_CHANNEL_PLUGIN_MANIFEST,descriptions:[],workflows:[],toolContracts:[],createChannelRuntime:createQQChannelRuntime});
