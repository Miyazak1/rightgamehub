const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const root=path.resolve(__dirname,'../..');
const url=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
const key=()=>crypto.randomUUID();
const etag=post=>'"'+post.version+'"';
const content=title=>({channel:'ai',title,blocks:[{type:'paragraph',text:'一条与 AI 和游戏相关的发现。'},{type:'link',url:'https://example.com/news',label:'原文'}]});

test('community PostgreSQL: immutable review, privacy, concurrency and bounded image processing',{skip:!url,timeout:60000},async t=>{
  const {createCommunityTestDatabase}=require('../community-database.cjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {CommunityService}=await import('../../apps/api/src/community-service.mjs');
  const {CommunityMediaService}=await import('../../apps/api/src/community-media-service.mjs');
  const {CommunityMediaStore}=await import('../../apps/api/src/community-media-store.mjs');
  const {createCommunityImageRunner}=await import('../../apps/api/src/community-image-runner.mjs');
  const {hash}=await import('../../apps/api/src/community-contract.mjs');
  const database=await createCommunityTestDatabase(url),pool=database.pool;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-community-test-'));
  t.after(async()=>{await database.close();await fs.rm(directory,{recursive:true,force:true});});
  assert.equal((await applyMigrations(pool,path.join(root,'apps/api/migrations'))).total,53);
  const config={enabled:true,postingEnabled:true,imagesEnabled:true};
  const service=new CommunityService({pool,config});
  const store=new CommunityMediaStore(path.join(directory,'media'));
  const runner=createCommunityImageRunner({root:path.join(directory,'processor'),mediaRoot:store.root});
  const media=new CommunityMediaService({service,store,runner});
  async function user(role='user',visibility='public') {
    const userId=key();
    await pool.query("INSERT INTO users(id,display_name,role,social_visibility) VALUES($1,'测试玩家',$2,$3)",[userId,role,visibility]);
    return {userId};
  }
  const owner=await user(),reader=await user(),admin=await user('admin');
  async function publish(author=owner,title='新发现') {
    let post=await service.save(author,null,content(title),null,key());
    post=await service.submit(author,post.id,etag(post),key());
    return service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'审核通过'},etag(post),key());
  }
  await t.test('ordinary private-profile accounts post without membership and publish only after review',async()=>{
    const author=await user('user','private');
    const capability=await service.capabilities(author);
    assert.equal(capability.canShare,true);assert.equal(capability.imagesEnabled,true);assert.equal(capability.reason,null);
    assert.equal((await service.capabilities(admin)).canShare,true);
    assert.equal((await service.capabilities(null)).reason,'AUTH_REQUIRED');
    assert.equal((await pool.query('SELECT count(*)::int n FROM community_members WHERE user_id=$1',[author.userId])).rows[0].n,0);
    let post=await service.save(author,null,content('默认可投稿'),null,key());
    await assert.rejects(service.get(null,post.id),{code:'POST_NOT_FOUND'});
    post=await service.submit(author,post.id,etag(post),key());
    await assert.rejects(service.get(null,post.id),{code:'POST_NOT_FOUND'});
    post=await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'审核后公开'},etag(post),key());
    assert.equal((await service.get(null,post.id)).title,'默认可投稿');
    assert.equal((await service.get(null,post.id)).author.handle,null);
    assert.deepEqual((await service.get(null,post.id)).author.avatar,{kind:'preset',presetKey:'cat',url:null,staticUrl:null,mediaType:null,animated:false});
    const account=(await pool.query('SELECT social_visibility,can_publish FROM users WHERE id=$1',[author.userId])).rows[0];
    assert.equal(account.social_visibility,'private');assert.equal(account.can_publish,false);
    await service.interaction(reader,post.id,'like',true);
    await service.report(reader,post.id,{category:'other',details:'独立公开分享仍可举报'});
    const paused=new CommunityService({pool,config:{...config,postingEnabled:false}});
    assert.equal((await paused.capabilities(author)).reason,'POSTING_PAUSED');
    await assert.rejects(paused.save(author,null,content('暂停投稿'),null,key()),{code:'POSTING_PAUSED'});
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1",[author.userId]);
    assert.equal((await service.capabilities(author)).reason,'ACCOUNT_UNAVAILABLE');
    await assert.rejects(service.save(author,null,content('封禁账号'),null,key()),{code:'AUTH_REQUIRED'});
    await assert.rejects(service.get(null,post.id),{code:'POST_NOT_FOUND'});
  });
  await t.test('explicit posting restrictions block every write and can be lifted without granting game publishing',async()=>{
    const author=await user('user','private');
    let post=await service.save(author,null,content('限制前的草稿'),null,key());
    const input={bytes:4,sha256:hash(Buffer.from('test')),contentType:'image/png'};
    const asset=await media.reserve(author,post.id,input,key());
    await assert.rejects(service.allowMember(reader,author.userId,{allowed:false,reason:'无权限'}),{code:'FORBIDDEN'});
    await service.allowMember(admin,author.userId,{allowed:false,reason:'测试违规限制'});
    assert.equal((await service.capabilities(author)).reason,'POSTING_RESTRICTED');
    assert.equal((await service.capabilities(author)).imagesEnabled,false);
    for(const run of [
      ()=>service.save(author,null,content('限制后创建'),null,key()),
      ()=>service.save(author,post.id,content('限制后编辑'),etag(post),key()),
      ()=>service.submit(author,post.id,etag(post),key()),
      ()=>media.reserve(author,post.id,input,key()),
      ()=>media.upload(author,asset.id,Readable.from([Buffer.from('test')])),
      ()=>media.complete(author,asset.id),
    ])await assert.rejects(run(),{code:'POSTING_RESTRICTED'});
    assert.equal((await service.get(author,post.id,{manage:true})).id,post.id);
    await service.allowMember(admin,author.userId,{allowed:true,reason:'解除测试限制'});
    assert.equal((await service.capabilities(author)).canShare,true);
    post=await service.submit(author,post.id,etag(post),key());assert.equal(post.reviewStatus,'pending');
    await service.allowMember(admin,author.userId,{allowed:false,reason:'再次限制'});
    assert.deepEqual(await service.withdraw(author,post.id,etag(post),true),{deleted:true});
    await pool.query("UPDATE community_media_assets SET expires_at=now()-interval '1 day' WHERE id=$1",[asset.id]);
    await media.cleanOnce();
  });
  await t.test('default posting still enforces pending submission limits',async()=>{
    const author=await user('user','private');
    for(let i=0;i<3;i++){const post=await service.save(author,null,content('待审 '+i),null,key());await service.submit(author,post.id,etag(post),key());}
    const fourth=await service.save(author,null,content('待审超限'),null,key());
    await assert.rejects(service.submit(author,fourth.id,etag(fourth),key()),{code:'RATE_LIMITED'});
  });
  await t.test('exact revision approval, owner CAS, receipt replay and no unreviewed reads',async()=>{
    const requestKey=key();
    let post=await service.save(owner,null,content('初稿'),null,requestKey);
    assert.deepEqual(await service.save(owner,null,content('初稿'),null,requestKey),post);
    await assert.rejects(service.save(owner,null,content('不同内容'),null,requestKey),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(service.get(reader,post.id),{code:'POST_NOT_FOUND'});
    await assert.rejects(service.get(reader,post.id,{manage:true}),{code:'POST_NOT_FOUND'});
    post=await service.submit(owner,post.id,etag(post),key());
    const old=post;
    post=await service.save(owner,post.id,content('新修订'),etag(post),key());
    await assert.rejects(service.decide(admin,old.id,{action:'approve',revisionId:old.revisionId,reason:'旧页面'},etag(old),key()),{code:'POST_VERSION_CONFLICT'});
    await assert.rejects(service.save(owner,post.id,content('覆盖'),etag(old),key()),{code:'POST_VERSION_CONFLICT'});
    post=await service.submit(owner,post.id,etag(post),key());
    post=await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'内部审核备注'},etag(post),key());
    assert.equal((await service.get(reader,post.id)).title,'新修订');
    assert.equal((await service.get(reader,post.id)).reviewReason,null);
    post=await service.save(owner,post.id,content('仍未审核'),etag(post),key());
    assert.equal((await service.get(reader,post.id)).title,'新修订');
    assert.equal((await service.get(owner,post.id,{manage:true})).title,'仍未审核');
    await assert.rejects(pool.query("UPDATE community_post_revisions SET title='偷改' WHERE id=$1",[post.revisionId]));
    post=await service.submit(owner,post.id,etag(post),key());
    post=await service.decide(admin,post.id,{action:'hide',revisionId:post.revisionId,reason:'审核期间隐藏'},etag(post),key());
    post=await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'仅批准正文'},etag(post),key());
    assert.equal(post.moderationState,'hidden');
    await assert.rejects(service.get(reader,post.id),{code:'POST_NOT_FOUND'});
  });
  await t.test('idempotent concurrent likes, private bookmarks and block/hide visibility',async()=>{
    let post=await publish();
    await Promise.all(Array.from({length:10},()=>service.interaction(reader,post.id,'like',true)));
    assert.equal((await service.get(owner,post.id)).likeCount,'1');
    await service.interaction(reader,post.id,'bookmark',true);
    assert.equal((await service.list(reader,{kind:'bookmarks'})).items.length,1);
    assert.equal((await service.list(owner,{kind:'bookmarks'})).items.length,0);
    await pool.query('INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2)',[owner.userId,reader.userId]);
    await assert.rejects(service.get(reader,post.id),{code:'POST_NOT_FOUND'});
    assert.equal((await service.list(reader,{kind:'bookmarks'})).items.length,0);
    await service.interaction(reader,post.id,'bookmark',false);
    await pool.query('DELETE FROM user_blocks WHERE blocker_user_id=$1',[owner.userId]);
    await pool.query("UPDATE users SET social_visibility='private' WHERE id=$1",[owner.userId]);
    assert.equal((await service.get(null,post.id)).id,post.id);
    await pool.query("UPDATE users SET social_visibility='public' WHERE id=$1",[owner.userId]);
    post=await service.decide(admin,post.id,{action:'hide',revisionId:post.revisionId,reason:'测试隐藏'},etag(post),key());
    await assert.rejects(service.get(null,post.id),{code:'POST_NOT_FOUND'});
    post=await service.decide(admin,post.id,{action:'restore',revisionId:post.revisionId,reason:'测试恢复'},etag(post),key());
    assert.equal((await service.get(null,post.id)).id,post.id);
    await Promise.all(Array.from({length:10},()=>service.interaction(reader,post.id,'like',false)));
    assert.equal((await service.get(owner,post.id)).likeCount,'0');
    await assert.rejects(pool.query('DELETE FROM community_moderation_events WHERE post_id=$1',[post.id]));
    await service.report(reader,post.id,{category:'other',details:'测试说明'});
    await pool.query("UPDATE community_interaction_limits SET minute=date_trunc('minute',now()),count=60 WHERE user_id=$1",[reader.userId]);
    await assert.rejects(service.report(reader,post.id,{category:'other',details:'重复更新'}),{code:'RATE_LIMITED'});
    assert.equal((await pool.query('SELECT details FROM community_reports WHERE post_id=$1 AND reporter_id=$2',[post.id,reader.userId])).rows[0].details,'测试说明');
  });
  await t.test('keyset pagination keeps microsecond timestamps and never crosses private scope',async()=>{
    const author=await user();
    // Fixtures bypass daily posting limits to exercise several pages in the same millisecond.
    for(let index=0;index<23;index++){
      const id=key(),revision=key();
      const client=await pool.connect();
      await client.query('BEGIN');
      try{
        await client.query("INSERT INTO community_posts(id,author_id,channel_key,first_published_at) VALUES($1,$2,'ai','2026-01-01T00:00:00.123456Z')",[id,author.userId]);
        await client.query("INSERT INTO community_post_revisions(id,post_id,channel_key,title,blocks,content_hash,review_status) VALUES($1,$2,'ai','分页','[{\"type\":\"paragraph\",\"text\":\"分页\"}]',$3,'approved')",[revision,id,'0'.repeat(64)]);
        await client.query("UPDATE community_posts SET working_revision_id=$2,published_revision_id=$2,publication_state='published' WHERE id=$1",[id,revision]);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
    const first=await service.list(reader,{author:author.userId});
    assert.equal(first.items.length,20);
    const second=await service.list(reader,{author:author.userId,cursor:first.nextCursor});
    assert.equal(second.items.length,3);
    assert.equal(new Set([...first.items,...second.items].map(p=>p.id)).size,23);
    await assert.rejects(service.list(owner,{author:author.userId,cursor:first.nextCursor}),{code:'CURSOR_INVALID'});
  });
  await t.test('image ownership, checksum, derivative-only reads and durable garbage collection',async()=>{
    await pool.query("UPDATE users SET social_visibility='private' WHERE id=$1",[owner.userId]);
    const sharp=require(path.join(root,'apps/api/node_modules/sharp'));
    let post=await service.save(owner,null,content('图片草稿'),null,key());
    const bytes=await sharp({create:{width:80,height:60,channels:3,background:'#7f5cd2'}}).png().toBuffer();
    const asset=await media.reserve(owner,post.id,{bytes:bytes.length,sha256:hash(bytes),contentType:'image/png'},key());
    await assert.rejects(media.upload(reader,asset.id,Readable.from([bytes])),{code:'MEDIA_NOT_FOUND'});
    await assert.rejects(media.upload(owner,asset.id,Readable.from([Buffer.alloc(bytes.length)])),{code:'MEDIA_INTEGRITY'});
    await media.upload(owner,asset.id,Readable.from([bytes]));
    await media.complete(owner,asset.id);
    // A worker died after claiming the job; its expired lease must be recoverable.
    await pool.query("UPDATE community_media_assets SET state='processing',lease_id=$2,lease_until=now()-interval '1 second',attempts=1 WHERE id=$1",[asset.id,key()]);
    assert.equal(await media.runOnce(),true);
    assert.equal((await media.status(owner,asset.id)).state,'ready');
    assert.equal((await pool.query('SELECT attempts FROM community_media_assets WHERE id=$1',[asset.id])).rows[0].attempts,2);
    await assert.rejects(media.content(null,asset.id,'display'),{code:'POST_NOT_FOUND'});
    assert.ok((await media.content(owner,asset.id,'display',{preview:true})).length>0);
    await assert.rejects(media.content(reader,asset.id,'display',{preview:true}),{code:'MEDIA_NOT_FOUND'});
    const withImage={...content('图片内容'),blocks:[{type:'image',assetId:asset.id,alt:'紫色图片'}]};
    const another=await service.save(reader,null,content('另一篇'),null,key());
    await assert.rejects(service.save(reader,another.id,withImage,etag(another),key()),{code:'MEDIA_NOT_READY'});
    post=await service.save(owner,post.id,withImage,etag(post),key());
    post=await service.submit(owner,post.id,etag(post),key());
    post=await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'图片通过'},etag(post),key());
    const image=await media.content(null,asset.id,'display');
    assert.equal((await sharp(image).metadata()).format,'webp');
    if(process.env.GAMEHUB_COMMUNITY_BACKUP_TEST==='true') {
      const {execFileSync}=require('node:child_process');
      const sourceUrl=new URL(url);
      assert.ok(['localhost','127.0.0.1'].includes(sourceUrl.hostname)&&sourceUrl.pathname==='/community_test');
      const restoredName='community_restore_'+key().replaceAll('-','');
      const restoredRoot=path.join(directory,'restored-media');
      await pool.query('CREATE DATABASE '+restoredName);
      let restored;
      try{
        // No worker is running in this fixture: same GC pause as deploy/backup.sh.
        const dump=execFileSync('docker',['exec','gamehub-community-test-pg','pg_dump','-U','community_test','-d','community_test','--format=custom'],{windowsHide:true,maxBuffer:20*1024*1024});
        await fs.cp(store.root,restoredRoot,{recursive:true});
        execFileSync('docker',['exec','-i','gamehub-community-test-pg','pg_restore','-U','community_test','-d',restoredName,'--exit-on-error','--no-owner'],{input:dump,windowsHide:true,maxBuffer:1024*1024});
        sourceUrl.pathname='/'+restoredName;
        restored=createDatabase({databaseUrl:sourceUrl.href});
        const restoredStore=new CommunityMediaStore(restoredRoot);
        const restoredService=new CommunityService({pool:restored.pool,config});
        const restoredMedia=new CommunityMediaService({service:restoredService,store:restoredStore});
        assert.equal((await restoredService.get(null,post.id)).revisionId,post.revisionId);
        assert.equal(hash(await restoredMedia.content(null,asset.id,'display')),hash(image));
        assert.equal((await applyMigrations(restored.pool,path.join(root,'apps/api/migrations'))).applied.length,0);
      } finally {
        if(restored)await restored.close();
        await pool.query('DROP DATABASE '+restoredName);
      }
    }
    await pool.query("UPDATE community_media_assets SET expires_at=now()-interval '1 day' WHERE id=$1",[asset.id]);
    assert.equal(await media.cleanOnce(),0);
    await service.withdraw(owner,post.id,etag(post),true);
    assert.equal(await media.cleanOnce(),0);
    await pool.query("UPDATE community_posts SET updated_at=now()-interval '31 days' WHERE id=$1",[post.id]);
    // Resume a cleaner that committed its intent and removed files before crashing.
    await pool.query("UPDATE community_media_assets SET state='deleting' WHERE id=$1",[asset.id]);
    await store.remove(asset.id);
    assert.equal(await media.cleanOnce(),1);
    assert.equal((await media.status(owner,asset.id)).state,'deleted');
  });
  await t.test('concurrent reservations cannot overspend the shared media budget',async()=>{
    const a=await user(),b=await user();
    const first=await service.save(a,null,content('额度 A'),null,key()),second=await service.save(b,null,content('额度 B'),null,key());
    const existing=Number((await pool.query('SELECT COALESCE(sum(reserved_bytes+stored_bytes),0) AS total FROM community_media_assets')).rows[0].total);
    const constrained=new CommunityService({pool,config:{...config,totalMediaBytes:existing+1212416+10}});
    const bounded=new CommunityMediaService({service:constrained,store,runner});
    const input={bytes:10,contentType:'image/png',sha256:'0'.repeat(64)};
    const results=await Promise.allSettled([bounded.reserve(a,first.id,input,key()),bounded.reserve(b,second.id,input,key())]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.find(result=>result.status==='rejected').reason.code,'MEDIA_QUOTA_EXCEEDED');
    const assetId=results.find(result=>result.status==='fulfilled').value.id;
    await pool.query("UPDATE community_media_assets SET expires_at=now()-interval '1 day' WHERE id=$1",[assetId]);
    await bounded.cleanOnce();
    assert.equal((await pool.query('SELECT state FROM community_media_assets WHERE id=$1',[assetId])).rows[0].state,'deleted');
  });
  await t.test('disabled routes reject before auth/body and comments have no route',async()=>{
    const Fastify=require(path.join(root,'apps/api/node_modules/fastify'));
    const {registerCommunityRoutes}=await import('../../apps/api/src/community-routes.mjs');
    const app=Fastify();let calls=0;
    registerCommunityRoutes(app,{service:new CommunityService({pool:{query:()=>{throw Error('DB should not be touched');}},config:{enabled:false}}),media:{},requireAuth:async()=>{calls++;throw Error('auth should not run');}});
    const disabled=await app.inject({method:'POST',url:'/v1/community/posts',payload:'bad json',headers:{'content-type':'application/json'}});
    assert.equal(disabled.statusCode,503);assert.equal(calls,0);
    assert.equal((await app.inject('/v1/community/capabilities')).json().data.commentsEnabled,false);
    await app.close();
  });
});
