import http from 'node:http';import https from 'node:https';import net from 'node:net';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';
const {WebSocket,WebSocketServer}=createRequire(new URL('../../apps/realtime/package.json',import.meta.url))('ws');
export async function createProxyWebSocketFixture(){
 const cert=await readFile(new URL('./fixtures/https/loopback-test-cert.pem',import.meta.url)),key=await readFile(new URL('./fixtures/https/loopback-test-key.pem',import.meta.url));
 const secure=https.createServer({cert,key}),wss=new WebSocketServer({server:secure,path:'/v1/realtime'}),sockets=new Set(),stats={connects:0,connections:0,proxyAuthorization:false,accountAuthorization:false};
 wss.on('connection',(ws,req)=>{stats.connections++;stats.accountAuthorization ||= !!req.headers.authorization;ws.send(JSON.stringify({v:1,type:'session.ready',payload:{heartbeatIntervalMs:20000}}));});
 await new Promise(r=>secure.listen(0,'127.0.0.1',r));
 const proxy=http.createServer();proxy.on('connect',(req,client,head)=>{
   stats.connects++;stats.proxyAuthorization ||= !!req.headers['proxy-authorization'];
   if(!['127.0.0.1:9','localhost:9'].includes(req.url)){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
   const upstream=net.connect(secure.address().port,'127.0.0.1');sockets.add(client);sockets.add(upstream);
   client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>{sockets.delete(client);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});
   upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
 });
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 class TrustedFixtureSocket extends WebSocket {constructor(url,options){super(url,{...options,ca:cert});}}
 return {origin:'https://127.0.0.1:9',rule:'PROXY 127.0.0.1:'+proxy.address().port,proxyAddress:'127.0.0.1:'+proxy.address().port,stats,WebSocket,TrustedFixtureSocket,
   ticket(origin='https://127.0.0.1:9'){return {websocketUrl:origin.replace('https:','wss:')+'/v1/realtime',ticket:'a'.repeat(43),expiresAt:new Date(Date.now()+30000).toISOString()};},
   async close(){for(const ws of wss.clients)ws.terminate();for(const s of sockets)s.destroy();await new Promise(r=>wss.close(r));secure.closeAllConnections();proxy.closeAllConnections();await Promise.all([new Promise(r=>secure.close(r)),new Promise(r=>proxy.close(r))]);}};
}
