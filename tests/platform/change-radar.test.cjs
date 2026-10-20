const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'../..');
const moduleUrl=file=>pathToFileURL(path.join(root,file)).href;

test('change radar builds readable diffs, suppresses volatile timestamps and evaluates rules',async()=>{
  const {buildTextDiff,evaluateChangeRule,normalizeRadarText}=await import(moduleUrl('apps/api/src/change-radar-diff.mjs'));
  const before='Plan\nPrice: 99\nUpdated 2 minutes ago';
  const after='Plan\nPrice: 79\nUpdated 8 minutes ago\nRegistration open';
  assert.equal(normalizeRadarText(before).includes('2 minutes'),false);
  const diff=buildTextDiff(normalizeRadarText(before),normalizeRadarText(after));
  assert.equal(diff.modified,1);
  assert.equal(diff.added,1);
  assert.equal(evaluateChangeRule({type:'keyword_appears',value:'Registration open'},before,after).matched,true);
  assert.equal(evaluateChangeRule({type:'number_changes'},before,after).matched,true);
  assert.equal(evaluateChangeRule({type:'keyword_disappears',value:'Plan'},before,after).matched,false);
});

test('change radar rejects private targets and normalizes text safely',async()=>{
  const {assertPublicHttpUrl,isPrivateAddress,normalizeFetchedText}=await import(moduleUrl('apps/api/src/change-radar-fetcher.mjs'));
  assert.equal(isPrivateAddress('127.0.0.1'),true);
  assert.equal(isPrivateAddress('192.168.1.8'),true);
  assert.equal(isPrivateAddress('8.8.8.8'),false);
  await assert.rejects(assertPublicHttpUrl('http://localhost/admin'),error=>error.code==='CHANGE_RADAR_URL_PRIVATE');
  await assert.rejects(assertPublicHttpUrl('https://private.example',{lookup:async()=>[{address:'10.0.0.7'}]}),error=>error.code==='CHANGE_RADAR_URL_PRIVATE');
  const text=normalizeFetchedText('<style>hidden</style><h1>Hello &amp; 墨鱼</h1><script>bad()</script><p>Done</p>','text/html');
  assert.equal(text,'Hello & 墨鱼\nDone');
  assert.ok(new TextEncoder().encode(normalizeFetchedText('鱼'.repeat(600000),'text/plain')).byteLength<=500000);
});

test('change radar fetcher validates redirects and hashes public text',async()=>{
  const {createChangeRadarFetcher}=await import(moduleUrl('apps/api/src/change-radar-fetcher.mjs'));
  const lookup=async()=>[{address:'93.184.216.34'}];
  const fetcher=createChangeRadarFetcher({lookup,fetchImpl:async()=>new Response('<h1>Release 2</h1>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}})});
  const result=await fetcher('https://example.com/releases');
  assert.equal(result.bodyText,'Release 2');
  assert.match(result.sha256,/^[a-f0-9]{64}$/u);
  const redirecting=createChangeRadarFetcher({lookup,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})});
  await assert.rejects(redirecting('https://example.com'),error=>error.code==='CHANGE_RADAR_URL_PRIVATE');
});

test('change radar rechecks the address used by the actual socket connection',async()=>{
  const {createChangeRadarFetcher}=await import(moduleUrl('apps/api/src/change-radar-fetcher.mjs'));
  let calls=0;
  const fetcher=createChangeRadarFetcher({timeoutMs:1000,lookup:async()=>++calls===1?[{address:'93.184.216.34',family:4}]:[{address:'127.0.0.1',family:4}]});
  await assert.rejects(fetcher('http://rebind.example/resource'),error=>error.code==='CHANGE_RADAR_URL_PRIVATE');
  assert.equal(calls,2);
});

test('change radar service requires an account, validates input and checks owned watches',async()=>{
  const {createChangeRadarService,ChangeRadarError}=await import(moduleUrl('apps/api/src/change-radar-service.mjs'));
  const rows=new Map(),snapshots=new Map();let sequence=0;
  const repository={
    count:async userId=>[...rows.values()].filter(item=>item.userId===userId).length,
    create:async input=>{const row={...input,status:'active',nextCheckAt:new Date().toISOString(),lastCheckedAt:null,lastChangedAt:null,lastStatusCode:null,lastError:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.set(row.id,row);return row;},
    list:async userId=>[...rows.values()].filter(item=>item.userId===userId),
    get:async(userId,id)=>rows.get(id)?.userId===userId?rows.get(id):null,
    getInternal:async id=>rows.get(id)||null,
    update:async()=>null,remove:async()=>false,snapshots:async(_userId,id)=>snapshots.get(id)||[],claimDue:async()=>[],
    record:async input=>({watch:rows.get(input.watchId),snapshot:{id:input.snapshotId,watchId:input.watchId,changeKind:'initial',excerpt:input.result.bodyText},changed:false,initial:true}),
    recordError:async()=>null,
  };
  const service=createChangeRadarService({repository,ids:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,validateUrl:async value=>new URL(value),fetchPage:async url=>({finalUrl:url,statusCode:200,contentType:'text/plain',bodyText:'baseline',sha256:'a'.repeat(64)})});
  assert.throws(()=>service.list(null),error=>error instanceof ChangeRadarError&&error.code==='AUTH_REQUIRED');
  const actor={userId:'user-1'},watch=await service.create(actor,{title:' Release notes ',url:'https://example.com/releases',condition:'new section',intervalMinutes:60});
  assert.equal(watch.title,'Release notes');
  assert.equal(watch.ruleType,'any');
  assert.equal((await service.list(actor)).length,1);
  const checked=await service.checkNow(actor,watch.id);
  assert.equal(checked.initial,true);
  await assert.rejects(service.create(actor,{title:'Bad interval',url:'https://example.com',intervalMinutes:3}),error=>error.code==='CHANGE_RADAR_INVALID');
  await assert.rejects(service.create(actor,{title:'Missing keyword',url:'https://example.com',intervalMinutes:60,ruleType:'keyword_appears'}),error=>error.code==='CHANGE_RADAR_INVALID');
  await assert.rejects(service.get({userId:'user-2'},watch.id),error=>error.code==='CHANGE_RADAR_NOT_FOUND');
});

test('change radar routes are authenticated and expose the account-scoped API',async t=>{
  const [{default:Fastify},{registerChangeRadarRoutes}]=await Promise.all([import(moduleUrl('apps/api/node_modules/fastify/fastify.js')),import(moduleUrl('apps/api/src/change-radar-routes.mjs'))]);
  const app=Fastify({logger:false});
  const service={list:async actor=>[{id:'watch-1',owner:actor.userId}],create:async()=>({id:'watch-1'}),events:async()=>[{id:'00000000-0000-4000-8000-000000000001'}],markRead:async()=>({id:'00000000-0000-4000-8000-000000000001',isRead:true})};
  const requireAuth=async request=>{if(request.headers.authorization!=='Bearer ok'){const error=new Error('Authentication required.');error.statusCode=401;throw error;}request.actor={userId:'user-1'};};
  registerChangeRadarRoutes(app,{service,requireAuth});
  t.after(()=>app.close());
  assert.equal((await app.inject({method:'GET',url:'/v1/me/change-watches'})).statusCode,401);
  const list=await app.inject({method:'GET',url:'/v1/me/change-watches',headers:{authorization:'Bearer ok'}});
  assert.equal(list.statusCode,200);
  assert.equal(list.json().data[0].owner,'user-1');
  const events=await app.inject({method:'GET',url:'/v1/me/change-events?unreadOnly=true&limit=10',headers:{authorization:'Bearer ok'}});
  assert.equal(events.statusCode,200);
  const read=await app.inject({method:'POST',url:'/v1/me/change-events/00000000-0000-4000-8000-000000000001/read',headers:{authorization:'Bearer ok'}});
  assert.equal(read.statusCode,200);
  assert.equal(read.json().data.isRead,true);
});
