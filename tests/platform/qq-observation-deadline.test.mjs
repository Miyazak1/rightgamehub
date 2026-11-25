import test from 'node:test';import assert from 'node:assert/strict';
import {NapCatControl} from '../../apps/qq-channel/src/napcat-control.mjs';
import {decideQQRecovery} from '../../apps/qq-channel/src/recovery-policy.mjs';
const config={botId:'3922489710',groupId:'905757031'};
function fixture(mode){
 const calls=[];let now=1000000,auth=0,groups=[{group_id:Number(config.groupId)}];
 const n=new NapCatControl({token:'a'.repeat(64),accessToken:'fixture',sampleTimeoutMs:120,now:()=>now,fetchImpl:async(url,options)=>{
  const p=new URL(url).pathname,body=JSON.parse(options.body);calls.push(body.action??p);
  if(p.endsWith('/auth/login')){auth++;return Response.json({code:0,data:{Credential:'fixture-'+auth}});}
  if(p.endsWith('/CheckLoginStatus'))return Response.json({code:0,data:{isLogin:true,isOffline:false,coreReady:true,loginPhase:'ready'}});
  if(p.endsWith('/GetQQLoginInfo'))return mode==='identity-hangs'?new Promise(()=>{}):Response.json({code:0,data:{uin:config.botId,online:true}});
  if(p.endsWith('/Debug/call')){
   if(body.action==='get_group_info')return mode==='group-info-hangs'?new Promise(()=>{}):Response.json({code:0,data:{group_id:Number(config.groupId)}});
   if(body.action==='get_group_member_info')return mode==='member-hangs'?new Promise(()=>{}):Response.json({code:0,data:{user_id:Number(config.botId)}});
   if(body.action==='get_group_list')return Response.json({code:0,data:groups});
  }
  assert.fail('no login, QR, configuration or send endpoint is allowed');
 }});
 return {n,calls,auth:()=>auth,advance:ms=>now+=ms,groups:value=>groups=value};
}
async function sample(f){const keep=setTimeout(()=>{},1000);try{return await f.n.inspect(config);}finally{clearTimeout(keep);}}
test('a hanging member query leaves time for the same-account group-list fallback and cannot discard successful login reads',async()=>{
 const f=fixture('member-hangs'),s=await sample(f);
 assert.equal(s.available,true);assert.equal(s.loggedIn,true);assert.equal(s.accountMatches,true);assert.equal(s.groupReady,true);assert.equal(f.n.isReady(config),true);
 assert(f.calls.includes('get_group_list'));assert.equal(f.auth(),1);
});
test('group or identity timeouts preserve current login verification and pause only the unconfirmed business checks',async()=>{
 for(const mode of ['group-info-hangs','identity-hangs']){
  const f=fixture(mode),s=await sample(f);assert.equal(s.available,true,mode);assert.equal(s.loggedIn,true,mode);assert.equal(s.coreReady,true,mode);
  assert.equal(s.observation,'partial');assert.equal(s.groupReady,false);assert.equal(f.n.isReady(config),false);assert.equal(s.verifiedAt,new Date(1000000).toISOString());
 }
});
test('twelve-hour sampling across credential renewal never reuses an old login timestamp when member details remain blocked',async()=>{
 const f=fixture('member-hangs');let last=null;
 for(let i=0;i<3;i++){const s=await sample(f);assert(s.available&&s.groupReady);if(last)assert(Date.parse(s.verifiedAt)>Date.parse(last));last=s.verifiedAt;f.advance(6*60*60*1000);}
 assert.equal(f.auth(),3);
});
test('the total deadline preserves successful login/account progress without authorizing a restart or an unverified group',async()=>{
 const f=fixture('member-hangs'),fetch=f.n.fetchImpl;f.n.sampleTimeoutMs=500;
 f.n.fetchImpl=async(...args)=>{if(args[0].endsWith('/CheckLoginStatus'))await new Promise(resolve=>setTimeout(resolve,400));return fetch(...args);};
 const s=await sample(f);assert.equal(s.available,true);assert.equal(s.loggedIn,true);assert.equal(s.accountMatches,true);assert.equal(s.groupReady,false);
 assert.equal(s.observation,'partial');assert.equal(s.probeFailure.stage,'group');assert.equal(s.probeFailure.code,'QQ_GATEWAY_TIMEOUT');
 const decision=decideQQRecovery(null,{runtime:{...s,connected:true}},1000000);assert.equal(decision.action,'wait');assert.equal(decision.reason,'group-check-only');
});
test('a timed-out member RPC cools down while fresh group lists still revoke access after removal and member probing resumes later',async()=>{
 const f=fixture('member-hangs');assert((await sample(f)).groupReady);f.advance(5000);assert((await sample(f)).groupReady);
 assert.equal(f.calls.filter(p=>p==='get_group_member_info').length,1);f.groups([]);f.advance(5000);assert.equal((await sample(f)).groupReady,false);
 f.groups([{group_id:Number(config.groupId)}]);f.advance(300001);assert((await sample(f)).groupReady);assert.equal(f.calls.filter(p=>p==='get_group_member_info').length,2);
});
