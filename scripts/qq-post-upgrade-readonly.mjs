// Read-only diagnostics: no refresh, login, maintain, SetConfig or restart.
import {spawnSync} from 'node:child_process';
const workerCode=String.raw`
import fs from 'node:fs';import dns from 'node:dns/promises';import os from 'node:os';
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const config=JSON.parse(fs.readFileSync('/config/config.json','utf8'));
const control=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:process.env.QQ_ACCESS_TOKEN});
const report={expectedBot:config.botId,expectedGroup:config.groupId};
try{const s=await control.post('/QQLogin/CheckLoginStatus');report.gatewayLogin={isLogin:s.isLogin===true,isOffline:s.isOffline===true,coreReady:s.coreReady===true,phase:['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting'].includes(s.loginPhase)?s.loginPhase:'unknown'};report.observed=await control.inspect(config);}catch(e){report.gatewayReadError=/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'GATEWAY_READ_FAILED';}
try{const r=await fetch('http://127.0.0.1:'+String(config.port??6700)+'/health',{signal:AbortSignal.timeout(5000)}),s=await r.json();report.workerTransport={httpStatus:r.status,connected:s.connected===true};}catch{report.workerTransport={readFailed:true};}
try{const c=await control.post('/OB11Config/GetConfig');report.reverseWebsocketClients=(c.network?.websocketClients??[]).map(v=>{let u;try{u=new URL(v.url);}catch{}return {managed:['mooyu-server','mooyu-admin-managed'].includes(v.name),enabled:v.enable===true,host:u&&/^[a-zA-Z0-9._-]+$/.test(u.hostname)?u.hostname:'invalid-or-redacted',port:u?.port,expectedPath:u?.pathname==='/onebot/v11',tokenMatchesWorker:v.token===process.env.QQ_ACCESS_TOKEN};});}catch(e){report.websocketConfigReadError=/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'CONFIG_READ_FAILED';}
const own=new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(v=>v.address));
for(const name of ['napcat','worker']){try{const addresses=await dns.lookup(name,{all:true});report[name+'Dns']={resolves:true,addressCount:addresses.length,...(name==='worker'?{includesCurrentWorker:addresses.some(a=>own.has(a.address))}:{})};}catch{report[name+'Dns']={resolves:false};}}
console.log(JSON.stringify(report));
`;
const gatewayCode=String.raw`
const dns=require('node:dns').promises;(async()=>{const report={};try{const a=await dns.lookup('worker',{all:true});report.workerDns={resolves:true,addressCount:a.length};}catch{report.workerDns={resolves:false};}try{const r=await fetch('http://worker:6700/health',{signal:AbortSignal.timeout(5000)}),s=await r.json();report.workerHealthFromGateway={httpStatus:r.status,connected:s.connected===true};}catch{report.workerHealthFromGateway={reachable:false};}console.log(JSON.stringify(report));})();
`;
const names=['mooyu-qq-napcat-1','mooyu-qq-worker-1','gamehub-production-api-1'];
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:65000,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw Error('READONLY_DOCKER_FAILED');return (args[0]==='logs'?r.stdout+'\n'+r.stderr:r.stdout).trim();}
const cs=JSON.parse(docker(['inspect',...names]));console.log('containers '+JSON.stringify(cs.map(c=>({name:c.Name,image:c.Image,running:c.State.Running,status:c.State.Status,restarts:c.RestartCount,startedAt:c.State.StartedAt,health:c.State.Health?.Status??null}))));
for(const [name,args]of [['workerAndLogin',['exec','mooyu-qq-worker-1','node','--input-type=module','-e',workerCode]],['gatewayToWorker',['exec','mooyu-qq-napcat-1','node','-e',gatewayCode]]]){try{console.log(name+' '+docker(args));}catch{console.log(name+' '+JSON.stringify({readFailed:true}));}}
for(const container of names.slice(0,2)){try{const text=docker(['logs','--since','30m','--tail','250',container]),counts={};for(const [key,regex]of Object.entries({reconnect:/reconnect|重连/gi,offline:/offline|离线/gi,timeout:/timeout|超时/gi,kicked:/kicked|kickoff|被踢|强制下线/gi,nativeCrash:/SIGSEGV|segmentation fault|core dumped/gi,connected:/gateway-connected/g})){counts[key]=[...text.matchAll(regex)].length;}const events=[];for(const line of text.split(/\r?\n/)){try{const j=JSON.parse(line);if(typeof j.event==='string'&&/^[a-z-]{1,60}$/.test(j.event))events.push({event:j.event,...(/^[A-Z0-9_]{1,80}$/.test(j.code??'')?{code:j.code}:{}),...(/^\d{4}-/.test(j.at??'')?{at:j.at}:{})});}catch{}}console.log('logMarkers '+JSON.stringify({container,counts,workerEvents:events.slice(-12)}));}catch{console.log('logMarkers '+JSON.stringify({container,readFailed:true}));}}
console.log('DIAGNOSTIC '+JSON.stringify({readOnly:true,qqLoginRequested:false,websocketConfigChanged:false,servicesRestarted:false,loginDataChanged:false,rawLogsAndCredentialsPrinted:false}));
