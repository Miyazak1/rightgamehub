import test from 'node:test';
import assert from 'node:assert/strict';
import {NapCatControl} from '../../apps/qq-channel/src/napcat-control.mjs';
test('runtime follows login loss and recovery without treating stale login flags as online',async()=>{
 let status={isLogin:true,coreReady:true,loginPhase:'ready'},identityReads=0,refreshes=0;
 const control=new NapCatControl({token:'a'.repeat(64),accessToken:'synthetic-only',fetchImpl:async(url,options)=>{
  let data;if(url.endsWith('/auth/login'))data={Credential:'synthetic'};
  else if(url.endsWith('/CheckLoginStatus'))data=status;
  else if(url.endsWith('/GetQQLoginInfo')){identityReads++;data={uin:'100000001'};}
  else if(url.endsWith('/GetQQLoginQrcode'))data={qrcode:'https://ssl.ptlogin2.qq.com/synthetic-recovery'};
  else if(url.endsWith('/RefreshQRcode')){refreshes++;data=null;}
  else if(url.endsWith('/Debug/call')){const body=JSON.parse(options.body);data=body.action==='get_group_info'?{group_id:200000001}:{user_id:100000001};}
  else throw Error('Unexpected test endpoint');
  return new Response(JSON.stringify({code:0,data}));
 }}),config={botId:'100000001',groupId:'200000001'};
 assert.equal((await control.inspect(config)).groupReady,true);
 for(const offline of [{isLogin:true,coreReady:true,isOffline:true,loginPhase:'offline'},{isLogin:true,coreReady:true,loginPhase:'offline'}]){
  status=offline;const view=await control.inspect(config);assert.equal(view.loggedIn,false);assert.equal(view.coreReady,false);assert.equal(view.groupReady,false);
 }
 assert.equal(identityReads,1);
 assert.equal((await control.qr()).qrText,'https://ssl.ptlogin2.qq.com/synthetic-recovery');await control.refresh();assert.equal(refreshes,1);
 status={isLogin:false,coreReady:false,loginPhase:'reconnecting'};assert.equal((await control.inspect(config)).phase,'reconnecting');
 status={isLogin:true,coreReady:true,loginPhase:'ready'};const restored=await control.inspect(config);assert.equal(restored.loggedIn,true);assert.equal(restored.groupReady,true);assert.equal(identityReads,2);
 await assert.rejects(control.refresh(),{code:'QQ_ALREADY_LOGGED_IN'});assert.equal(refreshes,1);
});
