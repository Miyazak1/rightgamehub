const test=require('node:test'),assert=require('node:assert/strict');
const json=()=>({filename:'Bingo 数据.json',mimeType:'application/json',data:new TextEncoder().encode('{"kind":"bingo-pack"}').buffer});
test('file and share schemas reject paths, executable/HTML MIME, binary disguise, size and unsafe JSON',async()=>{
 const {validateFileExport:file,validateShare:share}=await import('../../packages/web-game-sdk/src/sharing-protocol.mjs');assert.equal(file(json()).filename,'Bingo 数据.json');
 for(const filename of ['../a.json','C:\\a.json','a/b.json','CON.json','test.exe','x.html','a\u0000.json','a.json.exe','hidden..json'])assert.throws(()=>file({...json(),filename}),{code:'FILE_EXPORT_INVALID'});
 for(const mimeType of ['text/html','application/octet-stream','image/svg+xml','text/json'])assert.throws(()=>file({...json(),mimeType}),{code:'FILE_EXPORT_INVALID'});
 for(const data of [new Uint8Array([1]),new ArrayBuffer(0),new ArrayBuffer(2097153),new TextEncoder().encode('<script>evil()</script>').buffer])assert.throws(()=>file({...json(),data}),{code:'FILE_EXPORT_INVALID'});
 assert.throws(()=>file({...json(),filename:'evil.png',mimeType:'image/png'}),{code:'FILE_EXPORT_INVALID'});
 const good={title:'Bingo',payload:{kind:'bingo-pack',schemaVersion:1,pack:{cells:['A']}}};assert.deepEqual(share(good),good);
 let deep={};for(let i=0;i<14;i++)deep={next:deep};
 for(const payload of [deep,JSON.parse('{"__proto__":{"admin":true}}'),{n:Infinity},{date:new Date()},{data:new ArrayBuffer(1)},{text:'x'.repeat(17000)}])assert.throws(()=>share({...good,payload}),{code:'SHARE_PAYLOAD_INVALID'});
 assert.throws(()=>share({...good,workId:'other'}),{code:'SHARE_PAYLOAD_INVALID'});
});
test('browser and Harness save report honest results and revalidate after choosing a destination',async()=>{
 const {createBrowserFileExporter}=await import('../../packages/host-contract/src/file-export.mjs');let writes=0,checks=0;
 const win={showSaveFilePicker:async()=>({createWritable:async()=>({write:async()=>{writes++;},close:async()=>{},abort:async()=>{}})})};
 const h=createBrowserFileExporter(win,{allowAnchor:false});assert.equal((await h.download(json(),{verify:async()=>{checks++;}})).status,'saved');assert.equal(writes,1);assert.equal(checks,1);
 await assert.rejects(h.download(json(),{verify:async()=>{throw Object.assign(new Error(),{code:'REVOKED'});}}),{code:'REVOKED'});assert.equal(writes,1);
 const controller=new AbortController();controller.abort();await assert.rejects(h.download(json(),{signal:controller.signal}),{code:'FILE_EXPORT_CANCELLED'});
 await assert.rejects(createBrowserFileExporter({},{allowAnchor:false}).download(json()),{code:'FILE_EXPORT_UNSUPPORTED'});
 await assert.rejects(createBrowserFileExporter({showSaveFilePicker:async()=>{throw Object.assign(new Error(),{name:'AbortError'});}}).download(json()),{code:'FILE_EXPORT_CANCELLED'});
});
test('native export validates selected filename and current release immediately before writing',async()=>{
 const {exportNativeFile}=await import('../../extensions/vscode/src/file-export.mjs');const file=json();let writes=0,reads=0,denied=false;
 const input={filename:file.filename,mimeType:file.mimeType,dataBase64:Buffer.from(file.data).toString('base64'),workId:'00000000-0000-4000-8000-000000000001',releaseId:'00000000-0000-4000-8000-000000000002'};
 let uri={scheme:'file',fsPath:'C:/tmp/result.json'};const vscode={Uri:{file:fsPath=>({fsPath})},window:{showSaveDialog:async()=>uri},workspace:{fs:{writeFile:async()=>{writes++;}}}};
 const fetchImpl=async()=>{reads++;return {ok:!denied,json:async()=>({data:{workId:input.workId,releaseId:input.releaseId,capabilities:{fileExport:true}}})};};
 const opts={vscode,apiOrigin:'https://mooyu.fun',fetchImpl};assert.equal((await exportNativeFile(input,opts)).status,'saved');assert.equal(reads,2);assert.equal(writes,1);
 uri={scheme:'file',fsPath:'C:/tmp/evil.exe'};await assert.rejects(exportNativeFile(input,opts),{code:'FILE_EXPORT_INVALID'});assert.equal(writes,1);
 uri=null;await assert.rejects(exportNativeFile(input,opts),{code:'FILE_EXPORT_CANCELLED'});
 uri={scheme:'vscode-remote',fsPath:'/tmp/a.json'};await assert.rejects(exportNativeFile(input,opts),{code:'FILE_EXPORT_UNSUPPORTED'});
 await assert.rejects(exportNativeFile(input,{...opts,remote:true}),{code:'FILE_EXPORT_UNSUPPORTED'});
 uri={scheme:'file',fsPath:'C:/tmp/result.json'};vscode.window.showSaveDialog=async()=>{denied=true;return uri;};await assert.rejects(exportNativeFile(input,opts),{code:'BRIDGE_CAPABILITY_NOT_GRANTED'});assert.equal(writes,1);
});
test('sharing handlers bind current to launch, refuse iframe-selected codes and keep sessions in parent',async()=>{
 const {createShareLinkHandlers,createFileExportHandlers}=await import('../../packages/platform-client/src/web-game-sharing-handlers.mjs');const descriptor={workId:'w',releaseId:'r'};let sessionCalls=0,apiCalls=0;
 const apiClient={createGameShare:async(token,input)=>{assert.equal(token,'parent-secret');apiCalls++;return {data:{code:'public',url:'https://mooyu.fun/#/s/public'}};},getGameShare:async code=>{assert.equal(code,'launch-code');return {data:{...descriptor,payload:{value:1}}};}};
 const h=createShareLinkHandlers({descriptor,apiClient,initialShareCode:'launch-code',getGameSession:async capability=>{assert.equal(capability,'shareLinks');sessionCalls++;return 'parent-secret';}}).handlers;
 assert.deepEqual((await h['shares.current']({})).payload,{value:1});assert.equal(sessionCalls,0);
 await assert.rejects(h['shares.current']({code:'other'}),{code:'BRIDGE_REQUEST_INVALID'});
 assert.doesNotMatch(JSON.stringify(await h['shares.create']({title:'Bingo',payload:{a:1}})),/parent-secret/);assert.equal(apiCalls,1);
 assert.equal(await createShareLinkHandlers({descriptor,apiClient}).handlers['shares.current']({}),null);
 apiClient.getGameShare=async()=>({data:{...descriptor,releaseId:'other'}});await assert.rejects(h['shares.current']({}),{code:'SHARE_CONTEXT_MISMATCH'});
 let exports=0;apiClient.getLaunch=async()=>({data:{...descriptor,capabilities:{fileExport:false}}});const f=createFileExportHandlers({descriptor,apiClient,exportFile:async()=>{exports++;}});await assert.rejects(f.handlers['files.download'](json()),{code:'BRIDGE_CAPABILITY_NOT_GRANTED'});assert.equal(exports,0);
});

test('editor adapter carries validated bytes to native host and propagates cancellation',async()=>{
 const {createEditorHostAdapter}=await import('../../packages/host-contract/src/index.mjs');const crypto=require('node:crypto');let call,finish,cancelled=false;
 const host=createEditorHostAdapter({window:{document:{documentElement:{}},crypto,btoa:s=>Buffer.from(s,'binary').toString('base64')},bridge:{call:async(operation,payload)=>{if(operation==='files.cancel'){cancelled=true;return;}assert.equal(operation,'files.download');call=payload;return new Promise(resolve=>{finish=resolve;});}},bootstrap:{host:'cursor'}});
 const controller=new AbortController(),pending=host.files.download(json(),{descriptor:{workId:'work',releaseId:'release'},signal:controller.signal,verify:async()=>{}});await new Promise(resolve=>setImmediate(resolve));assert.equal(Buffer.from(call.dataBase64,'base64').toString(),'{"kind":"bingo-pack"}');assert.equal(call.workId,'work');controller.abort();assert.equal(cancelled,true);finish({status:'saved'});await assert.rejects(pending,{code:'FILE_EXPORT_CANCELLED'});host.dispose();
});

test('editor replies accept the actual wrapper parent and reject game-frame impersonation',async()=>{
 const {isTrustedEditorMessage}=await import('../../packages/host-contract/src/index.mjs');const parent={},window={parent},game={parent:window};
 assert.equal(isTrustedEditorMessage({source:parent},window),true);assert.equal(isTrustedEditorMessage({source:window},window),true);assert.equal(isTrustedEditorMessage({source:game},window),false);assert.equal(isTrustedEditorMessage({source:null},window),false);assert.equal(isTrustedEditorMessage({},window),false);
});
