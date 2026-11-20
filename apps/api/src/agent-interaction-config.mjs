import {interactionUuid,interactionFail} from './agent-interaction-contracts.mjs';
export function loadAgentInteractionConfig(env={}){
 if(env.AGENT_INTERACTIONS_ENABLED!=null&&!['true','false'].includes(env.AGENT_INTERACTIONS_ENABLED))interactionFail('AGENT_INTERACTION_ENABLE_FLAG_INVALID',503);
 const enabled=env.AGENT_INTERACTIONS_ENABLED==='true',agentId=env.AGENT_INTERACTIONS_AGENT_USER_ID??env.AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID;
 if(enabled&&(!interactionUuid(agentId)||agentId!==env.AGENT_BLOG_PUBLIC_RUNTIME_AGENT_USER_ID||(env.QQ_ADMIN_ENABLED==='true'&&agentId!==env.QQ_ADMIN_AGENT_USER_ID)))interactionFail('AGENT_INTERACTION_IDENTITY_CONFIG_MISMATCH',503);
 if(enabled&&env.AGENT_BLOG_PUBLIC_RUNTIME_ENABLED!=='true')interactionFail('AGENT_INTERACTION_RUNTIME_DISABLED',503);
 if(enabled)for(const key of ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED','AGENT_PAPER_SEMANTIC_ENABLED','AGENT_PAPER_RESEARCH_WORKER_ENABLED'])if(env[key]!=null&&env[key]!=='false')interactionFail('AGENT_INTERACTION_PAPER_MUST_REMAIN_DISABLED',503);
 return {enabled,agentId};
}
