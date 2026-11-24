import {createQQChannelPluginHost} from '../apps/qq-channel/src/plugin-catalog.mjs';
import {parseConfig} from '../apps/qq-channel/src/config.mjs';
const config=parseConfig({enabled:true,botId:'100000001',groupId:'100000002',allowedUsers:['100000003']},{QQ_ACCESS_TOKEN:'offline-probe-token-'.repeat(3),QQ_DATABASE_URL:'postgresql://127.0.0.1/mooyu_qq_local_probe'});
const host=createQQChannelPluginHost({env:{AGENT_PLUGINS_DISABLED:'mooyu.github'}});
const runtime=await host.bindChannel({id:'mooyu.qq',version:'1.0.0'},{config,pool:{query(){throw Error('UNEXPECTED_DATABASE_ACCESS');},end(){throw Error('UNEXPECTED_POOL_CLOSE');}},managed:true,useAgent:true});
const status=runtime.status();await runtime.close();
console.log(JSON.stringify({plugins:host.status(),constructed:true,started:status.started,executionMode:status.executionMode,databaseConnected:false,loginConnected:false,paperEnabled:false}));
