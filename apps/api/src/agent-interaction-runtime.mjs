import {createAgentRuntimeServices} from './agent-runtime-services.mjs';
import {createAgentDeepSeekProviderAdapter} from './agent-deepseek-provider-adapter.mjs';
import {PostgresAgentInteractionRepository} from './agent-interaction-repository.mjs';
import {createAgentConversationExecutor,validateConversationOutput,validateConversationAttempt} from './agent-interaction-conversation.mjs';
import {createAgentInteractionWorker} from './agent-interaction-worker.mjs';
import {loadAgentInteractionConfig} from './agent-interaction-config.mjs';
import {pluginFail} from './agent-plugin-contract.mjs';

// The API accepts durable work; this separate process executes it through the
// existing Agent gateways, keys and ledgers. No channel-owned model is created.
export function createAgentInteractionRuntime({env=process.env,pool,service,practiceService,platformTools,log=()=>{},adapter=createAgentDeepSeekProviderAdapter()}){
 const config=loadAgentInteractionConfig(env);
 if(!config.enabled||!service||service.agentId!==config.agentId)throw Object.assign(new Error('AGENT_INTERACTION_RUNTIME_DISABLED'),{code:'AGENT_INTERACTION_RUNTIME_DISABLED'});
 const pluginHost=service.pluginHost;
 if(!pluginHost)pluginFail('AGENT_PLUGIN_HOST_REQUIRED');pluginHost.validateConfiguration({env,agentId:service.agentId});
 const schemas={'agent.conversation.completion@1':validateConversationOutput,'agent.conversation.attempt@1':validateConversationAttempt},pluginSchemas=pluginHost.responseSchemas();
 if(Object.keys(pluginSchemas).some(k=>Object.hasOwn(schemas,k)))pluginFail('AGENT_PLUGIN_EXPORT_COLLISION');
 const runtime=createAgentRuntimeServices({env,pool,applicationName:'mooyu-agent-interactions',
  responseSchemas:{...schemas,...pluginSchemas},toolConfiguration:pluginHost.toolConfiguration({env}),
  providerAdapter:async input=>{
   const result=await adapter(input);
   if(result.responseRef?.finishReason!=='stop')throw Object.assign(new Error('AGENT_PROVIDER_RESPONSE_TRUNCATED'),{code:'AGENT_PROVIDER_RESPONSE_TRUNCATED',acknowledged:true,usage:result.usage,providerRequestId:result.providerRequestId,responseRef:result.responseRef});
   return result;
  }});
 const repository=new PostgresAgentInteractionRepository(runtime.pool);
 const conversation=createAgentConversationExecutor({repository,service,ports:{...runtime,conversationAttempts:true},practiceService,platformTools});
 const plugins=pluginHost.bindRuntime({core:runtime,env,repository,service});
 const worker=createAgentInteractionWorker({repository,service,conversation,taskExecutor:plugins.executeTask,agentId:config.agentId,log});
 return {worker,runtime,plugins:pluginHost.status,close:async()=>{worker.stop();await plugins.close();await runtime.close();}};
}
