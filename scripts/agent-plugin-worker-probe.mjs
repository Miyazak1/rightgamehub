import {QQAgentBridge,createQQAgentClient} from '../apps/qq-channel/src/agent-bridge.mjs';
import {QQRepository} from '../apps/qq-channel/src/repository.mjs';
import {OneBotGateway} from '../apps/qq-channel/src/onebot.mjs';
import {QQService} from '../apps/qq-channel/src/service.mjs';
import {createAgentPluginHost} from '../apps/api/src/agent-plugin-host.mjs';
if(![QQAgentBridge,createQQAgentClient,QQRepository,OneBotGateway,QQService,createAgentPluginHost].every(v=>typeof v==='function'))throw Error('WORKER_IMPORT_INVALID');
console.log(JSON.stringify({moduleImportsReady:true,imageDeliverySupported:typeof QQAgentBridge.prototype.verifyImageAccess==='function',databaseConnected:false,loginConnected:false,paperEnabled:false}));
