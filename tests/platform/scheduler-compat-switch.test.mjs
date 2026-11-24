import test from 'node:test';import assert from 'node:assert/strict';
import {schedulerUpCommand,comparableScheduler,schedulerSwitchSequence,parseSchedulerRows,verifiedSchedulerHeartbeat} from '../../scripts/switch-scheduler-interaction-compat.mjs';

test('psql JSON row contract rejects raw tuples and an unwrapped heartbeat object',()=>{
 for(const value of ['t|2037-01-01|Asia/Shanghai|{}','{bad json'])assert.throws(()=>parseSchedulerRows(value),/SCHEDULER_QUERY_JSON_INVALID/);
 for(const value of ['{}','null','true','[null]'])assert.throws(()=>parseSchedulerRows(value),/SCHEDULER_QUERY_ROWS_REQUIRED/);
 assert.deepEqual(parseSchedulerRows('[{"worker":{"instanceId":"new","interactionProtocolVersion":1}}]')[0].worker,{instanceId:'new',interactionProtocolVersion:1});assert.deepEqual(parseSchedulerRows('[]'),[]);
});
test('verification requires a new, fresh live protocol heartbeat rather than merely a parsed JSON object',()=>{
 const now=Date.now(),previous={instanceId:'old'},row={instanceId:'new',heartbeatAt:new Date(now).toISOString(),state:'waiting',interactionProtocolVersion:1};assert.equal(verifiedSchedulerHeartbeat(row,previous,'switch',now),true);
 for(const patch of [{instanceId:'old'},{state:'stopped'},{interactionProtocolVersion:null},{heartbeatAt:new Date(now-121000).toISOString()}])assert.equal(verifiedSchedulerHeartbeat({...row,...patch},previous,'switch',now),false);
 assert.equal(verifiedSchedulerHeartbeat({...row,interactionProtocolVersion:undefined},previous,'rollback',now),true);
});
test('scheduler command retains ordered files and env-file, targets one service with no-deps/pull-never',()=>{
 const compose={project:'gamehub-production',service:'agent-blog-public-scheduler',args:['compose','--project-directory','/www/gamehub/deploy','--env-file','/www/gamehub/deploy/.env.prod','-p','gamehub-production','-f','/base.yml','-f','/paper-off.json']},overlay='/www/backup/gamehub/agent-scheduler-compat-operation-fixture/candidate.json';
 const args=schedulerUpCommand(compose,overlay);assert.deepEqual(args.slice(0,compose.args.length),compose.args);assert.equal(args.at(-1),compose.service);assert(args.includes('--no-deps'));assert(args.includes('never'));
 for(const changed of [{service:'api'},{project:'mooyu-qq'}])assert.throws(()=>schedulerUpCommand({...compose,...changed},overlay),/SCHEDULER_SCOPE_REQUIRED/);
 assert.throws(()=>schedulerUpCommand(compose,'/arbitrary/override.json'),/SCHEDULER_SCOPE_REQUIRED/);
});
test('comparison permits image/Compose bookkeeping and generated hostname changes; rejects config/ports/volume/secret drift',()=>{
 const before={Config:{Image:'old',Hostname:'old-id',Env:['KEY=synthetic'],Labels:{'com.docker.compose.config-hash':'old','custom':'same'},Cmd:['node','scheduler'],User:'node'},HostConfig:{PortBindings:{},RestartPolicy:{Name:'unless-stopped'}},Mounts:[{Destination:'/data',Name:'existing',RW:true}],NetworkSettings:{Networks:{backend:{Aliases:['scheduler']}}}},after=structuredClone(before);after.Config.Image='new';after.Config.Hostname='new-id';after.Config.Labels['com.docker.compose.config-hash']='new';assert.deepEqual(comparableScheduler(before),comparableScheduler(after));
 for(const change of [c=>c.Config.Env=['KEY=changed'],c=>c.HostConfig.PortBindings={'80/tcp':[{}]},c=>c.Mounts[0].Name='other',c=>c.Config.Cmd=['node','other'],c=>c.Config.Labels.custom='changed']){const c=structuredClone(after);change(c);assert.notDeepEqual(comparableScheduler(c),comparableScheduler(before));}
});
test('busy/failing prerequisites never advance and failed start does not retry or auto-rollback',async()=>{
 const steps=['check','record','stop','recheck','up','verify'];for(const end of [...steps,null]){const seen=[],a=Object.fromEntries(steps.map(s=>[s,async()=>{seen.push(s);if(s===end)throw Error('STOP');}]));if(end)await assert.rejects(schedulerSwitchSequence(a),/STOP/);else await schedulerSwitchSequence(a);assert.deepEqual(seen,end?steps.slice(0,steps.indexOf(end)+1):steps);}
});
