const {app,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const configFile=process.argv[process.argv.indexOf('--config')+1];
let server,network;
async function run(){
  const config=JSON.parse(await fs.readFile(configFile,'utf8'));
  app.setPath('userData',config.profileRoot);await app.whenReady();
  const {createDesktopNetworkTransport}=await import('../../apps/desktop/src/network-transport.mjs');
  const {createDesktopAccountSession}=await import('../../apps/desktop/src/account-session.mjs');
  const {createMemoryCredentialVault}=await import('../../apps/capability-executor/src/credential-vault.mjs');
  const counts={},requests=[];
  server=http.createServer((q,s)=>{
    counts[q.url]=(counts[q.url]??0)+1;requests.push({path:q.url,cookie:!!q.headers.cookie,authorization:q.headers.authorization});
    s.setHeader('Cache-Control','public, max-age=300');s.setHeader('Set-Cookie','must-not-persist=fixture; Path=/');
    if(q.url==='/v1/me'){s.setHeader('Content-Type','application/json');s.end(JSON.stringify({data:{request:counts[q.url]}}));}
    else{s.setHeader('Content-Type','image/png');s.end(Buffer.alloc(1024,7));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  network=session.fromPartition('public-network-acceptance');
  const transport=createDesktopNetworkTransport(origin,network.fetch.bind(network));
  const client=await createDesktopAccountSession({apiOrigin:origin,vault:createMemoryCredentialVault(),fetchImpl:transport});
  const cover='/v1/works/public-cover/cover',avatar='/v1/avatars/11111111-1111-4111-8111-111111111111';
  const one=await client.media(cover);assert.equal((await one.arrayBuffer()).byteLength,1024);
  const two=await client.media(cover);assert.equal((await two.arrayBuffer()).byteLength,1024);assert.equal(counts[cover],1);
  for(let i=0;i<2;i++)await (await client.media(avatar)).arrayBuffer();assert.equal(counts[avatar],2);
  const headers={Authorization:'Bearer local-fixture-only',Cookie:'must-not-send=fixture'};
  for(let i=1;i<=2;i++){const r=await transport(origin+'/v1/me',{headers});assert.equal((await r.json()).data.request,i);}
  assert.equal(counts['/v1/me'],2);assert.ok(requests.filter(r=>r.path==='/v1/me').every(r=>r.authorization===headers.Authorization));
  assert.ok(requests.every(r=>!r.cookie));assert.equal((await network.cookies.get({})).length,0);
  const report={passed:true,productionConnected:false,checks:['public cover repeats reuse Chromium HTTP cache','private JSON and avatars bypass cache','cookies neither sent nor persisted; explicit bearer preserved'],counts};
  await fs.writeFile(config.report,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
run().then(async()=>{await network?.closeAllConnections();server?.closeAllConnections();await new Promise(r=>server.close(r));app.quit();}).catch(async e=>{console.error(e.stack);await network?.closeAllConnections();server?.closeAllConnections();server?.close();app.exit(1);});
