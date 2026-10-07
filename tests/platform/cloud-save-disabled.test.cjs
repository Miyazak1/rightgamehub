const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID:id}=require('node:crypto');
test('cloud saves default off, reject all endpoints before auth or database access and report local mode',async t=>{
  const {loadConfig}=await import('../../apps/api/src/config.mjs');
  const {createApp}=await import('../../apps/api/src/app.mjs');
  const env={NODE_ENV:'test',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32)};
  assert.equal(loadConfig(env).cloudSaveEnabled,false);
  assert.equal(loadConfig({...env,CLOUD_SAVE_ENABLED:'false'}).cloudSaveEnabled,false);
  assert.equal(loadConfig({...env,CLOUD_SAVE_ENABLED:'true'}).cloudSaveEnabled,true);
  assert.throws(()=>loadConfig({...env,CLOUD_SAVE_ENABLED:'1'}),/CLOUD_SAVE_ENABLED/);
  let calls=0;const forbidden=new Proxy({},{get:()=>async()=>{calls++;throw Error('Disabled service invoked');}});
  const app=createApp({config:loadConfig(env),authService:forbidden,gameSaveService:forbidden,saveLibraryService:forbidden,saveOperationsService:forbidden,
    database:{ping:async()=>true},migrations:{status:async()=>({ready:true,expected:49,applied:49})}});
  t.after(()=>app.close());
  const work=id(),slot=id(),revision=id();
  const paths=[
    '/v1/works/'+work+'/save-policy',
    '/v1/me/game-saves/'+work+'/slots',
    ...['','/metadata','/content','/history','/restore','/write-receipt'].map(s=>'/v1/me/game-saves/'+work+'/slots/autosave'+s),
    '/v1/me/save-library','/v1/me/save-library/'+slot+'/history',
    '/v1/me/save-library/'+slot+'/revisions/'+revision+'/content','/v1/me/save-library/'+slot+'/restore',
    '/v1/creator/save-health',...['health','capacity','audit','policies/'+id(),'works/'+work+'/maintenance'].map(s=>'/v1/admin/save-operations/'+s),
  ];
  for(const url of paths)for(const method of ['GET','PUT','POST','DELETE','PATCH']){
    const r=await app.inject({url:url+'?namespace=default',method,headers:{authorization:'Bearer old-valid-grant','x-gamehub-session':'a'.repeat(43),'content-type':'application/json'},...(method==='GET'?{}:{payload:'invalid json'})});
    assert.equal(r.statusCode,503,method+' '+url+' '+r.body);
    assert.equal(r.json().error.code,'CLOUD_SAVE_DISABLED');assert.equal(r.json().error.retryable,false);
  }
  assert.equal(calls,0);
  assert.equal((await app.inject('/health')).statusCode,200);
  assert.deepEqual((await app.inject('/ready')).json().data.saves,{mode:'local',cloudEnabled:false});
});
test('disabled cloud sessions strip existing tokens and refuse cloud resolution without querying the repository',async()=>{
  const {createGameSessionService}=await import('../../apps/api/src/game-session-service.mjs');
  const actor={userId:id(),grantId:id()},workId=id(),releaseId=id();let calls=0;
  const row={workId,releaseId,channel:'production',capabilities:['identity','multiplayer','cloudSave'],namespaces:{default:{}},modeIds:[]};
  const service=createGameSessionService({repository:{
    create:async input=>({...input.deriveScope({approved_capabilities:['cloudSave','multiplayer'],scope_status:'active',namespaces:{default:{readSchema:{min:1,max:1},writeSchema:1}}}),expiresAt:input.expiresAt}),
    resolve:async()=>{calls++;return row;},
  }});
  const token=await service.create(actor,{workId,releaseId,channel:'production',launchNonce:id()});
  assert.deepEqual(token.capabilities,['identity','multiplayer']);
  await assert.rejects(service.resolve(actor,token.gameSessionId,{capability:'cloudSave',namespace:'default'}),{code:'CLOUD_SAVE_DISABLED'});
  assert.equal(calls,0);
  const resolved=await service.resolve(actor,token.gameSessionId,{capability:'multiplayer',workId});
  assert.deepEqual(resolved.capabilities,['identity','multiplayer']);assert.deepEqual(resolved.namespaces,{});
});
test('catalog keeps legacy save releases local only; localSave packages validate without approving cloudSave',async t=>{
  const {createCatalogService}=await import('../../apps/api/src/catalog-service.mjs');
  for(const approved_capabilities of [['localSave'],['cloudSave']]){
    const release={id:id(),label:'local',entry_path:'index.html',approved_capabilities};
    const service=createCatalogService({repository:{getLaunch:async()=>release},config:{runtimeDomain:'runtime.test',runtimeScheme:'https'}});
    const descriptor=await service.launch(id());
    assert.equal(descriptor.capabilities.localSave,true);assert.notEqual(descriptor.capabilities.cloudSave,true);
  }
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {makeZip}=require('../../scripts/zip-fixture.cjs');
  const {validateWebZip}=await import('../../apps/api/src/web-zip-validator.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-local-manifest-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const capability of ['localSave','cloudSave']){
    const archive=path.join(root,capability+'.zip');
    await fs.writeFile(archive,makeZip([{name:'index.html',data:'<html>local</html>'},{name:'platform.json',data:JSON.stringify({version:1,entry:'index.html',capabilities:[capability]})}]));
    const result=validateWebZip(archive,path.join(root,capability));
    if(capability==='localSave')assert.deepEqual((await result).approvedCapabilities,['localSave']);
    else await assert.rejects(result,{code:'CAPABILITY_UNSUPPORTED'});
  }
});

test('runtime does not construct cloud save services when the switch is off',async t=>{
  const {createRuntime}=await import('../../apps/api/src/runtime.mjs');
  const runtime=createRuntime({env:{NODE_ENV:'test',DATABASE_URL:'postgres://unused/test',OTP_HMAC_KEY:'x'.repeat(32),GUESS_BAIKE_AUTOMATION_ENABLED:'false'},loadTrustedRules:false});
  t.after(()=>runtime.app.close());
  for(const name of ['gameSaveService','saveLibraryService','saveOperationsService'])assert.equal(runtime[name],null,name);
  assert.equal((await runtime.app.inject('/v1/me/save-library')).statusCode,503);
});
