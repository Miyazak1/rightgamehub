import test from 'node:test';import assert from 'node:assert/strict';
import {buildQQSettings,qqForm} from '../../packages/platform-client/src/qq-admin-settings.mjs';
test('QQ admin settings preserve ID precision and enforce finite whitelist/budget bounds',()=>{
 const settings={enabled:true,groupId:'9007199254740991',allowedUsers:['495469022'],dailyCalls:20,dailyTokens:100000,userDailyCalls:10,userMinuteMessages:3,groupMinuteMessages:10};
 assert.deepEqual(buildQQSettings(qqForm(settings)),settings);
 for(const change of [{users:''},{users:'495469022\n495469022'},{users:'not-a-QQ'},{dailyCalls:0},{dailyTokens:Infinity},{groupId:'1e9'},{groupId:'9999999999999999'},{groupMinuteMessages:31}])assert.throws(()=>buildQQSettings({...qqForm(settings),...change}));
});
