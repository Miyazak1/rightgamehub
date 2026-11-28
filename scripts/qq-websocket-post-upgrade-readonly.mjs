// Source-only follow-up; the frozen r2 archive is not modified.
import { WS_RELEASE, WS_STAGE } from './qq-websocket-release-common.mjs';

export function simulateQQRecovery(decide, now) {
  const base = { version: 1, attempts: [], manualRequired: false };
  const broken = at => ({ runtime: { available: true, loggedIn: false, restartRequired: true,
    phase: 'offline', checkedAt: new Date(at).toISOString(), verifiedAt: new Date(at).toISOString() } });
  let d = decide(base, broken(now), now);
  const firstWait = d.action === 'wait';
  d = decide(d.state, broken(now + 30000), now + 30000);
  const secondWait = d.action === 'wait';
  d = decide(d.state, broken(now + 60000), now + 60000);
  const mature = { ...base, incident: { firstAt: now - 61000, samples: 3, lastSample: null } };
  const healthy = { runtime: { ...broken(now).runtime, loggedIn: true, coreReady: true,
    accountMatches: true, groupReady: true, connected: true, restartRequired: false, phase: 'ready' } };
  let repeated = decide(base, broken(now), now);
  for (let n = 0; n < 6; n++) repeated = decide(repeated.state, broken(now), now);
  const checks = {
    threeFreshSamplesAndSixtySeconds: firstWait && secondWait && d.action === 'restart-same-gateway',
    duplicateSampleDoesNotAccumulate: repeated.state.incident.samples === 1,
    dailyLimitTwo: decide({ ...mature, attempts: [now - 2000, now - 1000] }, broken(now), now).reason === 'daily-restart-limit',
    fifteenMinuteCooldown: decide({ ...mature, attempts: [now - 1000] }, broken(now), now).reason === 'restart-cooldown',
    qrWaitDoesNotRestart: decide(base, { runtime: { ...broken(now).runtime, phase: 'waiting_qrcode', restartRequired: false } }, now).action === 'wait',
    unavailableObservationDoesNotRestart: decide(base, { runtime: {} }, now).reason === 'observation-unavailable',
    staleObservationDoesNotRestart: decide(base, broken(now - 31000), now).reason === 'observation-unavailable',
    healthySessionDoesNotRestart: decide(base, healthy, now).reason === 'native-session-present',
    groupOnlyFaultDoesNotRestart: decide(base, { runtime: { ...healthy.runtime, groupReady: false } }, now).reason === 'group-check-only',
    handledIncidentDoesNotRepeat: decide({ ...base, incidentHandled: true }, broken(now), now).reason === 'incident-already-handled',
    manualReviewDoesNotRestart: decide({ ...base, manualRequired: true }, broken(now), now).reason === 'manual-review-required',
    inputUnchanged: JSON.stringify(base) === JSON.stringify({ version: 1, attempts: [], manualRequired: false }),
  };
  return { passed: Object.values(checks).every(Boolean), checks, simulatedOnly: true, liveFaultInjected: false };
}

export async function collectQQPostUpgrade(io, decide, emit = console.log) {
  const started = io.now(), receipt = await io.receipt();
  if (!Number.isSafeInteger(receipt.confirmedReplies) || receipt.confirmedReplies < 0) throw Error('INVALID_REPLY_COUNT');
  emit(JSON.stringify({ section: 'newMessageReceipt', ...receipt }));
  const before = await io.context();
  emit(JSON.stringify({ section: 'postUpgradeContext', ...before }));
  const samples = [];
  for (let n = 0; n < 6; n++) {
    if (n) await io.wait(10000);
    try {
      const s = await io.sample(), r = s.runtime, now = io.now();
      const age = now - Date.parse(r?.verifiedAt), checkedAge = now - Date.parse(r?.checkedAt);
      const healthy = s.contractValid === true && r?.available === true && r.loggedIn === true
        && r.coreReady === true && r.accountMatches === true && r.groupReady === true && r.connected === true
        && r.observation === 'fresh' && r.restartRequired === false
        && age >= 0 && age <= 30000 && checkedAge >= 0 && checkedAge <= 30000;
      const row = { section: 'postUpgradeSample', sample: n + 1, healthy,
        verifiedAt: r?.verifiedAt ?? null, checkedAt: r?.checkedAt ?? null,
        phase: ['ready', 'offline', 'failed', 'reconnecting', 'waiting_qrcode', 'generating_qrcode', 'qrcode_scanned', 'initializing'].includes(r?.phase) ? r.phase : 'unknown',
        loggedIn: r?.loggedIn === true, coreReady: r?.coreReady === true,
        accountMatches: r?.accountMatches === true, groupReady: r?.groupReady === true,
        connected: r?.connected === true, qrAvailable: r?.qrAvailable === true };
      samples.push(row); emit(JSON.stringify(row));
    } catch {
      const row = { section: 'postUpgradeSample', sample: n + 1, healthy: false, readFailed: true };
      samples.push(row); emit(JSON.stringify(row));
    }
  }
  const after = await io.context();
  emit(JSON.stringify({ section: 'postUpgradeContextAfter', ...after }));
  const simulation = simulateQQRecovery(decide, io.now());
  emit(JSON.stringify({ section: 'recoveryPolicySimulation', ...simulation }));
  const distinct = new Set(samples.filter(s => s.healthy).map(s => s.verifiedAt)).size;
  const ready = before.checksPassed === true && after.checksPassed === true
    && before.gatewayId === after.gatewayId && before.gatewayStartedAt === after.gatewayStartedAt
    && before.workerId === after.workerId && before.workerStartedAt === after.workerStartedAt
    && samples.every(s => s.healthy) && distinct >= 2 && receipt.confirmedReplies > 0 && simulation.passed;
  const result = { result: ready ? 'QQ_POST_UPGRADE_READONLY_CHECKS_PASSED' : 'QQ_POST_UPGRADE_READONLY_REVIEW_REQUIRED',
    observedMilliseconds: io.now() - started, healthySamples: samples.filter(s => s.healthy).length,
    samples: samples.length, distinctFreshSnapshots: distinct,
    newReplyConfirmed: receipt.confirmedReplies > 0, recoveryPolicySimulationPassed: simulation.passed,
    liveDisconnectRecoveryTested: false, longTermStabilityProven: false,
    servicesRestartedByAudit: false, recoveryAppliedByAudit: false, stateFilesWrittenByAudit: false,
    oldTasksRetried: false, messagesSent: false, qrOrLoginRequested: false, rawMessagesOrCredentialsPrinted: false };
  emit(JSON.stringify(result)); return result;
}

export function qqPostUpgradeReadonlyCommand() {
  const header = `(
set -euo pipefail
umask 077
base='${WS_STAGE}'
test -d "$base" && test ! -L "$base"
cd "$base"
sha256sum --check SHA256SUMS
runtime=''
for candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node /root/mooyu-github-search-runtime-20261124-*/node; do
  if test -f "$candidate" && test -x "$candidate" && test ! -L "$candidate"; then
    case "$("$candidate" --version)" in v22.*) runtime="$candidate"; break ;; esac
  fi
done
test -n "$runtime" || { echo VERIFIED_PRIVATE_NODE_NOT_FOUND; exit 2; }
"$runtime" --input-type=module <<'NODE'
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {Cutover} from '${WS_STAGE}/scripts/agent-server-cutover.mjs';
import {fileHash} from '${WS_STAGE}/scripts/qq-independent-release-common.mjs';
import {assertGuardianIdentity,assertGuardianSnapshot,WORKER_SNAPSHOT_PROBE} from '${WS_STAGE}/scripts/qq-plugin-guardian.mjs';
import {WS_PATCH_SHA256,wsNewMessageSQL,wsRecordPath} from '${WS_STAGE}/scripts/qq-websocket-release-common.mjs';
import {decideQQRecovery} from '${WS_STAGE}/apps/qq-channel/src/recovery-policy.mjs';
`;
  const body = String.raw`
const fail=code=>{throw Error(code);};
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});if(r.status!==0||r.error)fail('READ_TOOL_FAILED');return r.stdout.trim();};
const inspect=name=>JSON.parse(run('docker',['inspect',name]))[0];
const privateJSON=file=>{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||s.size>32*1024*1024)fail('PRIVATE_RECORD_REQUIRED');return JSON.parse(fs.readFileSync(file,'utf8'));};
const safeText=file=>{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)||s.size>2*1024*1024)fail('ROOT_SOURCE_FILE_REQUIRED');return fs.readFileSync(file,'utf8');};
const unit=name=>{const text=run('systemctl',['show',name,'-p','LoadState','-p','ActiveState','-p','SubState','-p','UnitFileState','-p','Result','-p','ExecMainStatus','-p','FragmentPath','-p','DropInPaths','-p','ExecStart','-p','TimersMonotonic','-p','Triggers','-p','LastTriggerUSecMonotonic']);return Object.fromEntries(text.split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));};
try{
 const root='/www/backup/gamehub/qq-independent-guardian-20261124-r1',index=privateJSON(stage+'/last-operation.private.json');
 if(index.releaseId!==release||index.mode!=='upgrade')fail('EXACT_R2_UPGRADE_REQUIRED');
 const record=wsRecordPath(index.record),state=privateJSON(record+'/state.private.json'),upgrade=privateJSON(record+'/result.private.json');
 if(state.releaseId!==release||upgrade.mode!=='upgrade'||!['QQ_WEBSOCKET_UPDATED_READY_NEW_MESSAGE_REQUIRED','QQ_WEBSOCKET_UPDATED_SCAN_REQUIRED'].includes(upgrade.result))fail('SUCCESSFUL_R2_UPGRADE_REQUIRED');
 const reader=new Cutover(record);
 const sourceProbe="const f=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(f.readFileSync('/app/napcat/napcat.mjs')).digest('hex'));";
 const context=async()=>{
  const g=inspect('mooyu-qq-napcat-1'),w=inspect('mooyu-qq-worker-1'),config=privateJSON(root+'/config.private.json'),caps=privateJSON(root+'/recovery-state.private.json');
  assertGuardianIdentity(g,config);
  const timer=unit('mooyu-qq-guardian.timer'),service=unit('mooyu-qq-guardian.service'),serviceFile='/etc/systemd/system/mooyu-qq-guardian.service',timerFile='/etc/systemd/system/mooyu-qq-guardian.timer';
  const serviceText=safeText(serviceFile),timerText=safeText(timerFile),exec=serviceText.match(/^ExecStart=(.+)$/m)?.[1].trim(),args=exec?.split(/\s+/)??[];
  const pathValid=args.length===5&&/^\/root\/mooyu-(qq-gateway|github-search)-runtime-20261124-[A-Za-z0-9]+\/node$/.test(args[0])&&/^\/www\/backup\/gamehub\/[A-Za-z0-9_-]+\/scripts\/qq-plugin-guardian\.mjs$/.test(args[1])&&args[2]==='recover'&&args[3]===root+'/config.private.json'&&args[4]===root;
  const installedRoot=pathValid?path.dirname(path.dirname(args[1])):null;
  if(pathValid){safeText(args[1]);safeText(installedRoot+'/apps/qq-channel/src/recovery-policy.mjs');}
  const loadedExec=service.ExecStart?.match(/argv\[\]=([^;]+);/)?.[1].trim();
  const codeMatches=pathValid&&fileHash(args[1])===fileHash(stage+'/scripts/qq-plugin-guardian.mjs')&&fileHash(installedRoot+'/apps/qq-channel/src/recovery-policy.mjs')===fileHash(stage+'/apps/qq-channel/src/recovery-policy.mjs')&&fileHash(args[0])===fileHash(process.execPath);
  const unitHashesMatch=[serviceFile,timerFile].every(file=>state.files.some(entry=>entry.path===file&&entry.sha256===fileHash(file)));
  const lastTriggerAgeSeconds=(Number(fs.readFileSync('/proc/uptime','utf8').split(' ')[0])*1e6-Number(timer.LastTriggerUSecMonotonic))/1e6;
  decideQQRecovery(caps,{runtime:{}},Date.now());
  const checks={gatewayPatchMatches:run('docker',['exec','mooyu-qq-napcat-1','node','-e',sourceProbe])===WS_PATCH_SHA256,
   gatewayImageMatchesUpgrade:g.Image===upgrade.image,workerSameContainerAndImage:w.Id===state.workerBefore.Id&&w.Image===state.workerBefore.Image,
   workerHealthy:w.State.Running===true&&w.State.Health?.Status==='healthy',guardianEnabled:config.enabled===true,
   guardianCodeAndPolicyMatch:codeMatches,guardianUnitsMatchUpgrade:unitHashesMatch,
   loadedServiceMatches:service.FragmentPath===serviceFile&&!service.DropInPaths&&loadedExec===exec,
   timerActive:timer.LoadState==='loaded'&&timer.ActiveState==='active'&&timer.UnitFileState==='enabled',
   loadedTimerMatches:timer.FragmentPath===timerFile&&!timer.DropInPaths&&timer.Triggers?.split(' ').includes('mooyu-qq-guardian.service')&&/OnUnitInactiveSec=20(?:\r?\n|$)/.test(timerText)&&/OnUnitInactiveUSec=20s(?:\s|;)/.test(timer.TimersMonotonic??''),
   timerRecentlyTriggered:Number.isFinite(lastTriggerAgeSeconds)&&lastTriggerAgeSeconds>=0&&lastTriggerAgeSeconds<=120,
   guardianServiceSuccessful:service.LoadState==='loaded'&&service.Result==='success'&&service.ExecMainStatus==='0'&&['inactive','active','activating'].includes(service.ActiveState),
   recoveryNotManuallyBlocked:caps.manualRequired===false};
  const recent=caps.attempts.filter(at=>Date.now()-at<86400000),attempts=recent.length;
  return {checks,checksPassed:Object.values(checks).every(v=>v===true),gatewayId:g.Id.slice(0,12),gatewayStartedAt:g.State.StartedAt,
   workerId:w.Id.slice(0,12),workerStartedAt:w.State.StartedAt,recentRecoveryAttempts:attempts,dailyLimit:2,cooldownSeconds:900,
   recoveryAllowanceRemaining:Math.max(0,2-attempts),recoveryCooldownRemainingSeconds:recent.length?Math.max(0,Math.ceil((recent.at(-1)+900000-Date.now())/1000)):0,
   guardianServiceState:service.ActiveState,guardianServiceSubState:service.SubState,
   timerLastTriggerAgeSeconds:Math.round(lastTriggerAgeSeconds),upgradeCompletedAt:upgrade.completedAt};
 };
 const io={now:()=>Date.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),context,
  sample:async()=>{const s=JSON.parse(run('docker',['exec','mooyu-qq-worker-1','node','--input-type=module','-e',WORKER_SNAPSHOT_PROBE]));assertGuardianSnapshot(s,privateJSON(root+'/config.private.json'));return {runtime:s.runtime,contractValid:true};},
  receipt:async()=>{const messages=JSON.parse(reader.sql(state.databases.qq,wsNewMessageSQL(upgrade.completedAt)));if(!Array.isArray(messages))fail('MESSAGE_RECEIPT_INVALID');return {matchingRequests:messages.length,confirmedReplies:messages.filter(m=>m.replyDelivered===true).length};}};
 await collectQQPostUpgrade(io,decideQQRecovery);
}catch(e){console.log(JSON.stringify({result:'QQ_POST_UPGRADE_READONLY_READ_FAILED',code:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'READ_FAILED',servicesRestartedByAudit:false,recoveryAppliedByAudit:false,stateFilesWrittenByAudit:false,oldTasksRetried:false,rawMessagesOrCredentialsPrinted:false}));process.exitCode=1;}
`;
  return header + simulateQQRecovery.toString() + '\n' + collectQQPostUpgrade.toString()
    + '\nconst stage=' + JSON.stringify(WS_STAGE) + ',release=' + JSON.stringify(WS_RELEASE) + ';\n'
    + body + '\nNODE\n)\n';
}
