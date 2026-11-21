import {AGENT_CONVERSATION_WORKFLOW,AGENT_CONVERSATION_ATTEMPT_WORKFLOW} from './agent-interaction-contracts.mjs';
import {createBuiltinAgentPluginHost} from './agent-plugin-catalog.mjs';
import {PostgresAgentToolGatewayRepository} from './agent-tool-gateway-repository.mjs';
export async function bootstrapAgentInteractions({repository,runtimeRepository,agentId,pluginHost=createBuiltinAgentPluginHost()}){
 const agent=await repository.agent(agentId),workflows=[];
 const toolRepository=new PostgresAgentToolGatewayRepository(repository.pool),plugins=pluginHost.exports();
 for(const plugin of plugins)for(const contract of plugin.toolContracts)await toolRepository.registerTool(contract);
 for(const manifest of [AGENT_CONVERSATION_WORKFLOW,AGENT_CONVERSATION_ATTEMPT_WORKFLOW,...plugins.flatMap(p=>p.workflows)]){
  const registered=await runtimeRepository.registerWorkflow({actorUserId:agent.operator_user_id,manifest,status:'draft'});
  if(registered.status==='draft')await runtimeRepository.activateWorkflow(manifest.workflowKey,manifest.workflowVersion);
  workflows.push({key:manifest.workflowKey,version:manifest.workflowVersion});
 }
 return {agentId,workflows,plugins:pluginHost.status(),grantsChanged:false,scheduleChanged:false,providerInvoked:false,paperEnabled:false};
}
