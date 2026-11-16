// Isolated release acceptance: real tool execution + real account-service auth,
// with an explicitly empty learning repository and no model or production calls.
import assert from 'node:assert/strict';
import {createPlatformAgentTools} from '../../apps/api/src/platform-agent-tools.mjs';
import {createAgentCapabilityService} from '../../apps/api/src/agent-capability-service.mjs';
import {createPlatformAssistantService} from '../../apps/api/src/platform-assistant.mjs';
import {normalizeLearningQuery} from '../../apps/api/src/practice/insights.mjs';

export function createInstalledAgentAcceptanceHandler() {
  const practiceService={insights:async(actor,input)=>{
    assert.equal(actor.userId,'31e033b2-13d6-4b81-b214-21b3f25dca60');
    const query=normalizeLearningQuery(input);
    return {schemaVersion:1,scope:'platform-practice',query,window:{since:null,asOf:new Date().toISOString()},coverage:{submittedOnlyForAccuracy:true,unansweredIsIncorrect:false,includesCoursewareProgress:false,statisticsTruncated:false},
      summary:{completedBatches:0,inProgressBatches:0,questions:0,answered:0,unanswered:0,correct:0,incorrect:0,accuracy:null,topics:[]}};
  }};
  const capabilityService=createAgentCapabilityService({catalogService:{list:async()=>[],get:async()=>{throw Object.assign(Error('missing'),{statusCode:404});}}});
  const tools=createPlatformAgentTools({capabilityService,practiceService}),assistant=createPlatformAssistantService({tools,practiceService});
  return async(req,res,url,authenticate)=>{
    const route=req.method+' '+url.pathname;
    if(!['GET /v1/me/assistant/capabilities','GET /v1/me/learning/insights','POST /v1/me/agent/tools','GET /v1/creator/works','GET /v1/creator/drafts','GET /v1/admin/reports'].includes(route))return false;
    const actor=await authenticate();let data;
    if(route==='GET /v1/admin/reports'){
      assert.equal(actor.profile.role,'user');res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'ADMIN_REQUIRED'}}));return true;
    }
    if(route==='GET /v1/creator/works')data=[{id:'installed-creator-work',title:'安装验收创作作品',kind:'game',state:'draft',visibility:'private',revision:'1',targets:[],tags:[]}];
    else if(route==='GET /v1/creator/drafts')data=[];
    else if(route==='GET /v1/me/assistant/capabilities')data=assistant.capabilities();
    else if(route==='GET /v1/me/learning/insights')data=await practiceService.insights(actor,Object.fromEntries(url.searchParams));
    else {let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw Error('fixture input too large');}const input=JSON.parse(raw);data=await tools.execute(actor,input.name,input.arguments);}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({data}));return true;
  };
}
