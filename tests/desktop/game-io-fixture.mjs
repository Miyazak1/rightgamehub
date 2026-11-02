import http from 'node:http';
import {randomUUID as id,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url),{WebSocketServer}=createRequire(new URL('../../apps/realtime/package.json',import.meta.url))('ws');
export async function createGameIoFixture({runtime=true}={}){
 const workId=id(),releaseId=id(),modeId=id(),roomId=id(),matchId=id(),shareCode=randomBytes(24).toString('base64url'),gameToken=randomBytes(32).toString('base64url');
 const calls=[],commands=[],tickets=new Set(),sockets=new Set(),shares=new Map();let ticketCount=0,roomRevision=1,origin,runtimeOrigin,runtimeServer,js;
 const profile={id:id(),displayName:'本机能力验收用户',role:'user',canPublish:false,createdAt:new Date().toISOString(),avatar:{kind:'preset',presetKey:'cat'}};
 const mode={id:modeId,workId,key:'local-fixture',name:'本机双人模式',enabled:true,minPlayers:2,maxPlayers:2,authority:'relay_unverified'};
 const room=()=>({id:roomId,modeId,revision:roomRevision,visibility:'invite_only',capacity:2,state:'waiting',status:'waiting',members:[]});
 const match=()=>({id:matchId,roomId,modeId,revision:1,nextEventSeq:1,status:'running'});
 const send=(socket,type,payload={},fields={})=>socket.send(JSON.stringify({v:1,id:id(),type,sentAt:new Date().toISOString(),payload,...fields}));
 const wss=new WebSocketServer({noServer:true,maxPayload:16384});
 wss.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));send(socket,'session.ready',{heartbeatIntervalMs:20000});socket.on('message',data=>{const m=JSON.parse(data);commands.push(m);
   if(m.type==='heartbeat.ping')send(socket,'heartbeat.pong');
   if(m.type==='room.subscribe'||m.type==='session.resume'||m.type==='room.ready'){if(m.type==='room.ready')roomRevision++;send(socket,'room.snapshot',{room:room()});}
   if(m.type==='match.sync.request')send(socket,'match.snapshot',{match:match(),events:[]});
   if(m.type==='match.command')send(socket,'match.event',{event:{seq:1,command:m.payload.command}},{matchId});
 });});
 const server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,origin),p=url.pathname;calls.push({path:p,method:req.method});
   const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({data}));};
   if(p==='/v1/works')return json([work()]);
   if(p==='/v1/works/'+workId)return json(work());
   if(p==='/v1/works/'+workId+'/launch')return json(descriptor());
   if(p==='/v1/works/'+workId+'/leaderboards')return json([]);
   if(p==='/v1/works/'+workId+'/multiplayer-modes')return json([mode]);
   if(p==='/v1/multiplayer/rooms'&&req.method==='GET')return json([room()]);
   if(p.startsWith('/v1/game-shares/')&&req.method==='GET'){const s=shares.get(p.split('/').at(-1));if(!s)throw Error('not found');return json(s);}
   if(req.headers.authorization!=='Bearer local-fixture-access'){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'AUTH_REQUIRED',message:'Local fixture sign-in required'}}));return;}
   let text='';for await(const b of req){text+=b;if(text.length>32768)throw Error('body too large');}const body=text?JSON.parse(text):{};
   if(p==='/v1/auth/session')return json({authenticated:true,profile});
   if(p==='/v1/me')return json(profile);
   if(p==='/v1/me/library')return json([]);
   if(p==='/v1/auth/device/logout')return json({revoked:true});
   if(p==='/v1/game-sessions')return json({gameSessionId:gameToken,expiresAt:new Date(Date.now()+60000).toISOString(),capabilities:['identity','shareLinks']});
   if(p==='/v1/game-sessions/current')return json({revoked:true});
   if(p==='/v1/game-shares'){if(req.headers['x-gamehub-session']!==gameToken)throw Error('bad game token');const value={code:shareCode,workId,releaseId,channel:'production',title:body.title,payload:body.payload,url:origin+'/s/'+shareCode};shares.set(shareCode,value);return json(value);}
   if(p==='/v1/realtime/tickets'){const ticket=randomBytes(32).toString('base64url');tickets.add(ticket);ticketCount++;return json({ticket,websocketUrl:origin.replace('http:','ws:')+'/v1/realtime',expiresAt:new Date(Date.now()+30000).toISOString()});}
   if(p==='/v1/multiplayer/rooms')return json(req.method==='GET'?[room()]:room());
   if(p.startsWith('/v1/multiplayer/rooms/')){if(p.endsWith('/invite'))return json({code:'ABCDE-FGHJK',expiresAt:new Date(Date.now()+60000).toISOString()});if(p.endsWith('/start'))return json(match());return json(room());}
   if(p.startsWith('/v1/multiplayer/matches/'))return json(p.endsWith('/events')?[]:match());
   if(p.endsWith('/play'))return json({recorded:true});
   if(p.startsWith('/v1/discovery/'))return json([]);
   json(null,404);
 }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'LOCAL_FIXTURE_REJECTED',message:'Isolated fixture request rejected'}}));}});
 server.on('upgrade',(req,socket,head)=>{const u=new URL(req.url,origin),ticket=u.searchParams.get('ticket');if(u.pathname!=='/v1/realtime'||!tickets.delete(ticket)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,s=>wss.emit('connection',s));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const work=()=>({id:workId,title:'桌面能力隔离验收样本',description:'仅连接本机；不调用模型或正式服务。',kind:'game',state:'published',visibility:'public',revision:'1',creatorDisplayName:'本地测试',targets:[{targetKey:'web',runtime:'web',currentReleaseId:releaseId}],tags:[]});
 const descriptor=()=>({apiVersion:1,workId,releaseId,channel:'production',runtimeOrigin:runtimeOrigin??'http://r-'+releaseId.replaceAll('-','')+'.localhost:49180',entryUrl:(runtimeOrigin??'http://r-'+releaseId.replaceAll('-','')+'.localhost:49180')+'/index.html',capabilities:{multiplayer:true,shareLinks:true,fileExport:true}});
 if(runtime){
   const {build}=createRequire(new URL('../../extensions/harness/package.json',import.meta.url))('esbuild');
   js=(await build({stdin:{contents:`import {createGameHubClient} from ${JSON.stringify(path.resolve('packages/web-game-sdk/src/index.mjs').replaceAll('\\','/'))};const sdk=createGameHubClient();const status=document.getElementById('status');const run=fn=>async()=>{try{status.textContent=JSON.stringify(await fn());}catch(e){status.textContent=e.code||e.message;}};sdk.on('multiplayer.status',e=>document.getElementById('connection').textContent=e.status);document.getElementById('connect').onclick=run(async()=>{const m=await sdk.multiplayer.listModes();const rooms=await sdk.multiplayer.rooms.list(m[0].id);await sdk.multiplayer.connect();await sdk.multiplayer.rooms.subscribe(rooms[0].id);return {connected:true,room:rooms[0].id};});document.getElementById('share').onclick=run(()=>sdk.shares.create({title:'本机分享',payload:{lesson:3}}));document.getElementById('current').onclick=run(()=>sdk.shares.current());document.getElementById('export').onclick=run(()=>sdk.files.download({filename:'mooyu-desktop-test.json',mimeType:'application/json',data:new TextEncoder().encode(JSON.stringify({fixture:true,lesson:3})).buffer}));sdk.connect().then(()=>status.textContent='SDK ready');`,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
   runtimeServer=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(js);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本机桌面能力验收</title><h1>本机隔离能力验收</h1><p>不连接生产环境，不调用模型。</p><button id="connect">连接本机多人房间</button><button id="share">生成本机分享链接</button><button id="current">读取当前分享</button><button id="export">导出 JSON 测试文件</button><p id="connection">未连接</p><pre id="status">Loading SDK</pre><script src="/fixture.js"></script></html>');}});
   await new Promise(resolve=>runtimeServer.listen(0,'127.0.0.1',resolve));runtimeOrigin='http://r-'+releaseId.replaceAll('-','')+'.localhost:'+runtimeServer.address().port;
 }
 return {origin,workId,releaseId,modeId,roomId,matchId,shareCode,gameToken,profile,calls,commands,descriptor:descriptor(),runtimePort:runtimeServer?.address().port??49180,get ticketCount(){return ticketCount;},dropSockets(){for(const s of sockets)s.close(1012,'fixture reconnect');},async close(){for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));server.closeAllConnections();await new Promise(r=>server.close(r));if(runtimeServer){runtimeServer.closeAllConnections();await new Promise(r=>runtimeServer.close(r));}}};
}
