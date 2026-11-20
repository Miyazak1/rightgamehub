import {AGENT_CONVERSATION_WORKFLOW,AGENT_GITHUB_INSPECT_WORKFLOW} from './agent-interaction-contracts.mjs';
import {BLOG_PROJECT_SINGLE_INTERACTION_DRAFT_WORKFLOW} from './agent-blog-foundation-workflows.mjs';
import {GITHUB_QUESTION_WORKFLOW} from './agent-github-question.mjs';
import {GITHUB_CODE_TOOL} from './agent-github-code-tool.mjs';
import {PostgresAgentToolGatewayRepository} from './agent-tool-gateway-repository.mjs';
export async function bootstrapAgentInteractions({repository,runtimeRepository,agentId}){
 const agent=await repository.agent(agentId),workflows=[];
 await new PostgresAgentToolGatewayRepository(repository.pool).registerTool(GITHUB_CODE_TOOL);
 for(const manifest of [AGENT_CONVERSATION_WORKFLOW,AGENT_GITHUB_INSPECT_WORKFLOW,BLOG_PROJECT_SINGLE_INTERACTION_DRAFT_WORKFLOW,GITHUB_QUESTION_WORKFLOW]){
  const registered=await runtimeRepository.registerWorkflow({actorUserId:agent.operator_user_id,manifest,status:'draft'});
  if(registered.status==='draft')await runtimeRepository.activateWorkflow(manifest.workflowKey,manifest.workflowVersion);
  workflows.push({key:manifest.workflowKey,version:manifest.workflowVersion});
 }
 return {agentId,workflows,grantsChanged:false,scheduleChanged:false,providerInvoked:false,paperEnabled:false};
}
