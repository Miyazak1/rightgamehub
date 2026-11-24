import test from 'node:test';import assert from 'node:assert/strict';
import {NapCatControl} from '../../apps/qq-channel/src/napcat-control.mjs';
const config={botId:'3922489710',groupId:'905757031'};
function fixture({memberMode='unavailable',groupId=905757031,groups=[{group_id:905757031}],account=3922489710,loggedIn=true,coreReady=true,listMode='ok'}={}){
 const calls=[];let authCalls=0;
 const n=new NapCatControl({token:'a'.repeat(64),accessToken:'fixture-access-token',fetchImpl:async(url,options)=>{
  let data;
  if(url.endsWith('/auth/login')){authCalls++;return Response.json({code:0,data:{Credential:'fixture-credential'}});}
  if(url.endsWith('/CheckLoginStatus'))data={isLogin:loggedIn,coreReady,loginPhase:loggedIn?'ready':'offline'};
  else if(url.endsWith('/GetQQLoginInfo'))data={uin:String(account),online:true};
  else if(url.endsWith('/Debug/call')){
   const {action,params}=JSON.parse(options.body);calls.push({action,params});
   if(action==='get_group_info')data={status:'ok',retcode:0,data:{group_id:groupId}};
   else if(action==='get_group_member_info'){
    if(memberMode==='unavailable')return Response.json({code:-1,message:'fixture member lookup unavailable'});
    if(memberMode==='rejected')data={status:'failed',retcode:1404,data:null};
    else data={status:'ok',retcode:0,data:{user_id:memberMode==='wrong'?123:3922489710}};
   }else if(action==='get_group_list'){
    if(listMode==='unavailable')return Response.json({code:-1,message:'fixture list unavailable'});
    data=listMode==='rejected'?{status:'failed',retcode:1404,data:groups}:{status:'ok',retcode:0,data:groups};
   }else assert.fail('unexpected debug action');
  }else assert.fail('no QR, password, config or message-send endpoint may be called');
  return Response.json({code:0,data});
 }});return {n,calls,authCalls:()=>authCalls};
}
test('observed member API failure falls back to matching group info and the authenticated account group list, using one credential',async()=>{
 const f=fixture(),s=await f.n.inspect(config);assert.equal(s.loggedIn,true);assert.equal(s.accountMatches,true);assert.equal(s.groupReady,true);assert.equal(f.n.readyGroup,config.groupId);assert.equal(f.authCalls(),1);
 assert.deepEqual(f.calls.map(c=>c.action),['get_group_info','get_group_member_info','get_group_list']);
 assert.equal(f.calls[1].params.user_id,Number(config.botId));assert.equal(f.calls[1].params.group_id,Number(config.groupId));
});
test('healthy member lookup retains the original path and does not fetch the full group list',async()=>{
 const f=fixture({memberMode:'ok'});assert.equal((await f.n.inspect(config)).groupReady,true);assert.equal(f.calls.length,2);assert.equal(f.authCalls(),1);
});
test('wrong account, offline or core-not-ready never attempts any group query',async()=>{
 for(const options of [{account:123},{loggedIn:false},{coreReady:false}]){const f=fixture(options),s=await f.n.inspect(config);assert.equal(s.groupReady,false);assert.equal(f.n.readyGroup,null);assert.equal(f.calls.length,0);}
});
test('wrong group info, explicit member rejection and mismatched member identity cannot be overridden by a group list',async()=>{
 for(const options of [{groupId:123},{memberMode:'rejected'},{memberMode:'wrong'}]){const f=fixture(options);assert.equal((await f.n.inspect(config)).groupReady,false);assert.equal(f.n.readyGroup,null);assert(!f.calls.some(c=>c.action==='get_group_list'));}
});
test('missing group, invalid list shape, explicit list failure and unavailable list remain closed',async()=>{
 for(const options of [{groups:[]},{groups:[{group_id:123}]},{groups:{group_id:905757031}},{listMode:'rejected'},{listMode:'unavailable'}]){const f=fixture(options);assert.equal((await f.n.inspect(config)).groupReady,false);assert.equal(f.n.readyGroup,null);assert.equal(f.authCalls(),1);}
});
test('an already-live websocket is preserved after fallback readiness without rewriting config',async()=>{
 const f=fixture();await f.n.maintain(config,()=>true);assert.equal(f.n.readyGroup,config.groupId);assert.equal(f.authCalls(),1);assert.equal(f.calls.length,3);
});
test('group readiness is reevaluated; a previous valid group cannot survive removal on the next read',async()=>{
 const groups=[{group_id:905757031}],f=fixture({groups});assert.equal((await f.n.inspect(config)).groupReady,true);groups.length=0;assert.equal((await f.n.inspect(config)).groupReady,false);assert.equal(f.n.readyGroup,null);assert.equal(f.authCalls(),1);
});
