import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

export function loginState(value){return {phase:['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing','ready','offline','failed','reconnecting'].includes(value?.loginPhase)?value.loginPhase:'unknown',loggedIn:value?.isLogin===true,coreReady:value?.coreReady===true,offline:value?.isOffline===true};}
export function nativeEvents(text){return text.split(/\r?\n/u).filter(line=>/SIGSEGV|SEGV_ACCERR|Signal code:|error addr:|Native stack:|\$\$\d+\s+pc\s|handleSignal/u.test(line)&&!(/群聊|私聊|收\s*<-|发\s*->/u.test(line))).slice(-30).map(line=>line.replace(/https?:\/\/[^\s]+/gu,'[URL]').replace(/(?<![a-zA-Z0-9])\d{8,}(?![a-zA-Z0-9])/gu,'[ID]').slice(0,500));}
export const componentProbe=`const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),base=fs.existsSync('/opt/qq/package.json')?'/opt/qq':'/app',napcat=base==='/app'?'/app/napcat':'/opt/napcat';const out={node:process.version,arch:process.arch,kernel:os.release(),libc:process.report.getReport().header.glibcVersionRuntime,components:{}};for(const [name,file]of [['qq',base+'/package.json'],['napcat',napcat+'/package.json']]){try{out[name]=JSON.parse(fs.readFileSync(file)).version;}catch{out[name]=null;}}for(const file of [base==='/app'?'/app/node_addon.node':'/opt/node_addon.node',base+'/wrapper.node',base+'/sharp-lib/libvips-cpp.so.42',napcat+'/native/napi2native/napi2native.linux.x64.node',napcat+'/native/packet/MoeHoo.linux.x64.node',napcat+'/napcat.mjs']){try{out.components[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch{out.components[file]=null;}}console.log(JSON.stringify(out));`;

async function main(){
 const worktree=path.resolve(import.meta.dirname,'..'),stamp=new Date().toISOString().replace(/[^0-9]/gu,'').slice(0,14),id=stamp+'-'+randomBytes(3).toString('hex');
 const privateRoot=path.resolve('E:/CODE/Right/private-deployments/qq-login-repro');
 const privateDir=path.join(privateRoot,id),evidence=path.join('E:/CodexData/build/Right/qq-login-repro',id);
 const options=process.argv.slice(2),image=options.includes('--image')?options[options.indexOf('--image')+1]:'mooyu-qq-gateway:20261119-verified';
 const upstream='ghcr.io/napneko/nodenapcat@sha256:9f35df29e9f0a92f737143e123b9159b998c314a573139b5ac0e6bd4ab5af574',isUpstream=image===upstream;
 if(!['mooyu-qq-gateway:20261119-verified','mooyu-qq-lab-node20:20261120','mooyu-qq-lab-qq52194:20261120','mooyu-qq-lab-system-zlib:20261120',upstream].includes(image))throw Error('LAB_IMAGE_NOT_ALLOWED');
 const name='mooyu-qq-login-lab-'+id,actionKey=randomBytes(24).toString('hex');let token=randomBytes(32).toString('hex'),seedUsed=false;
 fs.mkdirSync(path.join(privateDir,'data'),{recursive:true});fs.mkdirSync(evidence,{recursive:true});
 function docker(args,optional=false){const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2*1024**2});if(result.status!==0&&!optional)throw Error('LAB_DOCKER_'+args[0].toUpperCase()+'_FAILED');return result;}
 if(options.includes('--seed')){
  const seed=path.resolve(options[options.indexOf('--seed')+1]??'');
  if(path.dirname(seed)!==privateRoot||fs.lstatSync(seed).isSymbolicLink())throw Error('LAB_SEED_NOT_ISOLATED');
  const record=JSON.parse(fs.readFileSync(path.join(seed,'session.json'),'utf8'));
  if(!/^mooyu-qq-login-lab-[0-9]{14}-[a-f0-9]{6}$/u.test(record.container)||JSON.parse(docker(['inspect',record.container]).stdout)[0].State.Running)throw Error('LAB_SEED_STILL_RUNNING');
  if(!/^[a-f0-9]{64}$/u.test(record.token))throw Error('LAB_SEED_INVALID');
  fs.cpSync(path.join(seed,'data'),path.join(privateDir,'data'),{recursive:true,errorOnExist:true,force:false});token=record.token;seedUsed=true;
 }
 const imageInfo=JSON.parse(docker(['image','inspect',image]).stdout)[0];
 const flags=['--read-only','--init','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1g','--cpus','1','--ulimit','core=0','--restart','no','--tmpfs','/tmp:size=128m,nosuid','--log-driver','json-file','--log-opt','max-size=5m','--log-opt','max-file=2'];
 const env={HOME:'/data/home',NAPCAT_WORKDIR:'/data/napcat',NAPCAT_QQ_DATA_DIR:'/data/qq',NAPCAT_DISABLE_MULTI_PROCESS:'1',NAPCAT_DISABLE_BYPASS:'1',QQ_WEBUI_TOKEN:token,QQ_ACCESS_TOKEN:randomBytes(32).toString('hex'),PAPER_STUDY_ENABLED:'false',PAPER_STUDY_WORKER_ENABLED:'false',PAPER_STUDY_MODELS_ENABLED:'false',PAPER_STUDY_PUBLISH_ENABLED:'false'};
 if(options.includes('--no-preload'))env.LD_PRELOAD='';
 if(options.includes('--no-library-path'))env.LD_LIBRARY_PATH='';
 const extraMounts=[];
 if(options.includes('--without-packet-adapter')){
  const empty=path.join(privateDir,'empty-packet-adapter');fs.mkdirSync(empty);
  extraMounts.push('--mount',`type=bind,source=${empty},target=/opt/napcat/native/packet,readonly`);
 }
 if(isUpstream){
  if(seedUsed)throw Error('LAB_UPSTREAM_REQUIRES_FRESH_DATA');
  const configDir=path.join(privateDir,'data/napcat/config');fs.mkdirSync(configDir,{recursive:true});
  fs.writeFileSync(path.join(configDir,'webui.json'),JSON.stringify({host:'0.0.0.0',port:6099,prefix:'',token,loginRate:3,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false}),{mode:0o600,flag:'wx'});
  extraMounts.push('--user','1000:1000','--workdir','/app','--entrypoint','node');
 }
 // Gateway only. The upstream image's shell entrypoint is deliberately never executed.
 docker(['run','-d','--name',name,'--label','mooyu.qq-login-lab='+id,...flags,'-p','127.0.0.1::6099','--mount',`type=bind,source=${path.join(privateDir,'data')},target=/data`,...extraMounts,...Object.entries(env).flatMap(([key,value])=>['--env',key+'='+value]),imageInfo.Id,...(isUpstream?['/app/load.cjs']:[])]);
 const info=()=>JSON.parse(docker(['inspect',name]).stdout)[0];
 const initial=info(),binding=initial.NetworkSettings.Ports['6099/tcp']?.[0];
 if(binding?.HostIp!=='127.0.0.1')throw Error('LAB_PORT_NOT_LOCAL');
 const origin='http://127.0.0.1:'+binding.HostPort;
 fs.writeFileSync(path.join(privateDir,'session.json'),JSON.stringify({container:name,imageId:imageInfo.Id,origin,token,evidence,paperEnabled:false},null,2),{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(evidence,'baseline.json'),JSON.stringify({container:name,imageId:imageInfo.Id,platform:imageInfo.Os+'/'+imageInfo.Architecture,memory:initial.HostConfig.Memory,nanoCpus:initial.HostConfig.NanoCpus,readOnly:initial.HostConfig.ReadonlyRootfs,restartPolicy:initial.HostConfig.RestartPolicy.Name,bypassDisabled:true,packetAdapterDisabled:options.includes('--without-packet-adapter'),preloadOverride:options.includes('--no-preload')?'disabled':'image-default',libraryPathOverride:options.includes('--no-library-path')?'disabled':'image-default',mounts:initial.Mounts.map(m=>({destination:m.Destination,rw:m.RW,type:m.Type})),freshLoginData:!seedUsed,seedUsed,workerConnected:false,modelConfigured:false,paperEnabled:false},null,2));
 const probe=docker(['exec',name,'node','-e',componentProbe],true);if(probe.status===0)fs.writeFileSync(path.join(evidence,'components.json'),probe.stdout);
 let credential=null,state={phase:'starting',loggedIn:false,coreReady:false,offline:false},previous='',lastWrite=0,firstReady=null,stopped=false,checking=false;
 const timeline=path.join(evidence,'timeline.jsonl');
 async function post(endpoint,body={},auth=true){
  if(auth&&!credential){const reply=await post('/auth/login',{hash:createHash('sha256').update(token+'.napcat').digest('hex')},false);if(typeof reply?.Credential!=='string')throw Error('LAB_AUTH_UNAVAILABLE');credential=reply.Credential;}
  const response=await fetch(origin+'/api'+endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
  if(Number(response.headers.get('content-length'))>100000)throw Error('LAB_RESPONSE_TOO_LARGE');const data=await response.json();if(!response.ok||data.code!==0){credential=null;throw Error('LAB_GATEWAY_UNAVAILABLE');}return data.data;
 }
 async function observe(){
  if(checking)return;checking=true;
  try{
   const current=info(),running=current.State.Running;
   try{state=loginState(await post('/QQLogin/CheckLoginStatus'));}catch{state={phase:running?'unavailable':'exited',loggedIn:false,coreReady:false,offline:true};}
   if(state.loggedIn&&state.coreReady){if(!firstReady)firstReady=Date.now();}else firstReady=null;
   const safe={...state,containerStatus:current.State.Status,exitCode:current.State.ExitCode,oomKilled:current.State.OOMKilled,restarts:current.RestartCount,continuousReadySeconds:firstReady?Math.floor((Date.now()-firstReady)/1000):0,paperEnabled:false};
   const signature=JSON.stringify({...safe,continuousReadySeconds:0});
   if(signature!==previous||Date.now()-lastWrite>30000){fs.appendFileSync(timeline,JSON.stringify({at:new Date().toISOString(),...safe})+'\n');previous=signature;lastWrite=Date.now();console.log(JSON.stringify({event:'login-lab-status',...safe}));}
   state=safe;
   if(!running&&!stopped){stopped=true;const logs=docker(['logs','--tail','12000',name],true);fs.writeFileSync(path.join(evidence,'native-events.redacted.json'),JSON.stringify(nativeEvents(logs.stdout+'\n'+logs.stderr),null,2));}
  }finally{checking=false;}
 }
 const frontendRequire=createRequire(path.join(worktree,'packages/platform-client/package.json'));
 const React=frontendRequire('react'),{renderToStaticMarkup}=frontendRequire('react-dom/server'),{QRCodeSVG}=frontendRequire('qrcode.react');
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QQ 隔离登录测试</title><style>body{font:16px system-ui;max-width:640px;margin:40px auto;padding:20px;background:#15131c;color:#eee}button{padding:12px;margin:8px}#qr{background:white;display:inline-block}pre{white-space:pre-wrap}small{line-height:1.8}</style><h1>QQ 隔离登录测试</h1><p>请使用独立测试账号。此实例没有问答 worker 或模型，不发送测试消息。</p>${seedUsed?'<button id="quick">使用已保存测试会话</button>':''}<button id="show">显示二维码</button><button id="refresh">刷新二维码</button><div><div id="qr"></div></div><p id="message"></p><pre id="state"></pre><small>只监听本机；新的测试登录数据单独保留。线上服务与历史保持原样，论文关闭。</small><script src="/lab.js"></script></html>`;
 const script=`const headers={'X-Lab-Action':${JSON.stringify(actionKey)}};async function qr(refresh){document.querySelector('#message').textContent='正在读取…';try{const r=await fetch(refresh?'/refresh':'/qr',{method:'POST',headers});if(!r.ok)throw Error();document.querySelector('#qr').innerHTML=await r.text();document.querySelector('#message').textContent='请扫码并在手机确认，然后保持页面打开。';}catch{document.querySelector('#message').textContent='二维码暂不可用，请先查看状态。';}}if(document.querySelector('#quick'))document.querySelector('#quick').onclick=async()=>{document.querySelector('#message').textContent='正在使用测试会话登录…';const r=await fetch('/quick-login',{method:'POST',headers});document.querySelector('#message').textContent=r.ok?'登录请求已提交，请等待状态更新。':'测试会话暂不可用，请使用扫码。';};document.querySelector('#show').onclick=()=>qr(false);document.querySelector('#refresh').onclick=()=>qr(true);async function poll(){try{const r=await fetch('/status');const s=await r.json();document.querySelector('#state').textContent=JSON.stringify(s,null,2);if(s.loggedIn)document.querySelector('#qr').replaceChildren();}catch{document.querySelector('#message').textContent='本地观察服务已停止。';}}setInterval(poll,2000);poll();`;
 const server=http.createServer(async(req,res)=>{
  const send=(code,type,body)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"});res.end(body);};
  if(req.headers.host!==`127.0.0.1:${server.address().port}`)return send(403,'text/plain','LOCAL_ONLY');
  try{
   if(req.method==='GET'&&req.url==='/')return send(200,'text/html; charset=utf-8',html);
   if(req.method==='GET'&&req.url==='/lab.js')return send(200,'text/javascript; charset=utf-8',script);
   if(req.method==='GET'&&req.url==='/status')return send(200,'application/json',JSON.stringify(state));
   if(req.method==='POST'&&req.url==='/quick-login'){
    if(!seedUsed||req.headers['x-lab-action']!==actionKey)return send(403,'text/plain','LOCAL_ONLY');
    if((await post('/QQLogin/CheckLoginStatus')).isLogin)return send(409,'text/plain','ALREADY_LOGGED_IN');
    const accounts=await post('/QQLogin/GetQuickLoginList');
    if(!Array.isArray(accounts)||accounts.length!==1||!/^[1-9][0-9]{4,15}$/u.test(accounts[0]))return send(409,'text/plain','USE_QR');
    await post('/QQLogin/SetQuickLogin',{uin:accounts[0]});return send(200,'text/plain','LOGIN_SUBMITTED');
   }
   if(req.method==='POST'&&['/qr','/refresh'].includes(req.url)){
    if(req.headers['x-lab-action']!==actionKey)return send(403,'text/plain','LOCAL_ONLY');
    if((await post('/QQLogin/CheckLoginStatus')).isLogin)return send(409,'text/plain','ALREADY_LOGGED_IN');
    if(req.url==='/refresh')await post('/QQLogin/RefreshQRcode');
    const value=await post('/QQLogin/GetQQLoginQrcode'),url=new URL(value.qrcode);
    if(url.protocol!=='https:'||!(url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))||url.username||url.password||url.href.length>4096)throw Error('INVALID_QR');
    return send(200,'image/svg+xml',renderToStaticMarkup(React.createElement(QRCodeSVG,{value:url.href,size:240,marginSize:4})));
   }
   send(404,'text/plain','NOT_FOUND');
  }catch{send(503,'text/plain','LAB_GATEWAY_UNAVAILABLE');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(evidence,'dashboard.json'),JSON.stringify({address,container:name,privateDir,evidence,paperEnabled:false},null,2));
 console.log(JSON.stringify({event:'login-lab-ready',address,container:name,evidence,privateDir,paperEnabled:false}));
 await observe();const timer=setInterval(()=>observe().catch(()=>{}),2000);
 if(seedUsed&&options.includes('--restore-test-session')){
  try{
   let accounts;
   for(let attempt=0;attempt<10;attempt++){
    try{accounts=await post('/QQLogin/GetQuickLoginList');}catch{}
    if(Array.isArray(accounts)&&accounts.length===1)break;
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(Array.isArray(accounts)&&accounts.length===1&&/^[1-9][0-9]{4,15}$/u.test(accounts[0])&&!(await post('/QQLogin/CheckLoginStatus')).isLogin){
    await post('/QQLogin/SetQuickLogin',{uin:accounts[0]});console.log('Isolated test session login submitted once.');
   }else console.log('Isolated test session unavailable; use the local QR page.');
  }catch{console.log('Isolated test session outcome uncertain; check status, no retry.');}
 }
 const close=()=>{clearInterval(timer);server.close();console.log('Observer stopped; test container and login data retained.');};process.once('SIGINT',close);process.once('SIGTERM',close);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('QQ_LOGIN_LAB_SETUP_FAILED; existing services and test login data retained.');process.exitCode=1;});
