export const AGENT_TOPIC_SCOPE_MIN_LENGTH=10;

export function buildAgentAutomationPayload(value){
  const enabled=value?.enabled,model=String(value?.model??'').trim(),intervalHours=Number(value?.intervalHours),monthlyArticleLimit=Number(value?.monthlyArticleLimit),topicScope=String(value?.topicScope??'').trim();
  if(topicScope.length<AGENT_TOPIC_SCOPE_MIN_LENGTH)throw new Error(`选题范围至少填写 ${AGENT_TOPIC_SCOPE_MIN_LENGTH} 个字符。`);
  if(typeof enabled!=='boolean'||!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(model)||!Number.isInteger(intervalHours)||intervalHours<24||intervalHours>720||!Number.isInteger(monthlyArticleLimit)||monthlyArticleLimit<1||monthlyArticleLimit>100||topicScope.length>1000)throw new Error('自动发布设置无效，请检查后重试。');
  return{enabled,model,intervalHours,monthlyArticleLimit,topicScope};
}
