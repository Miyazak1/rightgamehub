import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBusinessTestProxy} from '../../apps/api/src/desktop-business-test-gateway.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const stop=server=>{server.closeAllConnections();server.close();};
const partialUpload=port=>new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port,path:'/v1/me/paper-studies',method:'POST',headers:{'Content-Length':2*1024*1024}},response=>{
    response.resume();response.on('end',()=>{resolve({status:response.statusCode,connection:response.headers.connection});request.destroy();});
  });request.setTimeout(3000,()=>request.destroy(Error('TEST_RESPONSE_TIMEOUT')));request.on('error',reject);request.write(Buffer.alloc(1024));
});

test('unavailable upstream closes an incomplete upload and permits a fresh request after recovery',async t=>{
  const upstream=http.createServer((_req,res)=>res.end('recovered'));const port=await listen(upstream);await new Promise(r=>upstream.close(r));
  const proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port});const proxyPort=await listen(proxy);
  t.after(()=>{stop(proxy);stop(upstream);});
  assert.deepEqual(await partialUpload(proxyPort),{status:503,connection:'close'});
  await new Promise(r=>upstream.listen(port,'127.0.0.1',r));
  assert.equal(await(await fetch('http://127.0.0.1:'+proxyPort+'/healthy')).text(),'recovered');
});

test('upstream timeout closes an incomplete upload without breaking later complete reads',async t=>{
  const upstream=http.createServer((req,res)=>{if(req.url==='/healthy')res.end('healthy');else req.resume();});
  const port=await listen(upstream),proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port,upstreamTimeoutMs:50});const proxyPort=await listen(proxy);
  t.after(()=>{stop(proxy);stop(upstream);});
  assert.deepEqual(await partialUpload(proxyPort),{status:503,connection:'close'});
  assert.equal(await(await fetch('http://127.0.0.1:'+proxyPort+'/healthy')).text(),'healthy');
});

test('generated 503 for a completed request preserves downstream keep-alive',async t=>{
  const upstream=http.createServer((req,res)=>{req.resume();req.on('end',()=>{if(req.url==='/error')req.socket.destroy();else res.end('healthy');});});
  const port=await listen(upstream),proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port});const proxyPort=await listen(proxy);
  const agent=new http.Agent({keepAlive:true,maxSockets:1});let connections=0;proxy.on('connection',()=>connections++);
  t.after(()=>{agent.destroy();stop(proxy);stop(upstream);});
  const request=path=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:proxyPort,path,method:'POST',agent,headers:{'Content-Length':2}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,connection:res.headers.connection}));});req.on('error',reject);req.end('{}');});
  assert.deepEqual(await request('/error'),{status:503,connection:'keep-alive'});
  assert.equal((await request('/healthy')).status,200);assert.equal(connections,1);
});

test('early rejection of an unfinished upload closes the downstream connection before reuse',async t=>{
  const upstream=http.createServer((req,res)=>{res.writeHead(401);res.end('unauthorized');});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port:upstream.address().port});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  t.after(()=>{proxy.closeAllConnections();proxy.close();upstream.closeAllConnections();upstream.close();});
  const connection=await new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port:proxy.address().port,path:'/v1/me/paper-studies',method:'POST',headers:{'Content-Length':2*1024*1024}},response=>{
      response.resume();response.on('end',()=>{resolve(response.headers.connection);request.destroy();});
    });request.on('error',reject);request.write(Buffer.alloc(1024));
  });assert.equal(connection,'close');
});

test('local proxy retains completed keep-alive sockets across large private PDF responses',async t=>{
  const body=JSON.stringify({data:{pdfBase64:'x'.repeat(3*1024*1024)}});let connections=0;
  const upstream=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(body);});
  upstream.on('connection',()=>connections++);await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port:upstream.address().port});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  t.after(()=>{proxy.closeAllConnections();proxy.close();upstream.closeAllConnections();upstream.close();});
  for(let i=0;i<8;i++){const r=await fetch('http://127.0.0.1:'+proxy.address().port+'/v1/me/paper-studies/id/source',{signal:AbortSignal.timeout(5000)});assert.equal(await r.text(),body);}
  assert.ok(connections<=2,'completed requests must leave upstream keep-alive connections reusable');
});

test('interrupted upstream response does not crash the proxy or corrupt a later read',async t=>{
  const upstream=http.createServer((req,res)=>{if(req.url==='/broken'){res.writeHead(200);res.write('partial');setImmediate(()=>res.destroy());}else res.end('healthy');});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const proxy=createDesktopBusinessTestProxy({hostname:'127.0.0.1',port:upstream.address().port});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  t.after(()=>{proxy.closeAllConnections();proxy.close();upstream.closeAllConnections();upstream.close();});
  const base='http://127.0.0.1:'+proxy.address().port;
  await fetch(base+'/broken',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(r.status===503)return;await assert.rejects(r.text());},()=>{});
  assert.equal(await(await fetch(base+'/healthy')).text(),'healthy');
});
