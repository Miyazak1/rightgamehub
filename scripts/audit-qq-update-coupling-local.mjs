// Reproduce current architectural failure paths with synthetic IO only.
// These are audit observations, not assertions of desired future behavior.
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{NapCatControl}from'../apps/qq-channel/src/napcat-control.mjs';import{createQQAgentClient}from'../apps/qq-channel/src/agent-bridge.mjs';import{qqRuntimeView}from'../packages/platform-client/src/qq-admin-settings.mjs';
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_AUDIT_DIRECTORY_REQUIRED');fs.mkdirSync(out,{recursive:true});
const cfg={botId:'3922489710',groupId:'905757031'},make=()=>new NapCatControl({token:'a'.repeat(64),accessToken:'synthetic-only'}),healthy=async(p,b)=>p.endsWith('CheckLoginStatus')?{isLogin:true,coreReady:true,loginPhase:'ready'}:p.endsWith('GetQQLoginInfo')?{uin:cfg.botId}:b.action==='get_group_info'?{group_id:cfg.groupId}:{user_id:cfg.botId};
const observations=[];
{
 const n=make();n.post=healthy;await n.inspect(cfg);assert.equal(n.readyGroup,cfg.groupId);n.post=async()=>{throw Error('synthetic status read timeout');};const view=await n.inspect(cfg);
 assert.equal(view.loggedIn,false);assert.equal(view.phase,'offline');assert.equal(n.readyGroup,null);observations.push({case:'one-status-read-error',statusReadFailedButReportedOffline:true,readErrorClearedBusinessReadiness:true,nativeLogoutWasRequested:false});
}
{
 const n=make();let rejectOld,calls=0;n.post=async(p,b)=>{if(p.endsWith('CheckLoginStatus')&&++calls===1)return new Promise((_resolve,reject)=>{rejectOld=reject;});return healthy(p,b);};
 const older=n.inspect(cfg);await n.inspect(cfg);assert.equal(n.readyGroup,cfg.groupId);rejectOld(Error('synthetic late read failure'));await older;
 assert.equal(n.readyGroup,null);assert.equal(n.observed.phase,'offline');observations.push({case:'overlapping-inspections',olderFailureOverwroteNewerHealthyState:true,nativeLogoutWasRequested:false});
}
{
 const n=make();let writes=0;const client={name:'mooyu-admin-managed',enable:true,url:n.workerUrl,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,heartInterval:30000,token:n.accessToken,debug:false};
 n.inspect=async()=>({accountMatches:true,groupReady:true});n.post=async(p,b)=>{if(p==='/OB11Config/GetConfig')return {network:{websocketClients:[client]}};assert.equal(p,'/OB11Config/SetConfig');assert.deepEqual(JSON.parse(b.config).network.websocketClients,[client]);writes++;return {};};
 await n.maintain(cfg,false);n.nextCheck=0;await n.maintain(cfg,false);assert.equal(writes,2);
 observations.push({case:'existing-config-during-socket-reconnect',identicalConfigWritten:writes,configChangeWasNecessary:false,actualGatewayConfigModified:false});
}
{
 const client=createQQAgentClient({url:'http://api:3090',secret:'a'.repeat(64),agentId:'c98abda1-d115-4e05-9c2e-43f68119386a',fetchImpl:async()=>{throw Error('synthetic API maintenance outage');}});
 await assert.rejects(client({operation:'status'}),e=>e.code==='QQ_AGENT_UNAVAILABLE'&&e.retryable===true);observations.push({case:'API-unavailable',bridgeReportsRetryableAPIError:true,qqLoginEndpointCalled:false});
}
{
 const live={available:true,loggedIn:true,coreReady:true,accountMatches:true,connected:true,groupReady:false,phase:'ready'},detail=qqRuntimeView(live),plugin=live.loggedIn&&live.connected&&live.accountMatches;
 assert.equal(detail.label,'待确认入群');assert.equal(plugin,true);const unavailable=qqRuntimeView({...live,available:false,connected:false});assert.equal(unavailable.label,'登录服务不可用');
 observations.push({case:'different-UI-definitions',sameSnapshotCanSayLoggedInAndGroupNotReady:true,pollFailureLabel:unavailable.label});
}
const result={result:'REPRODUCED_CURRENT_FAILURE_PATHS',observations,sourceStatus:'current local group-readiness candidate; unaffected code paths also exist in prior worker',productionAccessed:false,networkAccessed:false,servicesRestarted:false,applicationCodeModifiedByAudit:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
