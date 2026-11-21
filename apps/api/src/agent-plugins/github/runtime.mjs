import {loadAgentBlogPublicRuntimeConfig,PostgresAgentBlogPublicRuntimePreflightRepository} from '../../agent-blog-public-runtime-preflight.mjs';
import {PostgresAgentBlogPrivateCanaryInputRepository} from '../../agent-blog-private-canary-manual-run.mjs';
import {createAgentBlogAutonomousCandidateDiscoveryHandlers} from '../../agent-blog-candidate-discovery.mjs';
import {PostgresAgentBlogFoundationDraftRepository} from '../../agent-blog-foundation-draft-repository.mjs';
import {createAgentBlogFoundationDraftGateway} from '../../agent-blog-foundation-draft.mjs';
import {PostgresAgentBlogFoundationPublicationRepository} from '../../agent-blog-foundation-publication-repository.mjs';
import {createAgentBlogFoundationPublicationGateway} from '../../agent-blog-foundation-publication.mjs';
import {createAgentBlogFoundationPublicHandlers} from '../../agent-blog-foundation-shadow.mjs';
import {PostgresAgentResearchEvidenceRepository} from '../../agent-research-evidence-repository.mjs';

export function createGitHubRuntimePorts(core){
 const {pool,runtimeRepository,policyService,toolGateway,providerGateway,artifactRepository}=core;
 const discoveryHandlers=createAgentBlogAutonomousCandidateDiscoveryHandlers({providerGateway,toolGateway,artifactRepository});
 const draftGateway=createAgentBlogFoundationDraftGateway({runtimeRepository,draftRepository:new PostgresAgentBlogFoundationDraftRepository(pool,{requireResearchEvidence:true}),policyService});
 const publicationGateway=createAgentBlogFoundationPublicationGateway({runtimeRepository,publicationRepository:new PostgresAgentBlogFoundationPublicationRepository(pool),policyService});
 const researchEvidenceRepository=new PostgresAgentResearchEvidenceRepository(pool);
 const publicationHandlers=createAgentBlogFoundationPublicHandlers({toolGateway,providerGateway,artifactRepository,draftGateway,publicationGateway,researchEvidenceRepository});
 return Object.freeze({runtimeRepository,providerGateway,toolGateway,artifactRepository,draftGateway,publicationGateway,discoveryHandlers,publicationHandlers,
  inputRepository:new PostgresAgentBlogPrivateCanaryInputRepository(pool),preflightRepository:new PostgresAgentBlogPublicRuntimePreflightRepository(pool),researchEvidenceRepository});
}
export function createGitHubPluginRuntime({core,env}){
 const config=loadAgentBlogPublicRuntimeConfig(env);if(!config.enabled)throw Object.assign(new Error('AGENT_BLOG_PUBLIC_RUNTIME_DISABLED'),{code:'AGENT_BLOG_PUBLIC_RUNTIME_DISABLED'});
 return {config,pool:core.pool,interactionPorts:createGitHubRuntimePorts(core)};
}
export function validateGitHubPluginConfiguration({env,agentId}){
 const config=loadAgentBlogPublicRuntimeConfig(env);
 if(!config.enabled||config.agentUserId!==agentId)throw Object.assign(new Error('AGENT_PLUGIN_CONFIGURATION_INVALID'),{code:'AGENT_PLUGIN_CONFIGURATION_INVALID'});
}
