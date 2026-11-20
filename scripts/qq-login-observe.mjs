// Attach to an existing isolated test gateway without changing its data or lifecycle.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {loginState,localGatewayOrigin} from './qq-login-lab.mjs';

async function main(){
 const root=path.resolve('E:/CODE/Right/private-deployments/qq-login-repro'),directory=path.resolve(process.argv[2]??'');
 if(path.dirname(directory)!==root||fs.lstatSync(directory).isSymbolicLink())throw Error('LAB_SESSION_NOT_ISOLATED');
 const session=JSON.parse(fs.readFileSync(path.join(directory,'session.json'),'utf8')),id=path.basename(directory);
 if(session.container!=='mooyu-qq-login-lab-'+id||!/^\d{14}-[a-f0-9]{6}$/u.test(id)||!/^[a-f0-9]{64}$/u.test(session.token))throw Error('LAB_SESSION_INVALID');
 const evidence=path.resolve('E:/CodexData/build/Right/qq-login-repro',id),stamp=Date.now();
 function inspect(){const r=spawnSync('docker',['inspect',session.container],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1e6});if(r.status!==0)throw Error('LAB_CONTAINER_UNAVAILABLE');const info=JSON.parse(r.stdout)[0];if(info.Config.Labels?.['mooyu.qq-login-lab']!==id)throw Error('LAB_CONTAINER_IDENTITY_MISMATCH');return info;}
 inspect();let credential,state={phase:'starting'},checking=false,firstReady=null,previous='',lastWrite=0;
 async function post(endpoint,body={},auth=true){
  if(auth&&!credential)credential=(await post('/auth/login',{hash:createHash('sha256').update(session.token+'.napcat').digest('hex')},false)).Credential;
  const response=await fetch(localGatewayOrigin(inspect())+'/api'+endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+credential}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
  const value=await response.json();if(!response.ok||value.code!==0){credential=null;throw Error('LAB_API_UNAVAILABLE');}return value.data;
 }
 async function observe(){if(checking)return;checking=true;try{const info=inspect();let value;try{value=loginState(await post('/QQLogin/CheckLoginStatus'));}catch{credential=null;value={phase:'unavailable',loggedIn:false,coreReady:false,offline:true};}if(value.loggedIn&&value.coreReady)firstReady??=Date.now();else firstReady=null;state={...value,containerStatus:info.State.Status,oomKilled:info.State.OOMKilled,restarts:info.RestartCount,continuousReadySeconds:firstReady?Math.floor((Date.now()-firstReady)/1000):0,paperEnabled:false};const signature=JSON.stringify({...state,continuousReadySeconds:0});if(signature!==previous||Date.now()-lastWrite>30000){const entry={at:new Date().toISOString(),...state};fs.appendFileSync(path.join(evidence,'recovery-timeline-'+stamp+'.jsonl'),JSON.stringify(entry)+'\n');console.log(JSON.stringify(entry));previous=signature;lastWrite=Date.now();}}finally{checking=false;}}
 const require=createRequire(path.resolve(import.meta.dirname,'../packages/platform-client/package.json')),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{QRCodeSVG}=require('qrcode.react'),action=randomBytes(24).toString('hex');
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QQ 重启恢复验收</title><style>body{font:16px system-ui;max-width:620px;margin:40px auto;padding:20px;background:#15131c;color:#eee}button{padding:12px;margin:8px}#qr{display:inline-block;background:white}pre{white-space:pre-wrap}</style><h1>QQ 重启恢复验收</h1><p>原独立测试实例，登录资料及历史已保留。请扫码并在手机确认。仅限测试群和允许账号，论文关闭。</p><button id="refresh">刷新二维码</button><div id="qr"></div><p id="message"></p><pre id="state"></pre><script src="/observe.js"></script></html>';
 const script=`const headers={'X-Lab-Action':${JSON.stringify(action)}};document.querySelector('#refresh').onclick=async()=>{try{const r=await fetch('/refresh',{method:'POST',headers});if(!r.ok)throw Error();document.querySelector('#qr').innerHTML=await r.text();document.querySelector('#message').textContent='请扫码并在手机确认。';}catch{document.querySelector('#message').textContent='二维码暂不可用，请查看状态。';}};async function poll(){try{const s=await(await fetch('/status')).json();document.querySelector('#state').textContent=JSON.stringify(s,null,2);if(s.loggedIn)document.querySelector('#qr').replaceChildren();}catch{}}setInterval(poll,2000);poll();`;
 const server=http.createServer(async(req,res)=>{const send=(code,type,body)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"});res.end(body);};if(req.headers.host!==`127.0.0.1:${server.address().port}`)return send(403,'text/plain','LOCAL_ONLY');try{
  if(req.method==='GET'&&req.url==='/')return send(200,'text/html; charset=utf-8',html);
  if(req.method==='GET'&&req.url==='/observe.js')return send(200,'text/javascript',script);
  if(req.method==='GET'&&req.url==='/status')return send(200,'application/json',JSON.stringify(state));
  if(req.method==='POST'&&req.url==='/refresh'&&req.headers['x-lab-action']===action){if((await post('/QQLogin/CheckLoginStatus')).isLogin)return send(409,'text/plain','ALREADY_LOGGED_IN');await post('/QQLogin/RefreshQRcode');const value=await post('/QQLogin/GetQQLoginQrcode'),url=new URL(value.qrcode);if(url.protocol!=='https:'||!(url.hostname==='qq.com'||url.hostname.endsWith('.qq.com'))||url.username||url.password||url.href.length>4096)throw Error('LAB_QR_INVALID');return send(200,'image/svg+xml',renderToStaticMarkup(React.createElement(QRCodeSVG,{value:url.href,size:240,marginSize:4})));}
  send(404,'text/plain','NOT_FOUND');
 }catch{send(503,'text/plain','LAB_GATEWAY_UNAVAILABLE');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address='http://127.0.0.1:'+server.address().port;
 fs.writeFileSync(path.join(evidence,'recovery-dashboard-'+stamp+'.json'),JSON.stringify({address,paperEnabled:false,existingGateway:true}));console.log(JSON.stringify({event:'recovery-observer-ready',address,paperEnabled:false}));await observe();setInterval(()=>observe().catch(()=>{}),2000);
}
main().catch(()=>{console.error('QQ_RECOVERY_OBSERVER_FAILED; gateway and login data retained');process.exitCode=1;});
