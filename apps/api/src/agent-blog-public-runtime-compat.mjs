import crypto from 'node:crypto';
import {loadAgentBlogPublicRuntimeConfig} from './agent-blog-public-runtime-preflight.mjs';
import {createAgentRuntimeServices} from './agent-runtime-services.mjs';
import {createBuiltinAgentPluginHost} from './agent-plugin-catalog.mjs';
import {createGitHubRuntimePorts} from './agent-plugins/github/runtime.mjs';
import {createAgentRuntimeWorker} from './agent-runtime-worker.mjs';
import {createAgentBlogPublicRuntimeManualRunner} from './agent-blog-public-runtime-manual-run.mjs';
import {PostgresAgentBlogPublicRequestRepository} from './agent-blog-public-request-repository.mjs';
import {createAgentBlogAutonomousDiscoveryCanary} from './agent-blog-candidate-discovery.mjs';
import {createAgentBlogCandidatePublicHandoff} from './agent-blog-candidate-handoff.mjs';
import {PostgresAgentResearchEvidenceRepository} from './agent-research-evidence-repository.mjs';
import {PAPER_ANALYSIS_READ_TOOL,createPaperAnalysisReadAdapter,validatePaperAnalysisReadInput,validatePaperAnalysisReadOutput} from './agent-paper-analysis-tool.mjs';
import {PAPER_ARTICLE_RESPONSE_SCHEMAS} from './agent-paper-article-generation.mjs';
import {createAgentPaperArticleDraftHandlers} from './agent-paper-article-workflow.mjs';
import {PostgresAgentPaperSemanticRepository} from './agent-paper-semantic-repository.mjs';
import {createAgentPaperArticleManualRunner} from './agent-paper-article-manual-run.mjs';
import {createAgentPaperArticleAcceptanceService,PostgresAgentPaperArticleAcceptanceRepository} from './agent-paper-article-acceptance.mjs';

// Compatibility facade for the existing scheduled/manual public runtime.
// Shared Chat/QQ uses the neutral kernel and plugin assembly directly.
// Paper legacy entry points remain here, outside the new shared runtime.
export function createAgentBlogPublicRuntime({env=process.env,applicationName,pool:suppliedPool,additionalResponseSchemas={},providerAdapter=null}={}){
 const pluginHost=createBuiltinAgentPluginHost({env});pluginHost.requirePlugin('mooyu.github');
 const config=loadAgentBlogPublicRuntimeConfig(env);if(!config.enabled)throw new Error('AGENT_BLOG_PUBLIC_RUNTIME_DISABLED');
 const githubTools=pluginHost.toolConfiguration({env});let paperSemanticRepository;
 const core=createAgentRuntimeServices({env,pool:suppliedPool,applicationName:applicationName??'gamehub-agent-blog-public-runtime',providerAdapter,
  toolConfiguration:{adapters:{...githubTools.adapters,[`${PAPER_ANALYSIS_READ_TOOL.toolKey}@${PAPER_ANALYSIS_READ_TOOL.contractVersion}`]:input=>createPaperAnalysisReadAdapter({repository:paperSemanticRepository,agentUserId:config.agentUserId})(input)},inputSchemas:{...githubTools.inputSchemas,'paper.analysis.read.input@1':validatePaperAnalysisReadInput},outputSchemas:{...githubTools.outputSchemas,'paper.analysis.read.output@1':validatePaperAnalysisReadOutput}},
  responseSchemas:{...pluginHost.responseSchemas(),...PAPER_ARTICLE_RESPONSE_SCHEMAS,...additionalResponseSchemas}});
 const {pool,runtimeRepository,providerGateway,toolGateway,artifactRepository}=core;
 paperSemanticRepository=new PostgresAgentPaperSemanticRepository(pool);
 const interactionPorts=createGitHubRuntimePorts(core),{draftGateway,discoveryHandlers,publicationHandlers}=interactionPorts;
 const paperArticleHandlers=createAgentPaperArticleDraftHandlers({toolGateway,providerGateway,artifactRepository,draftGateway,researchEvidenceRepository:new PostgresAgentResearchEvidenceRepository(pool)});
 const worker=(requestId,runId,handlers,kind,signal)=>createAgentRuntimeWorker({repository:runtimeRepository,handlers,targetRunId:runId,recoverTargetRun:true,signal,workerId:`agent-blog-public-${kind}-${requestId}-${crypto.randomUUID()}`.slice(0,120),instanceId:crypto.randomUUID(),leaseSeconds:180,heartbeatSeconds:30,pollMilliseconds:1000,recoveryBatch:1,outboxBatch:25});
 const runner=createAgentBlogPublicRuntimeManualRunner({config,requestRepository:new PostgresAgentBlogPublicRequestRepository(pool),preflightRepository:interactionPorts.preflightRepository,inputRepository:interactionPorts.inputRepository,
  discoveryCanary:createAgentBlogAutonomousDiscoveryCanary({runtimeRepository,enabled:true}),publicHandoff:createAgentBlogCandidatePublicHandoff({runtimeRepository,artifactRepository,enabled:true}),
  createDiscoveryWorker:(runId,requestId,signal)=>worker(requestId,runId,discoveryHandlers,'discovery',signal),createPublicationWorker:(runId,requestId,signal)=>worker(requestId,runId,publicationHandlers,'publication',signal),
  readRun:async runId=>{
   const r=(await pool.query(`SELECT id,status,output_type,output_id,error_code,(SELECT count(*)::int FROM agent_run_stages WHERE run_id=agent_runs.id AND status='succeeded') AS completed_stage_count FROM agent_runs WHERE id=$1 AND agent_user_id=$2 AND workflow_key IN ('blog.project.discovery-shadow','blog.project.single')`,[runId,config.agentUserId])).rows[0];
   return r?{id:r.id,status:r.status,outputType:r.output_type,outputId:r.output_id,errorCode:r.error_code,completedStageCount:r.completed_stage_count}:null;
  }});
 const paperArticleRunner=createAgentPaperArticleManualRunner({config,inputRepository:interactionPorts.inputRepository,runtimeRepository,
  createWorker:(runId,requestId)=>worker(requestId,runId,paperArticleHandlers,'paper-article'),
  readRun:async runId=>{const r=(await pool.query('SELECT id,status,output_type,output_id,error_code FROM agent_runs WHERE id=$1 AND agent_user_id=$2',[runId,config.agentUserId])).rows[0];return r?{id:r.id,status:r.status,outputType:r.output_type,outputId:r.output_id,errorCode:r.error_code}:null;}});
 const paperArticleAcceptance=createAgentPaperArticleAcceptanceService({paperArticleRunner,repository:new PostgresAgentPaperArticleAcceptanceRepository(pool)});
 return Object.freeze({config,pool,runner,paperArticleRunner,paperArticleAcceptance,interactionPorts,close:core.close});
}
