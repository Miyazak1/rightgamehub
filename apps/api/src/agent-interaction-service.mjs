import {normalizeInteractionInput,normalizeInteractionOrigin,normalizeGitHubInteraction,forceExplicitDraft,
 interactionFail,interactionUuid,INTERACTION_GITHUB_TOOLS} from './agent-interaction-contracts.mjs';

const replies={queued:'已收到消息，正在交给小墨鱼处理。',running:'小墨鱼正在处理这条请求。',waiting:'任务已保留，正在等待执行条件恢复。',failed:'这次请求未能完成，请在后台查看状态或稍后重试。','needs-review':'任务结果需要核对，已保留记录。'};
export function createAgentInteractionService({repository,agentId,readQQPolicy}){
 if(!interactionUuid(agentId))interactionFail('AGENT_INTERACTION_CONFIG_REQUIRED',503);
 async function authorize(origin,{invoke=false}={}){
  const agent=await repository.agent(agentId),principal=await repository.principal(agent,origin);
  if(origin.channel==='qq'){
   if(typeof readQQPolicy!=='function')interactionFail('AGENT_INTERACTION_QQ_UNAVAILABLE',503);
   const policy=await readQQPolicy();
   if(policy.agentId!==agentId||policy.botId!==origin.botId||policy.groupId!==origin.groupId||!policy.enabled||!policy.allowedUsers.includes(origin.actorRef))interactionFail('AGENT_INTERACTION_CHANNEL_DENIED',403);
  }
  if(invoke&&!principal.canInvoke)interactionFail('AGENT_INTERACTION_INVOKE_DENIED',403);
  return {agent,principal};
 }
 async function view(row){
  const children=row.kind==='message'?await repository.children(row.id):[];
  return {id:row.id,agentId:row.agent_user_id,kind:row.kind,state:row.state,reply:row.result_json?.reply??replies[row.state]??replies.failed,
   errorCode:row.error_code??null,progress:await repository.progress(row),
   ...(row.result_json??{}),...(children.length?{task:{id:children[0].id,state:children[0].state,kind:children[0].kind}}:{})};
 }
 return {
  agentId,authorize,
  async capabilities(){const agent=await repository.agent(agentId),readiness=repository.readiness?await repository.readiness(agentId):{ready:true};return {available:readiness.ready,reasonCode:readiness.code??null,mode:'agent',retention:'server-scoped',agent:{id:agent.id,displayName:agent.display_name},capabilities:['conversation','github-research','github-writing','agent-work'],paperEnabled:false};},
  async receive(rawOrigin,rawInput){
   const origin=normalizeInteractionOrigin(rawOrigin),input=normalizeInteractionInput(rawInput);
   if(origin.channel==='web'&&origin.eventRef.toLowerCase()!==input.requestId)interactionFail('AGENT_INTERACTION_REQUEST_CONFLICT',409);
   if(origin.channel==='qq'&&input.context)interactionFail('AGENT_INTERACTION_CONTEXT',400);
   await authorize(origin);
   return view(await repository.accept({agentId,origin,input}));
  },
  async status(rawOrigin,id){
   const origin=normalizeInteractionOrigin(rawOrigin);if(!interactionUuid(id))interactionFail('AGENT_INTERACTION_INPUT');
   await authorize(origin);const row=await repository.get(id);
   if(!row||row.agent_user_id!==agentId||row.channel!==origin.channel||row.actor_ref!==origin.actorRef
    ||(origin.channel==='qq'&&row.conversation_ref!==origin.conversationRef))interactionFail('AGENT_INTERACTION_NOT_FOUND',404);
   return view(row);
  },
  async tools(row,{platformTools=null,actor=null}={}){
   await authorize(row.origin_json);
   const descriptions=[...INTERACTION_GITHUB_TOOLS,...(row.channel==='web'&&platformTools?platformTools.descriptions:[])];
   return {descriptions,async execute(_ignored,name,args={}){
    if(name==='github_answer_question'){
     if(Object.keys(args).some(k=>!['question','repositoryUrl'].includes(k))||typeof args.question!=='string'||args.question.trim().length<2||args.question.length>1000)interactionFail('AGENT_INTERACTION_GITHUB_INPUT');
     const prior=await repository.researchContext(row);
     const explicit=args.repositoryUrl==null?null:normalizeGitHubInteraction({kind:'github-search',topic:args.question,repositoryUrl:args.repositoryUrl}).repositoryUrl;
     const repositoryUrl=explicit??prior?.repositoryUrl;
     if(!repositoryUrl) return {name,error:{code:'AGENT_INTERACTION_PROJECT_REQUIRED',message:'请提供要讨论的 GitHub 项目链接；当前会话没有唯一明确的项目。'}};
     const same=prior?.repositoryUrl===repositoryUrl;
     const task={kind:'github-question',topic:args.question.trim(),repositoryUrl,revision:same?prior.revision??null:null,previous:same?prior.previous??null:null};
     await authorize(row.origin_json);
     const accepted=await repository.attachTask(row,task);
     return {name,result:{status:'queued',taskId:accepted.id,kind:accepted.kind},task:{id:accepted.id,kind:accepted.kind,state:accepted.state},reply:'已交给小墨鱼针对这个问题查阅项目资料和源码，任务已保存；完成后会直接回复，不创建文章。'};
    }
    if(['github_search_projects','github_write_article'].includes(name)){
     if(name==='github_write_article'&&/(?:不(?:要)?写.{0,3}文章|只(?:需|要)?(?:回答|总结|分析)|仅(?:回答|总结|分析))/u.test(row.input_json.message))return {name,error:{code:'AGENT_INTERACTION_QUESTION_ONLY',message:'用户只要求回答、总结或分析，不应创建文章；请使用 github_answer_question。'}};
     if(Object.keys(args).some(k=>!['topic','repositoryUrl','publication'].includes(k)))interactionFail('AGENT_INTERACTION_GITHUB_INPUT');
     const task=forceExplicitDraft(row.input_json.message,normalizeGitHubInteraction({kind:name==='github_write_article'?'github-article':'github-search',...args}));
     await authorize(row.origin_json,{invoke:task.kind==='github-article'});
     const accepted=await repository.attachTask(row,task);
     return {name,result:{status:'queued',taskId:accepted.id,kind:accepted.kind},task:{id:accepted.id,kind:accepted.kind,state:accepted.state},reply:accepted.kind==='github-article'?'已交给小墨鱼研究 GitHub 项目并写文章，任务已保存，可继续查询进度。':'已交给小墨鱼查找 GitHub 项目，任务已保存。'};
    }
    if(name==='get_agent_work'){
     if(Object.keys(args).some(k=>k!=='view')||!['articles','tasks'].includes(args.view))interactionFail('AGENT_INTERACTION_INPUT');
     return {name,result:args.view==='articles'?{articles:(await repository.publicArticles(agentId)).map(a=>({title:a.title,summary:a.summary,url:'/blog/'+encodeURIComponent(a.slug)}))}:{tasks:await repository.ownTasks(row)}};
    }
    if(row.channel!=='web'||!platformTools||!actor)interactionFail('AGENT_INTERACTION_TOOL_DENIED',403);
    return platformTools.execute(actor,name,args);
   }};
  },
  async participants(actor){return repository.participants(actor,agentId);},
  async configureParticipant(actor,input){
   if(!input||Object.keys(input).some(k=>!['channel','actorRef','canInvoke','expectedRevision'].includes(k))||!['qq','web'].includes(input.channel)||typeof input.canInvoke!=='boolean'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)interactionFail('AGENT_INTERACTION_INPUT');
   if(input.channel==='qq'?(!/^[1-9][0-9]{4,15}$/u.test(input.actorRef??'')||!Number.isSafeInteger(Number(input.actorRef))):!interactionUuid(input.actorRef))interactionFail('AGENT_INTERACTION_INPUT');
   return repository.configureParticipant(actor,agentId,input);
  },
 };
}
