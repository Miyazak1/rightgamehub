// Read only the existing gateway's metadata, selected config and bounded log
// counters. No management API/authentication, login, send, restart or replay.
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export const NATIVE_RECEPTION_PROBE=String.raw`
import fs from 'node:fs';import crypto from 'node:crypto';
const out={processes:[],configuration:[],source:{}};
for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)))try{
 if(!/^node/.test(fs.readFileSync('/proc/'+pid+'/comm','utf8').trim()))continue;
 const status=fs.readFileSync('/proc/'+pid+'/status','utf8'),env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
 out.processes.push({pid:Number(pid),parent:Number(status.match(/^PPid:\s*(\d+)/m)?.[1]),worker:env.includes('NAPCAT_WORKER_PROCESS=1'),ipcDescriptorPresent:env.some(v=>/^NODE_CHANNEL_FD=\d+$/.test(v))});
}catch{}
for(const root of ['/data/napcat/config','/app/napcat/config']){
 const file=root+'/napcat.json';if(!fs.existsSync(file))continue;
 try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)throw Error();const c=JSON.parse(fs.readFileSync(file,'utf8'));
 out.configuration.push({readable:true,consoleLog:typeof c.consoleLog==='boolean'?c.consoleLog:null,fileLog:typeof c.fileLog==='boolean'?c.fileLog:null,
 consoleLogLevel:['trace','debug','info','warn','error','fatal','off'].includes(c.consoleLogLevel)?c.consoleLogLevel:null,
 fileLogLevel:['trace','debug','info','warn','error','fatal','off'].includes(c.fileLogLevel)?c.fileLogLevel:null});
 }catch{out.configuration.push({readable:false});}break;
}
try{const s=fs.readFileSync('/app/napcat/napcat.mjs','utf8');out.source={sha256:crypto.createHash('sha256').update(s).digest('hex'),
 expectedSource:s.includes('getAioFirstViewLatestMsgs(i, +e.count)')&&s.includes('const i = de.getOneBotContext()?.core?.selfInfo?.online'),
 logsNativeReceive:s.includes('接收 <-'),loginUsesInMemoryOnline:s.includes('isLogin: o && i === !0'),
 currentHistoryWithoutCursorUsesLatest:s.includes('getAioFirstViewLatestMsgs(i, +e.count)')};}catch{out.source={readFailed:true};}
console.log(JSON.stringify(out));`;

export function nativeReceptionLogSummary(raw){
 const out={receivedAny:{count:0,lastAt:null},receivedExpectedGroup:{count:0,lastAt:null},receivedExpectedCaller:{count:0,lastAt:null},freshTestMarker:{count:0,lastAt:null},markers:{}};
 const errors={offline:/KickedOffLine|KickedOffline|账号状态变更为离线/,ipc:/IPC.*(?:error|failed|disconnect)|无法与主进程通信/i,
 recoveryFailed:/重启功能未初始化|登录服务重启失败/,packetFailure:/\[Core\] \[Packet\].*(?:error|failed|timeout|失败|超时)/i,
 callbackFailure:/onRecvMsg.*(?:error|failed)|监听.*(?:失败|错误)/i,websocketError:/WebSocket Client.*(?:error|failed|失败|关闭|断开)/i};
 const add=(key,time)=>{out[key].count++;if(time&&(!out[key].lastAt||Date.parse(time)>Date.parse(out[key].lastAt)))out[key].lastAt=time;};
 for(const line of raw.split(/\r?\n/u)){
  const clean=line.replace(/\x1b\[[0-9;]*m/g,''),time=clean.match(/^(\d{4}-\d\d-\d\dT\S+)\s/)?.[1];
  if(clean.includes('接收 <-'))add('receivedAny',time);
  const group=/接收 <- 群聊 \[[^\r\n]*?\(905757031\)\]/u.test(clean);
  if(group){add('receivedExpectedGroup',time);
   if(/接收 <- 群聊 \[[^\r\n]*?\(905757031\)\] \[[^\r\n]*?\(495469022\)\]/u.test(clean)){
    add('receivedExpectedCaller',time);if(clean.includes('QQ链路定位20261125B'))add('freshTestMarker',time);
   }
  }
  for(const [key,re]of Object.entries(errors))if(re.test(clean))out.markers[key]=(out.markers[key]??0)+1;
 }
 return out;
}
export function collectNativeReception(run=spawnSync){
 const emit=(section,value)=>console.log(JSON.stringify({section,...value})),errors=[];
 const read=args=>{const r=run('docker',args,{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});if(r.status!==0||r.error)throw Error('BOUNDED_READ_FAILED');return r;};
 emit('nativeReceptionAudit',{at:new Date().toISOString(),scope:'READ_ONLY_NO_MANAGEMENT_AUTH'});
 try{const c=JSON.parse(read(['inspect','mooyu-qq-napcat-1']).stdout)[0];emit('gateway',{image:c.Image,running:c.State.Running,restarts:c.RestartCount,startedAt:c.State.StartedAt});}catch{errors.push('gateway');}
 try{emit('nativeProcessAndLogging',JSON.parse(read(['exec','mooyu-qq-napcat-1','node','--input-type=module','-e',NATIVE_RECEPTION_PROBE]).stdout));}catch{errors.push('nativeProcessAndLogging');}
 try{const r=read(['logs','--since','2026-11-24T05:00:00Z','--tail','10000','--timestamps','mooyu-qq-napcat-1']);emit('nativeReceiveCounters',{boundedToLastLines:10000,...nativeReceptionLogSummary(String(r.stdout??'')+'\n'+String(r.stderr??''))});}catch{errors.push('nativeReceiveCounters');}
 emit('readOnlyEnd',{errors,managementAuthRequests:0,qqLoginRequested:false,messagesSent:false,configurationWritten:false,servicesRestarted:false,oldTasksRetried:false,rawLogsOrCredentialsPrinted:false});return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){if(collectNativeReception().length)process.exitCode=1;}
