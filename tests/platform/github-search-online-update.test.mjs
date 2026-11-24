import test from 'node:test';import assert from 'node:assert/strict';import {updateSequence,ensureUpdateWindow,UPDATE_NAMES,comparableUpdate,database}from'../../scripts/update-github-search-online.mjs';
const steps=['preflight','record','stopExecutor','stopApi','recheck','backup','startApi','bootstrap','startExecutor','verify'];
test('only two reviewed roles, backups precede bootstrap, executor starts last and failures never continue',async()=>{
 assert.deepEqual(UPDATE_NAMES,['gamehub-production-api-1','gamehub-production-agent-interactions-1']);
 const calls=[];await updateSequence(Object.fromEntries(steps.map(k=>[k,async()=>calls.push(k)])));assert.deepEqual(calls,steps);
 for(const step of steps){const seen=[];await assert.rejects(updateSequence(Object.fromEntries(steps.map(k=>[k,async()=>{seen.push(k);if(k===step)throw Error('STOP');}]))),/STOP/);assert.deepEqual(seen,steps.slice(0,steps.indexOf(step)+1));}
});
test('terminal notifications do not block but actual work, missing clock and near schedule do',()=>{
 const now=Date.now(),good={interactions:0,runs:0,stages:0,blockingEvents:0,nextFire:new Date(now+3600000).toISOString()};ensureUpdateWindow(good,now);
 for(const field of ['interactions','runs','stages','blockingEvents'])assert.throws(()=>ensureUpdateWindow({...good,[field]:1},now),/ACTIVE_TASKS_OR_DELIVERIES/);
 for(const nextFire of [null,'invalid',new Date(now+10000).toISOString()])assert.throws(()=>ensureUpdateWindow({...good,nextFire},now),/SCHEDULE_WINDOW_TOO_CLOSE/);
});
test('image-only comparison preserves environment, command, restart policy, mounts and private network aliases',()=>{
 const c={Config:{Image:'old',Hostname:'first',Env:['B=2','A=1'],Labels:{'com.docker.compose.version':'v1',private:'same'},Cmd:['node','worker.mjs']},HostConfig:{RestartPolicy:{Name:'unless-stopped'}},Mounts:[{Type:'volume',Name:'login',Source:'/private',Destination:'/data',RW:true}],NetworkSettings:{Networks:{private:{Aliases:['agent-interactions','executor']}}}};
 const after=structuredClone(c);after.Config.Image='new';after.Config.Hostname='second';after.Config.Labels['com.docker.compose.version']='v2';assert.deepEqual(comparableUpdate(c),comparableUpdate(after));
 for(const mutate of [v=>v.Config.Env.push('ALTERED=true'),v=>v.Config.Cmd=['other'],v=>v.HostConfig.RestartPolicy.Name='no',v=>v.Mounts[0].RW=false,v=>v.NetworkSettings.Networks.private.Aliases=[]]){const changed=structuredClone(after);mutate(changed);assert.notDeepEqual(comparableUpdate(c),comparableUpdate(changed));}
});
test('QQ database is resolved exclusively from its dedicated reference, not the website reference',()=>{
 const c={Config:{Env:['DATABASE_URL=postgresql://site:unused@api/site','QQ_DATABASE_URL=postgresql://qq:unused@qq/qq_history']}};
 assert.deepEqual(database(c,'qq-db','QQ_DATABASE_URL'),{container:'qq-db',user:'qq',database:'qq_history'});
 assert.deepEqual(database(c,'api-db'),{container:'api-db',user:'site',database:'site'});
});
