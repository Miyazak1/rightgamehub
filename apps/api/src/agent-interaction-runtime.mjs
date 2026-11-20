import {createAgentBlogPublicRuntime} from './agent-blog-public-runtime.mjs';
import {createAgentDeepSeekProviderAdapter} from './agent-deepseek-provider-adapter.mjs';
import {PostgresAgentInteractionRepository} from './agent-interaction-repository.mjs';
import {createAgentConversationExecutor,validateConversationOutput} from './agent-interaction-conversation.mjs';
import {createAgentGitHubInteractionExecutor} from './agent-interaction-github.mjs';
import {createAgentInteractionWorker} from './agent-interaction-worker.mjs';
import {loadAgentInteractionConfig} from './agent-interaction-config.mjs';

// The API accepts durable work; this separate process executes it through the
// existing Agent gateways, keys and ledgers. No channel-owned model is created.
export function createAgentInteractionRuntime({env=process.env,pool,service,practiceService,platformTools,log=()=>{},adapter=createAgentDeepSeekProviderAdapter()}){
 const config=loadAgentInteractionConfig(env);
 if(!config.enabled||!service||service.agentId!==config.agentId)throw Object.assign(new Error('AGENT_INTERACTION_RUNTIME_DISABLED'),{code:'AGENT_INTERACTION_RUNTIME_DISABLED'});
 const runtime=createAgentBlogPublicRuntime({env,pool,applicationName:'mooyu-agent-interactions',
  additionalResponseSchemas:{'agent.conversation.completion@1':validateConversationOutput},
  providerAdapter:async input=>{
   const result=await adapter(input);
   if(result.responseRef?.finishReason!=='stop')throw Object.assign(new Error('AGENT_PROVIDER_RESPONSE_TRUNCATED'),{code:'AGENT_PROVIDER_RESPONSE_TRUNCATED',acknowledged:true,usage:result.usage,providerRequestId:result.providerRequestId,responseRef:result.responseRef});
   return result;
  }});
 const repository=new PostgresAgentInteractionRepository(runtime.pool);
 const conversation=createAgentConversationExecutor({repository,service,ports:runtime.interactionPorts,practiceService,platformTools});
 const github=createAgentGitHubInteractionExecutor({repository,service,runtime});
 const worker=createAgentInteractionWorker({repository,service,conversation,github,agentId:config.agentId,log});
 return {worker,runtime,close:async()=>{worker.stop();await runtime.close();}};
}
