import {normalizeGitHubRepositoryLocator} from './agent-github-repository-tool.mjs';
import {stableHash} from './researcher-qa-protocol/stable-json.mjs';

export class AgentInteractionError extends Error{
 constructor(code,statusCode=400){super(code);this.code=code;this.statusCode=statusCode;this.retryable=false;}
}
export const interactionFail=(code,status=400)=>{throw new AgentInteractionError(code,status);};
export const interactionUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
export const interactionHash=value=>stableHash(value);
export function interactionId(value){const hex=interactionHash(value).slice(0,32).split('');hex[12]='5';hex[16]='8';const s=hex.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export function normalizeInteractionInput(input){
 if(!exact(input,['requestId','message','context'])||!interactionUuid(input.requestId)||typeof input.message!=='string'||!input.message.trim()||input.message.length>2000||/\0/u.test(input.message))interactionFail('AGENT_INTERACTION_INPUT');
 const context=input.context??null;
 if(context!==null&&(!exact(context,['batchId','questionId'])||!interactionUuid(context.batchId)||typeof context.questionId!=='string'||!context.questionId||context.questionId.length>128))interactionFail('AGENT_INTERACTION_CONTEXT');
 return {requestId:input.requestId.toLowerCase(),message:input.message.trim(),context};
}
export function normalizeInteractionOrigin(input){
 if(!exact(input,['channel','actorRef','conversationRef','eventRef','botId','groupId','platformUserId'])||!['web','qq'].includes(input.channel))interactionFail('AGENT_INTERACTION_ORIGIN');
 if(input.channel==='web'){
  if(!interactionUuid(input.platformUserId)||input.actorRef!==input.platformUserId||typeof input.conversationRef!=='string'||!interactionUuid(input.conversationRef)||!interactionUuid(input.eventRef))interactionFail('AGENT_INTERACTION_ORIGIN');
  return {channel:'web',actorRef:input.actorRef,platformUserId:input.platformUserId,conversationRef:input.conversationRef,eventRef:input.eventRef};
 }
 const id=value=>typeof value==='string'&&/^[1-9][0-9]{4,15}$/u.test(value)&&Number.isSafeInteger(Number(value));
 if(!id(input.actorRef)||!id(input.botId)||!id(input.groupId)||input.actorRef===input.botId||typeof input.eventRef!=='string'||!/^[-0-9]{1,24}$/u.test(input.eventRef)||input.platformUserId!=null)interactionFail('AGENT_INTERACTION_ORIGIN');
 const conversationRef=input.botId+':'+input.groupId+':'+input.actorRef;
 if(input.conversationRef!==conversationRef)interactionFail('AGENT_INTERACTION_ORIGIN');
 return {channel:'qq',actorRef:input.actorRef,botId:input.botId,groupId:input.groupId,conversationRef,eventRef:input.eventRef};
}
export function normalizeGitHubInteraction(input){
 if(!exact(input,['kind','topic','repositoryUrl','publication'])||!['github-search','github-article'].includes(input.kind)||typeof input.topic!=='string'||input.topic.trim().length<2||input.topic.length>1000)interactionFail('AGENT_INTERACTION_GITHUB_INPUT');
 if(!['inherit','draft'].includes(input.publication??'inherit'))interactionFail('AGENT_INTERACTION_PUBLICATION_INPUT');
 const repositoryUrl=input.repositoryUrl==null?null:normalizeGitHubRepositoryLocator(input.repositoryUrl).canonicalUrl;
 return {kind:input.kind,topic:input.topic.trim(),repositoryUrl,publication:input.kind==='github-search'?'draft':input.publication??'inherit'};
}
export function forceExplicitDraft(message,spec){return /(?:只.{0,4}草稿|不要发布|不发布|先别.{0,3}发|先不发布|draft\s+only|do\s+not\s+publish|don't\s+publish)/iu.test(message)?{...spec,publication:'draft'}:spec;}
export const AGENT_CONVERSATION_WORKFLOW=Object.freeze({
 schemaVersion:'agent-workflow-v1',workflowKey:'agent.conversation.turn',workflowVersion:1,
 inputSchema:'agent-conversation-input-v1',outputSchema:'agent-conversation-output-v1',
 requiredCapabilities:[{key:'provider.text.generate',version:1}],
 defaultBudget:{providerCalls:10,toolCalls:0,inputTokens:200000,outputTokens:24000,wallClockSeconds:120},
 stages:[{key:'respond',kind:'provider',dependsOn:[],maxAttempts:1,timeoutSeconds:110,capability:{key:'provider.text.generate',version:1},idempotencyMode:'key'}],
});
export const AGENT_GITHUB_INSPECT_WORKFLOW=Object.freeze({schemaVersion:'agent-workflow-v1',workflowKey:'agent.github.inspect',workflowVersion:1,
 inputSchema:'agent-github-inspect-input-v1',outputSchema:'agent-github-inspect-output-v1',requiredCapabilities:[{key:'research.github.read',version:1}],
 defaultBudget:{providerCalls:0,toolCalls:3,inputTokens:0,outputTokens:0,wallClockSeconds:300},
 stages:[{key:'read',kind:'tool',dependsOn:[],maxAttempts:3,timeoutSeconds:90,capability:{key:'research.github.read',version:1},idempotencyMode:'key'}]});
export const AGENT_CONVERSATION_ATTEMPT_WORKFLOW=Object.freeze({...AGENT_CONVERSATION_WORKFLOW,workflowVersion:2});
export const INTERACTION_GITHUB_TOOLS=Object.freeze([
 {name:'github_answer_question',arguments:{question:'用户本次针对项目的问题、想了解的方面或总结要求',repositoryUrl:'可选，明确的GitHub仓库URL；当前会话仅有一个明确项目时可省略'},purpose:'围绕指定项目的实现、算法、调用链、亮点、限制或总结进行只读研究，定位源码/测试并按固定提交和行号回答；支持当前提问者连续追问。不创建文章、不发布。缺少项目且上下文不明确时先询问项目。'},
 {name:'github_search_projects',arguments:{topic:'用户要求的项目方向',repositoryUrl:'可选，用户指定的 GitHub 仓库 URL'},purpose:'交给小墨鱼现有 GitHub 研究器查询公开项目；返回持久任务编号，尚未完成查询。'},
 {name:'github_write_article',arguments:{topic:'这一次的写作要求',repositoryUrl:'可选，用户指定的 GitHub 仓库 URL',publication:'inherit 或 draft；遵循小墨鱼既有发布策略；用户要求草稿时用 draft'},purpose:'交给小墨鱼现有研究、证据采集、写作和发布工作流，不修改每日计划或全局选题。返回任务编号，不得声称已经写完。'},
 {name:'get_agent_work',arguments:{view:'articles 或 tasks'},purpose:'查询小墨鱼可向当前提问者展示的已发表文章或本人的任务状态；不是查询其他用户信息。'},
]);
