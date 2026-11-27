// UI observer for this isolated lab. Resolve Docker's current ephemeral loopback
// port on every operation; docker stop/start may assign a different host port.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {qqSignature} from '../apps/api/src/qq-admin-protocol.mjs';
const root=path.resolve(import.meta.dirname,'..');
export async function startLocalQQObserver({lab,privateDir,port=0}){
 if(!/^qq_owner_local_[a-f0-9]{20}$/.test(lab.labId??''))throw Error('LOCAL_LAB_REQUIRED');
 const id=lab.labId.slice('qq_owner_local_'.length),s=JSON.parse(fs.readFileSync(path.join(privateDir,'worker.private.json'),'utf8'));
 if(s.lab!==true||s.labId!==lab.labId||s.marker!=='本地QQ验收20261127'||lab.worker!=='right-qq-owner-'+id+'-worker')throw Error('LOCAL_TEST_SCOPE_REQUIRED');
 function currentControlPort(){
  const r=spawnSync('docker',['inspect',lab.worker],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  if(r.status!==0)throw Error('LOCAL_WORKER_UNAVAILABLE');const c=JSON.parse(r.stdout)[0],binding=c.NetworkSettings.Ports['6780/tcp']?.[0];
  if(c.Config.Labels?.['right.qq.owner-local']!==id||!c.State.Running||binding?.HostIp!=='127.0.0.1'||!/^\d+$/.test(binding.HostPort))throw Error('LOCAL_CONTROL_BINDING_REQUIRED');
  return Number(binding.HostPort);
 }
 const controlPort=currentControlPort();
 async function control(operation,args={},requestId=crypto.randomUUID()){
  const body=JSON.stringify({operation,actorId:s.env.QQ_ADMIN_AGENT_USER_ID,agentUserId:s.env.QQ_ADMIN_AGENT_USER_ID,args}),time=String(Date.now());
  const r=await fetch('http://127.0.0.1:'+currentControlPort()+'/control',{method:'POST',headers:{'content-type':'application/json','x-qq-time':time,'x-qq-request':requestId,'x-qq-signature':qqSignature(s.secret,time,requestId,body)},body,signal:AbortSignal.timeout(12000)});
  return {status:r.status,value:await r.json()};
 }
 const action=crypto.randomBytes(24).toString('hex'),{build:bundle}=createRequire(import.meta.url)('../tests/browser-build.cjs');
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import QQ from './packages/platform-client/src/AgentQQAdmin.jsx';import './packages/platform-client/src/styles.css';
const call=async(operation,args={},requestId)=>{const r=await fetch('/control',{method:'POST',headers:{'content-type':'application/json','x-local-action':${JSON.stringify(action)}},body:JSON.stringify({operation,args,requestId})});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error?.code),{code:v.error?.code,status:r.status});return v;};
const api={getAdminAgentQQ:()=>call('status'),getAdminAgentQQCode:()=>call('qr'),refreshAdminAgentQQCode:(_,b)=>call('refresh',{expectedLoginRevision:b.expectedLoginRevision},b.requestId),updateAdminAgentQQ:(_,b)=>call('configure',{expectedRevision:b.expectedRevision,settings:b.settings},b.requestId),loginAdminAgentQQPassword:()=>Promise.reject(Error('本地验收仅使用扫码登录'))};
createRoot(document.getElementById('root')).render(<main className='agent-admin__body' style={{maxWidth:840,margin:'20px auto',padding:20}}><section className='agent-control-card'><h2>QQ 本地隔离验收</h2><p>已授权使用专用 QQ。此处不连接线上数据库，不调用模型。仅处理原群中的“本地QQ验收20261127”测试消息，固定回复“本地验收收到20261127”。</p></section><QQ api={api} agentId='${s.env.QQ_ADMIN_AGENT_USER_ID}'/></main>);`;
 const built=await bundle({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',nodePaths:[path.join(root,'packages/platform-client/node_modules')],logLevel:'silent'});
 const server=http.createServer(async(req,res)=>{
  const send=(status,type,data)=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"});res.end(data);};
  if(req.headers.host!=='127.0.0.1:'+server.address().port)return send(403,'text/plain','LOCAL_ONLY');
  if(req.method==='GET'&&req.url==='/')return send(200,'text/html; charset=utf-8','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QQ 本地隔离验收</title><div id="root"></div><script src="/app.js"></script></html>');
  if(req.method==='GET'&&req.url==='/app.js')return send(200,'application/javascript',built.outputFiles[0].text);
  if(req.method==='POST'&&req.url==='/control'&&req.headers['x-local-action']===action){try{
   const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>16384)throw Error();chunks.push(c);}const command=JSON.parse(Buffer.concat(chunks));
   if(!['status','qr','refresh','configure'].includes(command.operation))throw Error();const r=await control(command.operation,command.args,command.requestId);return send(r.status,'application/json',JSON.stringify(r.value));
  }catch{return send(503,'application/json',JSON.stringify({error:{code:'QQ_CONTROL_UNAVAILABLE'}}));}}
  if(req.method==='GET'&&req.url==='/local-status'){try{const r=await control('status'),d=r.value.data;return send(r.status,'application/json',JSON.stringify({runtime:d?.runtime,status:d?.status,paperEnabled:d?.paperEnabled}));}catch{return send(503,'application/json','{}');}}
  send(404,'text/plain','NOT_FOUND');
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,controlPort};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const directory=path.resolve(process.argv[2]??'');if(!directory.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\20261127\\'))throw Error('LOCAL_LAB_DIRECTORY_REQUIRED');
 const lab=JSON.parse(fs.readFileSync(path.join(directory,'lab.json'),'utf8')),url=new URL(lab.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('LOCAL_URL_REQUIRED');
 const {server}=await startLocalQQObserver({lab,privateDir:path.join(directory,'private'),port:Number(url.port)});
 const close=()=>server.close();process.once('SIGTERM',close);process.once('SIGINT',close);
 console.log(JSON.stringify({result:'LOCAL_QQ_OBSERVER_ATTACHED',url:lab.url,containersRestarted:false}));
}
