import {INTERACTION_GITHUB_TOOLS,AGENT_GITHUB_INSPECT_WORKFLOW} from '../../agent-interaction-contracts.mjs';
import {BLOG_PROJECT_SINGLE_INTERACTION_DRAFT_WORKFLOW} from '../../agent-blog-foundation-workflows.mjs';
import {GITHUB_QUESTION_WORKFLOW,GITHUB_QUESTION_SCHEMAS,createAgentGitHubQuestionExecutor} from '../../agent-github-question.mjs';
import {createAgentGitHubInteractionExecutor} from '../../agent-interaction-github.mjs';
import {BLOG_DISCOVERY_RESPONSE_SCHEMAS} from '../../agent-blog-candidate-discovery.mjs';
import {BLOG_FOUNDATION_RESPONSE_SCHEMAS} from '../../agent-blog-foundation-generation.mjs';
import {admitGitHubTask} from './admission.mjs';
import {githubToolContracts,createGitHubToolConfiguration} from './tools.mjs';
import {createGitHubPluginRuntime,validateGitHubPluginConfiguration} from './runtime.mjs';
import {normalizeGitHubResearchToken} from '../../agent-github-research-runtime.mjs';

export const GITHUB_PLUGIN_MANIFEST=Object.freeze({schemaVersion:'agent-plugin-v1',id:'mooyu.github',version:'1.0.0',hostApiVersion:1,kind:'capability',displayName:'GitHub 项目研究',defaultEnabled:true,dependencies:[],
 capabilities:[{key:'research.github.read',version:1},{key:'research.github.discover',version:1},{key:'provider.text.generate',version:1},{key:'blog.article.draft',version:1},{key:'blog.article.publish',version:1}],
 tools:['github_answer_question','github_search_projects','github_write_article'],
 backendTools:githubToolContracts.map(c=>({key:c.toolKey,version:c.contractVersion})),
 taskKinds:[{kind:'github-question',requiresInvoke:false},{kind:'github-search',requiresInvoke:false},{kind:'github-article',requiresInvoke:true}],
 workflows:[{key:'agent.github.inspect',version:1},{key:'blog.project.single.draft-shadow',version:3},{key:'agent.github.question',version:2}],
 publicCapabilities:['github-research','github-writing'],legacyTaskKinds:['github-question','github-search','github-article']});
export const githubAgentPlugin=Object.freeze({
 manifest:GITHUB_PLUGIN_MANIFEST,
 descriptions:INTERACTION_GITHUB_TOOLS.filter(t=>t.name!=='get_agent_work'),
 workflows:[AGENT_GITHUB_INSPECT_WORKFLOW,BLOG_PROJECT_SINGLE_INTERACTION_DRAFT_WORKFLOW,GITHUB_QUESTION_WORKFLOW],
 toolContracts:githubToolContracts,responseSchemas:{...BLOG_DISCOVERY_RESPONSE_SCHEMAS,...BLOG_FOUNDATION_RESPONSE_SCHEMAS,...GITHUB_QUESTION_SCHEMAS},
 toolConfiguration:({env})=>createGitHubToolConfiguration({githubToken:normalizeGitHubResearchToken(env.AGENT_GITHUB_RESEARCH_TOKEN)}),admit:admitGitHubTask,createRuntime:createGitHubPluginRuntime,validateConfiguration:validateGitHubPluginConfiguration,
 async executeTask(row,options,{repository,service,runtime,assertAvailable}){
  const scopedService={...service,authorize:async(...args)=>{assertAvailable();return service.authorize(...args);}};
  const executor=row.kind==='github-question'?createAgentGitHubQuestionExecutor({repository,service:scopedService,ports:runtime.interactionPorts}):createAgentGitHubInteractionExecutor({repository,service:scopedService,runtime});
  assertAvailable();return executor(row,options);
 },
});
