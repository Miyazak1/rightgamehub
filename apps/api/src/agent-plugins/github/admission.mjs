import {normalizeGitHubInteraction,forceExplicitDraft,interactionFail} from '../../agent-interaction-contracts.mjs';

export async function admitGitHubTask(name,args,{row,repository}){
 if(name==='github_answer_question'){
  if(Object.keys(args).some(k=>!['question','repositoryUrl'].includes(k))||typeof args.question!=='string'||args.question.trim().length<2||args.question.length>1000)interactionFail('AGENT_INTERACTION_GITHUB_INPUT');
  const prior=await repository.researchContext(row);
  const explicit=args.repositoryUrl==null?null:normalizeGitHubInteraction({kind:'github-search',topic:args.question,repositoryUrl:args.repositoryUrl}).repositoryUrl;
  const repositoryUrl=explicit??prior?.repositoryUrl;
  if(!repositoryUrl)return {error:{code:'AGENT_INTERACTION_PROJECT_REQUIRED',message:'请提供要讨论的 GitHub 项目链接；当前会话没有唯一明确的项目。'}};
  const same=prior?.repositoryUrl===repositoryUrl;
  return {kind:'github-question',topic:args.question.trim(),repositoryUrl,revision:same?prior.revision??null:null,previous:same?prior.previous??null:null};
 }
 if(name==='github_write_article'&&/(?:不(?:要)?写.{0,3}文章|只(?:需|要)?(?:回答|总结|分析)|仅(?:回答|总结|分析))/u.test(row.input_json.message))return {error:{code:'AGENT_INTERACTION_QUESTION_ONLY',message:'用户只要求回答、总结或分析，不应创建文章；请使用 github_answer_question。'}};
 if(!['github_search_projects','github_write_article'].includes(name)||Object.keys(args).some(k=>!['topic','repositoryUrl','publication'].includes(k)))interactionFail('AGENT_INTERACTION_GITHUB_INPUT');
 const task=forceExplicitDraft(row.input_json.message,normalizeGitHubInteraction({kind:name==='github_write_article'?'github-article':'github-search',...args}));
 // Freeze the user's complete request instead of trusting a shortened model
 // topic to retain every constraint. Existing admitted tasks are unchanged.
 return name==='github_search_projects'&&!task.repositoryUrl?{...task,searchProtocol:2,userRequest:row.input_json.message}:task;
}
