import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createDatabase} from '../apps/api/src/database.mjs';
import {applyMigrations} from '../apps/api/src/migrations.mjs';
import {PostgresGameSessionRepository} from '../apps/api/src/game-session-repository.mjs';
import {createGameSessionService} from '../apps/api/src/game-session-service.mjs';
import {PostgresGameSaveRepository} from '../apps/api/src/game-save-repository.mjs';
import {createGameSaveService} from '../apps/api/src/game-save-service.mjs';
import {createApp} from '../apps/api/src/app.mjs';
import {loadConfig} from '../apps/api/src/config.mjs';
import {createRuntimeEdgeApp} from '../apps/api/src/runtime-edge-app.mjs';
import {mimeFor} from '../apps/api/src/web-package-policy.mjs';
import {UPSTREAM_COMMIT} from '../samples/adarkroom/state.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),databaseUrl=process.env.GAMEHUB_ADR_DATABASE_URL;
const parsed=new URL(databaseUrl??'http://missing');
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.pathname.endsWith('_test'))
  throw new Error('Set GAMEHUB_ADR_DATABASE_URL to a dedicated loopback database ending in _test; production is forbidden.');
const db=createDatabase({databaseUrl,databaseSsl:false}),pool=db.pool;
await applyMigrations(pool,path.join(root,'apps/api/migrations'));
const uuid=()=>crypto.randomUUID(),workId=uuid(),releaseId=uuid(),actors=new Map(),sessionsByKey=new Map(),userIds={a:uuid(),b:uuid()};
for(const [key,userId]of Object.entries(userIds)){
  await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)",[userId,'ADR acceptance '+key]);
  for(const host of ['web','cursor']){
    const grantId=uuid(),token=crypto.randomBytes(24).toString('hex');
    await pool.query("INSERT INTO device_grants(id,user_id,device_label,client_kind,authenticated_at,expires_at) VALUES($1,$2,$3,'browser',now(),now()+interval '8 hours')",[grantId,userId,'ADR '+host]);
    const actor={userId,grantId};actors.set('Bearer '+token,actor);sessionsByKey.set(key+'/'+host,{actor,token,identity:userId+'/'+grantId});
  }
}
await pool.query("INSERT INTO works(id,owner_user_id,title,kind,state,visibility) VALUES($1,$2,'A Dark Room internal acceptance','game','published','public')",[workId,userIds.a]);
await pool.query("INSERT INTO work_targets(work_id,target_key,state) VALUES($1,'web','published')",[workId]);
await pool.query("INSERT INTO releases(id,work_id,target_key,label,package_type,validation_state,serving_state,approved_capabilities) VALUES($1,$2,'web','ADR internal','web_zip','ready','enabled',$3)",[releaseId,workId,JSON.stringify(['cloudSave'])]);
await pool.query("INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,namespaces,approved_by,reason) VALUES($1,$2,'production','active',$3,$4,'local isolated S1 public-play acceptance fixture')",[workId,releaseId,JSON.stringify({default:{readSchema:{min:1,max:1},writeSchema:1}}),userIds.a]);
await pool.query("INSERT INTO game_save_policies(id,work_id,namespace,status,approved_by,reason) VALUES($1,$2,'default','active',$3,'local isolated S1 acceptance fixture')",[uuid(),workId,userIds.a]);
const sessionService=createGameSessionService({cloudSaveEnabled:true,repository:new PostgresGameSessionRepository(pool)});
const saveService=createGameSaveService({repository:new PostgresGameSaveRepository(pool),gameSessionService:sessionService});
const app=createApp({config:loadConfig({NODE_ENV:'test',CLOUD_SAVE_ENABLED:'true',DATABASE_URL:databaseUrl,OTP_HMAC_KEY:'adr-local-acceptance-only-'.repeat(2),CORS_ORIGINS:'http://127.0.0.1:3086,http://localhost:3086',TRUST_EDITOR_WEBVIEWS:'true'}),
  authService:{authenticateBearer:async header=>{const actor=actors.get(header);if(!actor)throw Object.assign(new Error('Local fixture authentication required'),{statusCode:401});return actor;}},
  gameSessionService:sessionService,gameSaveService:saveService});
const directory=path.join(root,'.runtime/adarkroom-web'),assets={};
async function walk(dir,prefix=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const name=prefix+e.name;if(e.isDirectory())await walk(path.join(dir,e.name),name+'/');else{
  const b=await fs.readFile(path.join(dir,e.name));assets[name]={size:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),mime:mimeFor(name)};
}}}
await walk(directory);
const manifest={entry:'index.html',fileCount:Object.keys(assets).length,totalBytes:Object.values(assets).reduce((n,a)=>n+a.size,0),approvedCapabilities:['cloudSave'],assets};
const release={asset_prefix:'fixture',asset_manifest_sha256:'fixture',asset_count:manifest.fileCount,expanded_bytes:manifest.totalBytes,entry_path:manifest.entry};
const edge=createRuntimeEdgeApp({runtimeDomain:'localhost',repository:{resolveRelease:async id=>id===releaseId?release:null},
  objectStore:{loadManifest:async()=>manifest,inspectAsset:async(_prefix,name,expected)=>({path:path.join(directory,name),size:expected.size})}});
const runtimeOrigin='http://r-'+releaseId.replaceAll('-','')+'.localhost:3096';
const descriptor={apiVersion:1,workId,releaseId,channel:'production',runtimeOrigin,entryUrl:runtimeOrigin+'/index.html',capabilities:{cloudSave:true}};
const requireHarness=createRequire(path.join(root,'extensions/harness/package.json'));
const {build}=await import(pathToFileURL(requireHarness.resolve('esbuild')).href);
const bundle=(await build({entryPoints:[path.join(root,'samples/adarkroom/acceptance-host.mjs')],bundle:true,format:'iife',platform:'browser',write:false,target:['chrome110']})).outputFiles[0].text;
const html='<html><head><meta charset="utf-8"><title>A Dark Room 存档验收</title><style>body{margin:0;font:14px system-ui;background:#eee;color:#111}header{padding:10px;display:flex;flex-wrap:wrap;gap:10px}button,select{font:inherit;padding:6px}#host-status{padding:8px}#game{height:calc(100vh - 110px)}iframe{border:0;width:100%;height:100%}</style></head><body><header><strong>A Dark Room · 内部验收</strong><select id="account" aria-label="测试账号"><option value="a">测试账号 A</option><option value="b">测试账号 B</option></select><button id="refresh">重新打开游戏</button><button id="seed-new">预置新游戏</button><button id="seed-mid">预置中期</button><button id="seed-pre-ending">预置通关前</button></header><div id="host-status" role="status">连接本地测试服务</div><main id="game"></main>';
app.get('/fixture/session',async request=>{
  const item=sessionsByKey.get(request.query.account+'/'+request.query.host);if(!item)throw new Error('Unknown fixture identity');
  return {token:item.token,identity:item.identity,descriptor};
});
app.get('/',async(_request,reply)=>reply.type('text/html').send(html+'<script src="/fixture/host.js"></script></body></html>'));
app.get('/fixture/host.js',async(_request,reply)=>reply.type('text/javascript').send(bundle));
app.post('/fixture/seed',async request=>{
  const actor=actors.get(request.headers.authorization);
  if(!actor||!['new','mid','pre-ending'].includes(request.body?.name))throw new Error('Invalid seed request');
  const token=(await sessionService.create(actor,{workId,releaseId,channel:'production',launchNonce:uuid()})).gameSessionId;
  const resource={workId,namespace:'default',slotKey:'autosave'};
  let meta;try{meta=await saveService.metadata(actor,token,resource);}catch(e){if(e.code!=='SAVE_SLOT_NOT_FOUND')throw e;}
  const state=JSON.parse(await fs.readFile(path.join(root,'samples/adarkroom/fixtures',request.body.name+'.json'),'utf8'));
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,upstreamVersion:'1.4',upstreamCommit:UPSTREAM_COMMIT,state}));
  const result=await saveService.write(actor,token,{...resource,...(meta?{ifMatch:meta.etag}:{ifNoneMatch:'*'}),idempotencyKey:uuid(),schemaVersion:1,contentType:'application/json',bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  await sessionService.revoke(actor,token);return {revision:result.revision};
});
const ext=path.join(root,'.runtime/adarkroom-cursor-acceptance');await fs.mkdir(ext,{recursive:true});
await fs.writeFile(path.join(ext,'package.json'),JSON.stringify({name:'gamehub-adr-acceptance',displayName:'GameHub ADR Acceptance',version:'0.0.1',publisher:'gamehub-internal',engines:{vscode:'^1.85.0'},main:'extension.cjs',activationEvents:['onStartupFinished'],contributes:{commands:[{command:'gamehub.adrAcceptance',title:'GameHub: A Dark Room 存档验收'}]}}));
const cursorHtml=html+'<script>window.__fixtureHost="cursor";</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script></body></html>';
await fs.writeFile(path.join(ext,'extension.cjs'),"const vscode=require('vscode');exports.activate=context=>{const open=()=>{const panel=vscode.window.createWebviewPanel('gamehubAdrAcceptance','A Dark Room 存档验收',vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true});panel.webview.html="+JSON.stringify(cursorHtml)+";};context.subscriptions.push(vscode.commands.registerCommand('gamehub.adrAcceptance',open));open();};");
await app.listen({host:'127.0.0.1',port:3086});await edge.listen({host:'127.0.0.1',port:3096});
await fs.writeFile(path.join(root,'.runtime/adarkroom-acceptance.json'),JSON.stringify({workId,releaseId,url:'http://127.0.0.1:3086',runtimeOrigin,extensionPath:ext},null,2));
console.log('ADR acceptance ready: http://127.0.0.1:3086 — two disposable accounts, local public-play scope, real API/PG/runtime edge.');
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await edge.close();await app.close();await db.close();};
process.once('SIGINT',()=>stop().then(()=>process.exit()));process.once('SIGTERM',()=>stop().then(()=>process.exit()));
