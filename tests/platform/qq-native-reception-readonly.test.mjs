import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {nativeReceptionLogSummary,NATIVE_RECEPTION_PROBE} from '../../scripts/qq-native-reception-readonly.mjs';
test('native log inspection keeps only fixed counts and timestamps, never content, IDs, names or tokens',()=>{
 const secret='DO_NOT_PRINT_PRIVATE_MESSAGE_OR_TOKEN';
 const raw=`2026-11-25T12:34:00.000Z [INFO] 接收 <- 群聊 [${secret}(905757031)] [${secret}(495469022)] QQ链路定位20261125B ${secret}\n2026-11-25T12:34:01.000Z [ERROR] 无法与主进程通信 ${secret}`;
 const s=nativeReceptionLogSummary(raw);assert.equal(s.freshTestMarker.count,1);assert.equal(s.receivedExpectedCaller.count,1);assert.equal(s.markers.ipc,1);
 assert(!JSON.stringify(s).includes(secret));assert(!JSON.stringify(s).includes('495469022'));
});
test('out of order stdout and stderr counters retain the latest native timestamp',()=>{
 const s=nativeReceptionLogSummary('2026-11-25T12:34:01Z 接收 <- 群聊 [群(905757031)] [人(495469022)]\n2026-11-24T12:34:01Z 接收 <- 私聊 (123456)');
 assert.equal(s.receivedAny.lastAt,'2026-11-25T12:34:01Z');assert.equal(s.receivedAny.count,2);
});
test('host collector uses only docker inspect, exec and logs and never prints raw inspect metadata',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/qq-native-reception-readonly.mjs',import.meta.url),'utf8'),out=[],commands=[],secret='DO_NOT_PRINT_ENV_TOKEN';
 const body=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'').replace(/^if\(process.argv\[1\].*$/m,'');
 const fake=(cmd,args)=>{commands.push(args);assert.equal(cmd,'docker');assert(['inspect','exec','logs'].includes(args[0]));return {status:0,stdout:args[0]==='inspect'?JSON.stringify([{Image:'fixture',State:{Running:true},Config:{Env:[secret]}}]):args[0]==='exec'?'{}':secret,stderr:''};};
 new Function('spawnSync','console',body+'\ncollectNativeReception();')(fake,{log:s=>out.push(JSON.parse(s))});
 assert.equal(commands.length,3);assert(!JSON.stringify(out).includes(secret));assert.equal(out.at(-1).managementAuthRequests,0);
 assert(!/fetch\(|\.post\(|restart|login\//.test(NATIVE_RECEPTION_PROBE));
});
