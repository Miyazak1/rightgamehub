// Only status/account reads and bounded diagnostic log-marker reads.
import {spawnSync} from 'node:child_process';
const workerCode=String.raw`
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
const control=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:process.env.QQ_ACCESS_TOKEN}),out={};
try{const s=await control.post('/QQLogin/CheckLoginStatus'),info=await control.post('/QQLogin/GetQQLoginInfo'),error=typeof s.loginError==='string'?s.loginError:'';
out.login={reportedLogin:s.isLogin===true,reportedOffline:s.isOffline===true,reportedCoreReady:s.coreReady===true,reconnecting:s.loginPhase==='reconnecting'};
out.independentCore={online:typeof info.online==='boolean'?info.online:null,expectedBotMatches:String(info.uin)==='3922489710',onlineButLoginFlagFalse:info.online===true&&s.isLogin!==true};
out.reasonMarkers={present:!!error,kicked:/KickedOffLine|被踢|强制下线/i.test(error),selfOffline:/SelfOffline|账号状态变更为离线/i.test(error),anotherLogin:/其他设备|其它设备|其他地方|异地|another|elsewhere/i.test(error),restartFailed:/重启失败|未初始化|无法与主进程通信|restart.*fail/i.test(error),network:/网络|network|timeout|超时/i.test(error)};
}catch(e){out.error=/^QQ_[A-Z0-9_]+$/.test(e.code??'')?e.code:'READ_FAILED';}console.log(JSON.stringify(out));
`;
const gatewayCode=String.raw`
const fs=require('node:fs'),path=require('node:path');const out={singleProcess:process.env.NAPCAT_DISABLE_MULTI_PROCESS==='1'||process.env.NAPCAT_DISABLE_MULTIPROCESSING==='1',workerProcess:process.env.NAPCAT_WORKER_PROCESS==='1',logs:[]};
for(const root of ['/data/napcat/logs','/app/napcat/logs']){if(!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())continue;const files=fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isFile()&&!d.isSymbolicLink()&&/\.(log|txt)$/i.test(d.name)).map(d=>({file:path.join(root,d.name),stat:fs.statSync(path.join(root,d.name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs).slice(0,2);for(const {file,stat}of files){const fd=fs.openSync(file,'r'),b=Buffer.alloc(Math.min(stat.size,131072));try{fs.readSync(fd,b,0,b.length,Math.max(0,stat.size-b.length));}finally{fs.closeSync(fd);}const text=b.toString('utf8'),markers={};for(const [key,re]of Object.entries({kicked:/KickedOffLine/gi,selfOffline:/SelfOffline/g,anotherLogin:/其他设备|其它设备|其他地方|异地/g,offlineState:/账号状态变更为离线/g,restartUninitialized:/重启功能未初始化/g,restartFailed:/登录服务重启失败|无法与主进程通信/g,loginSuccess:/登录成功|Login Success/gi})){markers[key]=[...text.matchAll(re)].length;}out.logs.push({directory:root,modifiedAt:stat.mtime.toISOString(),bytes:stat.size,tailBytesRead:b.length,markers});}}
console.log(JSON.stringify(out));
`;
for(const [section,container,code,module]of [['loginCore','mooyu-qq-worker-1',workerCode,true],['recoveryModeAndLogMarkers','mooyu-qq-napcat-1',gatewayCode,false]]){const r=spawnSync('docker',['exec',container,'node',...(module?['--input-type=module']:[]),'-e',code],{encoding:'utf8',timeout:35000,maxBuffer:1048576});console.log(section+' '+(r.status===0?r.stdout.trim():JSON.stringify({readFailed:true})));}
console.log('READONLY '+JSON.stringify({qqLoginRequested:false,workerRestartRequested:false,configurationWritten:false,rawLogOrLoginErrorPrinted:false}));
