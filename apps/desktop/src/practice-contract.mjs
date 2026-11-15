export const PRACTICE_METHODS=Object.freeze({getAssistantCapabilities:[],sendAssistantMessage:['assistant-message'],executeAgentTool:['agent-tool','agent-arguments'],getLearningInsights:['learning-query'],
  getPracticeCatalog:['practice-query'],listPracticeHistory:[],getPractice:['practice-id'],startPractice:['practice-config','practice-key'],updatePractice:['practice-id','practice-update'],continuePractice:['practice-id','practice-key'],retryPractice:['practice-id']});
const fail=()=>{throw Object.assign(Error('DESKTOP_BUSINESS_INPUT_INVALID'),{code:'DESKTOP_BUSINESS_INPUT_INVALID',status:400});};
const object=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail();return value;};
export function practiceArgument(kind,value) {
  if(kind==='practice-id'){if(typeof value!=='string'||!/^[a-f0-9-]{36}$/i.test(value))fail();return value;}
  if(kind==='practice-key'){if(typeof value!=='string'||!/^[a-zA-Z0-9:_-]{8,128}$/.test(value))fail();return value;}
  if(kind==='agent-tool'){if(!['search_capabilities','get_capability','open_capability','get_my_learning_data'].includes(value))fail();return value;}
  if(kind==='agent-arguments'){
    object(value,['query','kinds','tags','maxEstimatedMinutes','limit','offset','locale','capabilityId','view','days','subjectId','stageId','topicId','difficultyId']);
    if(JSON.stringify(value).length>5000)fail();return JSON.parse(JSON.stringify(value));
  }
  if(kind==='assistant-message') {
    object(value,['requestId','message','context','history']);practiceArgument('practice-id',value.requestId);
    if(typeof value.message!=='string'||!value.message.trim()||value.message.length>2000)fail();
    if(value.context!=null){object(value.context,['batchId','questionId']);practiceArgument('practice-id',value.context.batchId);if(typeof value.context.questionId!=='string'||value.context.questionId.length>128)fail();}
    if(value.history!==undefined&&(!Array.isArray(value.history)||value.history.length>12))fail();
    for(const m of value.history||[]){object(m,['role','content','questionId','requestId']);if(m.requestId)practiceArgument('practice-id',m.requestId);if(!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>2000||m.questionId!=null&&(typeof m.questionId!=='string'||m.questionId.length>128))fail();}
  } else {
    const keys={
      'learning-query':['view','days','subjectId','stageId','topicId','difficultyId','limit','offset'],
      'practice-query':['subjectId','stageId','topicId','difficultyId','curriculumId'],
      'practice-config':['subjectId','stageId','topicId','difficultyId','curriculumId','count','language'],
      'practice-update':['action','questionId','answer','elapsedSeconds','currentIndex','expectedRevision'],
    }[kind];if(!keys)fail();object(value??={},keys);
    for(const item of Object.values(value))if(item!==null&&(!['string','number'].includes(typeof item)||typeof item==='string'&&item.length>128||typeof item==='number'&&(!Number.isSafeInteger(item)||item<0||item>1000000)))fail();
  }
  return JSON.parse(JSON.stringify(value));
}
