import test from 'node:test';
import assert from 'node:assert/strict';
import {loginState,nativeEvents,localGatewayOrigin} from '../../scripts/qq-login-lab.mjs';

test('gateway observation rediscovers changed ephemeral ports and rejects nonlocal bindings',()=>{
 const info=port=>({NetworkSettings:{Ports:{'6099/tcp':[{HostIp:'127.0.0.1',HostPort:port}]}}});
 assert.equal(localGatewayOrigin(info('54321')),'http://127.0.0.1:54321');
 assert.equal(localGatewayOrigin(info('56518')),'http://127.0.0.1:56518');
 assert.throws(()=>localGatewayOrigin({NetworkSettings:{Ports:{'6099/tcp':[{HostIp:'0.0.0.0',HostPort:'6099'}]}}}),/LAB_PORT_NOT_LOCAL/);
 assert.throws(()=>localGatewayOrigin(info('99999')),/LAB_PORT_NOT_LOCAL/);
});

test('lab status drops account identity, QR, credentials and arbitrary gateway errors',()=>{
 const result=loginState({loginPhase:'ready',isLogin:true,coreReady:true,uin:'123456789',password:'private',loginError:'private',qrcode:'private',Credential:'private'});
 assert.deepEqual(result,{phase:'ready',loggedIn:true,coreReady:true,offline:false});
 assert(!JSON.stringify(result).includes('private'));
 assert.equal(loginState({loginPhase:'private-password'}).phase,'unknown');
});

test('native event report excludes chat content and does not retain URLs or long numeric identities',()=>{
 const events=nativeEvents('群聊 SIGSEGV private chat\n普通登录 private content\nSignal name: SIGSEGV\n$$00 pc 0000000006def064 /opt/qq/wrapper.node\nhandleSignal user 123456789 https://example.com/private');
 assert.equal(events.length,3);assert(!JSON.stringify(events).includes('private'));assert(!JSON.stringify(events).includes('123456789'));assert(events.some(line=>line.includes('SIGSEGV')));
});
