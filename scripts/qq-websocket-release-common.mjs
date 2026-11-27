import fs from 'node:fs';import path from 'node:path';
import {objectHash,runtimeComparable} from './qq-independent-release-common.mjs';
import {qqIdentityHash,validateGuardianConfig} from './qq-plugin-guardian.mjs';
import {decideQQRecovery} from '../apps/qq-channel/src/recovery-policy.mjs';
export const WS_RELEASE='qq-websocket-owner-20261127-r1';
export const WS_STAGE='/www/backup/gamehub/qq-websocket-owner-release-20261127-r1';
export const WS_RECORD='/www/backup/gamehub/qq-websocket-owner-operation-20261127-';
export const WS_GATEWAY='mooyu-qq-napcat-1',WS_WORKER='mooyu-qq-worker-1';
export const WS_BASE_IMAGE='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d';
export const WS_PATCH_SHA256='0af3b82fcb931bcb1f859f1536f905aaca1964ecff6981a191aab9b4e9a32d3c';
export const WS_WORKER_SOURCES=Object.freeze({'napcat-control.mjs':'4296ce27f472f1da08ae1b8e8d4399da2a1372a2a575d142e6a9693bc09ca166','control-server.mjs':'9f2965af83672215acc79aa40ff1bced2910bbc8839c73f15b1e2c705e5fc247','control-store.mjs':'453080b190e283172c44d42924533627ee11d09d048644bbe2d07db4a0a43586','plugins/qq/runtime.mjs':'634527f5bd330271e88da93ffa12c17839aba90d9e07c8d312efcfb392048a33'});
export const wsFail=code=>{throw Error(code);};
export function assertWSGuardianState(prior,now=Date.now()){
 const validated=decideQQRecovery(prior,{runtime:{}},now);
 if(!prior||validated.state.manualRequired||validated.reason==='clock-changed')wsFail('GUARDIAN_STATE_REVIEW_REQUIRED');
 return {recentAttempts:prior.attempts.filter(t=>now-t<86400000).length,dailyLimit:2,cooldownSeconds:900};
}
export function wsRecordPath(p){if(!new RegExp('^'+WS_RECORD+'[A-Za-z0-9]+$').test(p??'')||fs.lstatSync(p).isSymbolicLink()||fs.realpathSync(p)!==p)wsFail('EXACT_NEW_WS_RECORD_REQUIRED');return p;}
export function assertWSRuntime(current,before,image){if(current.Image!==image||objectHash(runtimeComparable(current))!==objectHash(runtimeComparable(before))||current.Config.Hostname!==before.Config.Hostname)wsFail('GATEWAY_RUNTIME_OR_DEVICE_CHANGED');}
export function rebindWSGuardian(current,before,candidate){
 validateGuardianConfig(current);validateGuardianConfig(before);
 const omit=v=>{const {image,identityHash,...rest}=v;return rest;};
 if(objectHash(omit(current))!==objectHash(omit(before)))wsFail('GUARDIAN_POLICY_CHANGED');
 const volume=candidate.Mounts.filter(m=>m.Destination==='/data');
 if(candidate.Name!=='/'+WS_GATEWAY||volume.length!==1||volume[0].Type!=='volume'||volume[0].Name!==before.loginVolume)wsFail('LOGIN_VOLUME_CHANGED');
 return {...current,image:candidate.Image,identityHash:qqIdentityHash(candidate)};
}
// Failure is terminal for this operation. There is no implicit retry, rollback,
// database restoration or historical task dispatch in this sequence.
export async function wsSwitchSequence(io){
 for(const phase of ['preflight','record','build','warmBackup','recheck','stopWorker','stopGateway','coldBackup','startGateway','bindGuardian','cooldown','startWorker','verify'])await io[phase]();
}
export function createWSBuildContext(record,source,alias){
 if(!/^mooyu-qq-ws-base:20261127-[A-Za-z0-9]+$/.test(alias))wsFail('NEW_WS_BASE_ALIAS_REQUIRED');
 const dir=path.join(record,'build-context');fs.mkdirSync(dir,{mode:0o700});
 fs.writeFileSync(path.join(dir,'napcat.mjs'),source,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(dir,'Dockerfile'),'FROM '+alias+'\nCOPY --chown=1000:1000 --chmod=0444 napcat.mjs /app/napcat/napcat.mjs\n',{flag:'wx',mode:0o600});return dir;
}
export function wsGatewayUlimits(container,service){
 for(const [name,v]of Object.entries(service.ulimits??{})){
  const value=typeof v==='number'?{soft:v,hard:v}:v;if(!value||Object.keys(value).some(k=>!['single','soft','hard'].includes(k))||Object.hasOwn(value,'single')&&(Object.hasOwn(value,'soft')||Object.hasOwn(value,'hard')))wsFail('ULIMIT_FORMAT_CHANGED');
  const soft=value.single??value.soft??0,hard=value.single??value.hard??0,a=container.HostConfig.Ulimits?.find(x=>x.Name===name);
  if(![soft,hard].every(n=>Number.isSafeInteger(n)&&n>=-1)||a?.Soft!==soft||a?.Hard!==hard)wsFail('DECLARED_ULIMIT_MISMATCH');
 }
}
export function wsGatewayPorts(c,service){
 const expected={};for(const p of service.ports??[]){if(!p||typeof p!=='object'||!Number.isSafeInteger(p.target)||!/^\d+$/.test(String(p.published??'')))wsFail('CONCRETE_MANAGEMENT_PORT_REQUIRED');(expected[p.target+'/'+(p.protocol??'tcp')]??=[]).push({HostIp:p.host_ip??'0.0.0.0',HostPort:String(p.published)});}
 const sorted=v=>Object.fromEntries(Object.entries(v??{}).map(([k,a])=>[k,a.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
 if(objectHash(sorted(c.HostConfig.PortBindings))!==objectHash(sorted(expected)))wsFail('MANAGEMENT_PORT_CHANGED');
}
export function wsNewMessageSQL(since){
 const stamp=new Date(since);if(!Number.isFinite(stamp.getTime()))wsFail('COMPLETED_WS_UPDATE_REQUIRED');
 return `SELECT COALESCE(json_agg(json_build_object('createdAt',m.created_at,'state',m.status,'replyDelivered',
 (m.status='delivered' AND m.remote_message_id IS NOT NULL AND position('QQ连接修复通过20261127' in COALESCE(m.reply,''))>0)
 OR EXISTS(SELECT 1 FROM mooyu_qq.agent_deliveries d JOIN mooyu_qq.messages r ON r.channel_id=d.channel_id AND r.message_id=d.message_id WHERE d.channel_id=m.channel_id AND d.source_message_id=m.message_id AND r.status='delivered' AND r.remote_message_id IS NOT NULL AND position('QQ连接修复通过20261127' in COALESCE(r.reply,''))>0))),'[]'::json)
 FROM mooyu_qq.messages m WHERE m.channel_id='3922489710:905757031' AND m.origin_group_id='905757031' AND m.created_at>='${stamp.toISOString()}' AND position('QQ连接修复验收20261127R1' in m.input_text)>0`;
}
