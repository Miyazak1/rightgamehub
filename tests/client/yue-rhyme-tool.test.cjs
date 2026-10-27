const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const modelPromise=import(pathToFileURL(path.resolve('packages/platform-client/src/yue-rhyme-model.mjs')).href);

test('Cantonese rhyme model preserves the source dictionary and exposes all finals',async()=>{
  const {createYueRhymeLibrary,lookupYueRhyme,yueRhymeFinals}=await modelPromise;
  const finals=yueRhymeFinals();
  assert.equal(finals.length,56);
  for(const final of ['aa','aan','at','eng','im','ing','m','ng','ong','ui','yun','yut'])assert.ok(finals.includes(final),`missing final ${final}`);
  const result=lookupYueRhyme({character:'眼',library:createYueRhymeLibrary()});
  assert.equal(result.ok,true);
  assert.deepEqual(result.primary,{jyutping:'ngaan5',final:'aan'});
  assert.equal(result.strict.final,'aan');
  assert.ok(result.strict.count>1);
  assert.ok(result.strict.groups.some(group=>group.items.some(item=>item.character==='眼')));
});

test('custom readings are validated, normalized and never rendered as arbitrary markup data',async()=>{
  const {addCustomWord,createYueRhymeLibrary,lookupYueRhyme,normalizeHanCharacter}=await modelPromise;
  assert.equal(normalizeHanCharacter('𠮷'),'𠮷');
  assert.equal(normalizeHanCharacter('<'),'');
  assert.equal(addCustomWord({}, {character:'𠮷',jyutping:'gat1',final:'at'}).ok,true);
  assert.equal(addCustomWord({}, {character:'试',jyutping:'"><img src=x onerror=alert(1)>',final:'i'}).code,'jyutping-invalid');
  assert.equal(addCustomWord({}, {character:'试',jyutping:'si3',final:'at'}).code,'final-mismatch');
  const added=addCustomWord({}, {character:'𠮷',jyutping:'gat1',final:'at'});
  const result=lookupYueRhyme({character:'𠮷',library:createYueRhymeLibrary(added.customWords)});
  assert.equal(result.custom,true);
  assert.equal(result.primary.jyutping,'gat1');
});

test('Agent context is bounded to the active lookup and excludes the custom library',async()=>{
  const {buildYueRhymeAgentContext,createYueRhymeLibrary,lookupYueRhyme}=await modelPromise;
  const result=lookupYueRhyme({character:'书',library:createYueRhymeLibrary()});
  const context=buildYueRhymeAgentContext(result);
  assert.equal(context.kind,'yue-rhyme-context');
  assert.equal(context.query.character,'书');
  assert.ok(context.strict.samples.length<=48);
  assert.ok(context.wide.every(group=>group.samples.length<=20));
  assert.equal(context.disclosure.customLibraryShared,false);
  assert.doesNotMatch(JSON.stringify(context),/customWords|COMMON_DB/u);
  assert.ok(JSON.stringify(context).length<30000);
});

test('official tool uses semantic controls, local versioned storage, import/export and no innerHTML',async()=>{
  const source=await fs.readFile('packages/platform-client/src/YueRhymeTool.jsx','utf8');
  assert.match(source,/YUE_RHYME_STORAGE_KEY/u);
  assert.match(source,/normalizeCustomWords/u);
  assert.match(source,/buildYueRhymeAgentContext/u);
  assert.match(source,/syncYueRhymeContext/u);
  assert.match(source,/application\/json/u);
  assert.match(source,/<label/u);
  assert.match(source,/<button/u);
  assert.doesNotMatch(source,/innerHTML|dangerouslySetInnerHTML/u);
  assert.doesNotMatch(source,/fetch\(|FormData/u);
});

test('embedded Agent bridge syncs rhyme context and accepts status only from its parent',async()=>{
  const bridge=await import(pathToFileURL(path.resolve('packages/platform-client/src/agent-tool-bridge.mjs')).href);
  const listeners=new Map(),posted=[];
  const parent={postMessage:message=>posted.push(message)};
  const windowImpl={addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);}};
  assert.equal(bridge.syncYueRhymeContext({kind:'yue-rhyme-context',version:1},{parentWindow:parent,currentWindow:windowImpl}),true);
  assert.equal(posted[0].type,bridge.YUE_RHYME_CONTEXT);
  let received=null;
  const unsubscribe=bridge.subscribeYueRhymeStatus(message=>{received=message;},{parentWindow:parent,windowImpl});
  listeners.get('message')({source:{},data:{type:bridge.YUE_RHYME_STATUS,status:'failed'}});
  assert.equal(received,null);
  listeners.get('message')({source:parent,data:{type:bridge.YUE_RHYME_STATUS,status:'synced'}});
  assert.equal(received.status,'synced');
  unsubscribe();
  assert.equal(listeners.has('message'),false);
});
