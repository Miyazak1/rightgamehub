const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRequire}=require('node:module'),harness=require('./support/researcher-qa-db.cjs');
const apiRequire=createRequire(path.resolve('apps/api/package.json'));
test('administrator avatars preserve ownership, audit and live objects under concurrency and failures',{skip:!harness.enabled},async t=>{
  const {admin}=await harness.setup();t.after(()=>admin.end());
  const {createAgentAccountService}=await harness.load('agent-account-service.mjs');
  const {PostgresAgentAccountRepository}=await harness.load('agent-account-repository.mjs');
  const {createAgentAvatarService,PostgresAgentAvatarRepository}=await harness.load('agent-avatar-service.mjs');
  const {createAuthService}=await harness.load('auth-service.mjs');
  const {PostgresAuthRepository}=await harness.load('auth-repository.mjs');
  const {LocalAvatarStore}=await harness.load('local-avatar-store.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-avatar-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new LocalAvatarStore(root),auth=createAuthService({repository:new PostgresAuthRepository(admin,store),otpHmacKey:'isolated-avatar-fixture'});
  const operator=crypto.randomUUID(),other=crypto.randomUUID();
  for(const id of [operator,other])await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Avatar operator','admin')",[id]);
  const repo=new PostgresAgentAccountRepository(admin),avatarRepo=new PostgresAgentAvatarRepository(admin,store);
  const avatars=createAgentAvatarService({repository:avatarRepo,authorizeOperator:async actor=>actor.role==='admin',processImage:auth.processAvatarUpload});
  const service=createAgentAccountService({repository:repo,avatarService:avatars,authorizeOperator:async()=>true});
  const actor={userId:operator,role:'admin'},agent=await service.provision(actor,{provisionKey:'avatar-'+crypto.randomUUID(),displayName:'小墨鱼',handle:'avatar-'+crypto.randomBytes(5).toString('hex'),badgeLabel:'AI 助手',operatorLabel:'Fixture',capabilities:[],metadata:{}});
  const png=async color=>apiRequire('sharp')({create:{width:48,height:48,channels:4,background:color}}).png().toBuffer();
  const red=await png('red'),blue=await png('blue');
  const snapshot=async()=>({...(await admin.query('SELECT * FROM user_avatars WHERE user_id=$1',[agent.agentUserId])).rows[0]});
  const live=async()=>{const row=await snapshot();if(row.kind==='upload'){
    assert.ok((await store.get(row.body_key)).length);assert.ok((await store.get(row.poster_key)).length);
    const result=await auth.getAvatar(agent.agentUserId);assert.deepEqual(result.body,await store.get(row.body_key));}
    return row;};
  await t.test('unauthorized and foreign operators cannot process or mutate the avatar',async()=>{
    await assert.rejects(avatars.upload({userId:operator,role:'member'},agent.agentUserId,red),/AGENT_OPERATOR_REQUIRED/);
    await assert.rejects(avatars.upload({userId:other,role:'admin'},agent.agentUserId,red),/AGENT_NOT_FOUND/);
    await assert.rejects(avatars.reset({userId:agent.agentUserId,role:'admin'},agent.agentUserId),/AGENT_NOT_FOUND/);
    await assert.rejects(auth.uploadAvatar({userId:agent.agentUserId},red),error=>error.code==='AUTH_REQUIRED');
    assert.equal((await snapshot()).preset_key,'xiaomoyu');
  });
  await t.test('upload uses the ordinary public avatar URL and audited operator',async()=>{
    const saved=await avatars.upload(actor,agent.agentUserId,red);assert.equal(saved.avatar.kind,'upload');
    assert.match(saved.avatar.url,new RegExp('/v1/avatars/'+agent.agentUserId+'\\?v='));
    assert.deepEqual((await service.list(actor))[0].avatar,saved.avatar);await live();
    const event=(await admin.query("SELECT * FROM agent_account_events WHERE agent_user_id=$1 AND action='avatar-upload'",[agent.agentUserId])).rows[0];
    assert.equal(event.operator_user_id,operator);assert.equal(event.metadata_json.current.sha256.length,64);
    await assert.rejects(admin.query('UPDATE agent_account_events SET metadata_json=metadata_json WHERE id=$1',[event.id]),/append only/);
  });
  await t.test('invalid and oversized images retain the old avatar',async()=>{
    const before=await snapshot();await assert.rejects(avatars.upload(actor,agent.agentUserId,Buffer.from('broken-image-data')));
    await assert.rejects(avatars.upload(actor,agent.agentUserId,Buffer.alloc(2*1024*1024+1)),error=>error.code==='AVATAR_TOO_LARGE');
    await assert.rejects(avatars.upload(actor,agent.agentUserId,await apiRequire('sharp')({create:{width:1025,height:10,channels:3,background:'red'}}).png().toBuffer()));
    assert.deepEqual(await snapshot(),before);await live();
  });
  await t.test('parallel identical images and upload/reset races never delete live objects',async()=>{
    await Promise.all(Array.from({length:5},()=>avatars.upload(actor,agent.agentUserId,red)));await live();
    await Promise.all([avatars.upload(actor,agent.agentUserId,blue),avatars.reset(actor,agent.agentUserId),avatars.upload(actor,agent.agentUserId,red)]);await live();
  });
  await t.test('poster failure protects a reused body object and rolls back audit',async()=>{
    await avatars.upload(actor,agent.agentUserId,red);const before=await snapshot();
    const put=store.put.bind(store);store.put=async input=>{if(input.variant==='static')throw Error('fixture poster failure');return put(input);};
    try{await assert.rejects(avatars.upload(actor,agent.agentUserId,red),/poster failure/);}finally{store.put=put;}
    assert.deepEqual(await snapshot(),before);await live();
  });
  await t.test('database failure rolls back avatar and audit together',async()=>{
    const before=await snapshot();const count=(await admin.query('SELECT count(*)::int AS n FROM agent_account_events WHERE agent_user_id=$1',[agent.agentUserId])).rows[0].n;
    await admin.query(`CREATE FUNCTION reject_avatar_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='avatar-upload' THEN RAISE EXCEPTION 'fixture audit failure';END IF;RETURN NEW;END $$;
      CREATE TRIGGER reject_avatar_fixture BEFORE INSERT ON agent_account_events FOR EACH ROW EXECUTE FUNCTION reject_avatar_fixture()`);
    try{await assert.rejects(avatars.upload(actor,agent.agentUserId,blue),/audit failure/);}finally{await admin.query('DROP TRIGGER reject_avatar_fixture ON agent_account_events; DROP FUNCTION reject_avatar_fixture()');}
    assert.deepEqual(await snapshot(),before);assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_account_events WHERE agent_user_id=$1',[agent.agentUserId])).rows[0].n,count);await live();
  });
  await t.test('lost commit acknowledgement retains the committed objects',async()=>{
    let lost=false;const pool={connect:async()=>{const client=await admin.connect();return{query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&!lost){lost=true;throw Error('fixture lost commit acknowledgement');}return result;},release:flag=>client.release(flag)};}};
    const uncertain=new PostgresAgentAvatarRepository(pool,store),image=await auth.processAvatarUpload(blue);
    await assert.rejects(uncertain.replace(operator,agent.agentUserId,{...image,sha256:crypto.createHash('sha256').update(image.body).digest(),posterSha256:crypto.createHash('sha256').update(image.posterBody).digest()}),/lost commit/);
    assert.equal(lost,true);await live();
  });
  await t.test('restore removes only obsolete objects and retains the default preset and audit',async()=>{
    const before=await snapshot();const reset=await avatars.reset(actor,agent.agentUserId);assert.equal(reset.avatar.presetKey,'xiaomoyu');
    assert.equal((await snapshot()).body_key,null);await assert.rejects(store.get(before.body_key));
    assert.equal((await service.list(actor))[0].avatar.presetKey,'xiaomoyu');
    assert.ok((await admin.query("SELECT 1 FROM agent_account_events WHERE agent_user_id=$1 AND action='avatar-reset'",[agent.agentUserId])).rowCount);
  });
  await t.test('HTTP upload/reset enforce authorization, type and streamed size limits',async()=>{
    const app=apiRequire('fastify')();
    app.addContentTypeParser(['image/png','image/jpeg','image/gif','image/webp'],(_request,body,done)=>done(null,body));
    const {registerAgentAccountRoutes}=await harness.load('agent-account-routes.mjs');
    registerAgentAccountRoutes(app,{accountService:service,automation:{listAgents:(_actor,accounts)=>accounts.list(_actor)},
      requireAuth:async request=>{
        const token=request.headers.authorization;
        if(!token)throw Object.assign(new Error('Authentication required'),{statusCode:401});
        request.actor=token==='owner'?actor:{userId:other,role:'admin'};
      }});
    const url='/v1/admin/agents/'+agent.agentUserId+'/avatar';
    try{
      assert.equal((await app.inject({method:'PUT',url,headers:{'content-type':'image/png'},payload:red})).statusCode,401);
      assert.equal((await app.inject({method:'PUT',url,headers:{'content-type':'image/png',authorization:'foreign'},payload:red})).statusCode,404);
      assert.equal((await app.inject({method:'PUT',url,headers:{'content-type':'application/json',authorization:'owner'},payload:'{}'})).statusCode,415);
      assert.equal((await app.inject({method:'PUT',url,headers:{'content-type':'image/png',authorization:'owner'},payload:Buffer.alloc(2*1024*1024+1)})).statusCode,413);
      const uploaded=await app.inject({method:'PUT',url,headers:{'content-type':'image/png',authorization:'owner'},payload:red});
      assert.equal(uploaded.statusCode,200,uploaded.body);assert.equal(uploaded.json().data.avatar.kind,'upload');
      assert.equal(uploaded.headers['cache-control'],'no-store');
      const reset=await app.inject({method:'DELETE',url,headers:{authorization:'owner'}});
      assert.equal(reset.statusCode,200,reset.body);assert.equal(reset.json().data.avatar.presetKey,'xiaomoyu');
    }finally{await app.close();}
  });
});
