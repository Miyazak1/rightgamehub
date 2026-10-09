const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),url=process.env.GAMEHUB_COMMUNITY_DATABASE_URL;
test('open posting migration preserves legacy private audiences and restrictions',{skip:!url,timeout:60000},async t=>{
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname)&&parsed.pathname==='/community_test');
  const {createDatabase}=await import('../../apps/api/src/database.mjs');
  const {applyMigrations}=await import('../../apps/api/src/migrations.mjs');
  const {CommunityService}=await import('../../apps/api/src/community-service.mjs');
  const {CommunityMediaService}=await import('../../apps/api/src/community-media-service.mjs');
  const {CommunityMediaStore}=await import('../../apps/api/src/community-media-store.mjs');
  const {hash}=await import('../../apps/api/src/community-contract.mjs');
  const uuid=()=>crypto.randomUUID(),name='community_posting_'+uuid().replaceAll('-','');
  const control=createDatabase({databaseUrl:url}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'community-posting-migration-'));
  let database,created=false;
  t.after(async()=>{
    await database?.close();
    if(created)await control.pool.query('DROP DATABASE '+name);
    await control.close();assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});
  });
  await control.pool.query('CREATE DATABASE '+name);created=true;parsed.pathname='/'+name;
  database=createDatabase({databaseUrl:parsed.href});const pool=database.pool;
  const previous=path.join(directory,'migrations');await fs.mkdir(previous);
  for(const file of await fs.readdir(path.join(root,'apps/api/migrations')))if(/^00(?:[0-4][0-9]|50)_.*\.sql$/.test(file))await fs.copyFile(path.join(root,'apps/api/migrations',file),path.join(previous,file));
  assert.equal((await applyMigrations(pool,previous)).total,50);
  const author={userId:uuid()},admin={userId:uuid()},restricted={userId:uuid()};
  for(const actor of [author,admin,restricted])await pool.query("INSERT INTO users(id,display_name,role,social_visibility,profile_handle) VALUES($1,'历史测试账号',$2,'private',$3)",[actor.userId,actor===admin?'admin':'user','m'+actor.userId.replaceAll('-','').slice(0,12)]);
  await pool.query("INSERT INTO community_members(user_id,posting_allowed,reason,updated_by) VALUES($1,false,'此前明确限制',$2)",[restricted.userId,admin.userId]);
  const store=new CommunityMediaStore(path.join(directory,'media'));
  const image=await require(path.join(root,'apps/api/node_modules/sharp'))({create:{width:20,height:20,channels:3,background:'#615099'}}).webp().toBuffer();
  const assetId=uuid(),imageKey=hash(image)+'-display.webp';
  async function legacy(status,withImage=false){
    const id=uuid(),revision=uuid(),content={channel:'ai',title:'历史 '+status,blocks:withImage?[{type:'image',assetId,alt:'旧草稿图片'}]:[{type:'paragraph',text:'仅允许在作者主动提交且审核后转为独立公开。'}]};
    const client=await pool.connect();await client.query('BEGIN');
    try{
      await client.query("INSERT INTO community_posts(id,author_id,channel_key) VALUES($1,$2,'ai')",[id,author.userId]);
      await client.query("INSERT INTO community_post_revisions(id,post_id,channel_key,title,blocks,content_hash,review_status) VALUES($1,$2,'ai',$3,$4,$5,$6)",[revision,id,content.title,JSON.stringify(content.blocks),hash(JSON.stringify(content)),status]);
      await client.query("UPDATE community_posts SET working_revision_id=$2,published_revision_id=CASE WHEN $3 THEN $2::uuid ELSE NULL END,publication_state=CASE WHEN $3 THEN 'published' ELSE 'draft' END,first_published_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1",[id,revision,status==='approved']);
      await client.query('INSERT INTO community_post_stats(post_id) VALUES($1)',[id]);
      if(withImage){
        await client.query("INSERT INTO community_media_assets(id,owner_id,post_id,state,declared_bytes,reserved_bytes,stored_bytes,input_hash,input_type,variants,width,height) VALUES($1,$2,$3,'ready',$4::integer,0,$4::bigint,$5,'image/webp',$6,20,20)",[assetId,author.userId,id,image.length,hash(image),{display:{key:imageKey,bytes:image.length,sha256:hash(image)}}]);
        await client.query('INSERT INTO community_revision_media(post_id,revision_id,asset_id) VALUES($1,$2,$3)',[id,revision,assetId]);
      }
      await client.query('COMMIT');return {id,revision};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const approved=await legacy('approved'),pending=await legacy('pending'),draft=await legacy('draft',true);
  await store.put(assetId,imageKey,image);
  const migration=await applyMigrations(pool,path.join(root,'apps/api/migrations'));
  assert.deepEqual(migration.applied,['0051_community_open_posting.sql','0052_daily_leaderboard_lookup.sql','0053_competition_boards.sql','0054_contribution_workflow.sql']);assert.equal(migration.total,54);
  assert.equal((await applyMigrations(pool,path.join(root,'apps/api/migrations'))).applied.length,0);
  assert.ok((await pool.query('SELECT visibility_policy FROM community_post_revisions')).rows.every(r=>r.visibility_policy==='profile'));
  const service=new CommunityService({pool,config:{enabled:true,postingEnabled:true,imagesEnabled:true}}),media=new CommunityMediaService({service,store});
  assert.equal((await service.capabilities(author)).canShare,true);assert.equal((await service.capabilities(restricted)).reason,'POSTING_RESTRICTED');
  await assert.rejects(service.get(null,approved.id),{code:'POST_NOT_FOUND'});
  await assert.rejects(media.content(null,assetId,'display'),{code:'POST_NOT_FOUND'});
  assert.equal((await service.list(null)).items.length,0);
  let post=await service.get(author,pending.id,{manage:true});
  await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'只审核已有旧内容'},'"'+post.version+'"',uuid());
  await assert.rejects(service.get(null,pending.id),{code:'POST_NOT_FOUND'});
  post=await service.get(author,draft.id,{manage:true});const before=post,requestKey=uuid();
  post=await service.submit(author,post.id,'"'+post.version+'"',requestKey);
  assert.notEqual(post.revisionId,draft.revision);
  assert.deepEqual(await service.submit(author,before.id,'"'+before.version+'"',requestKey),post);
  assert.equal((await pool.query('SELECT visibility_policy FROM community_post_revisions WHERE id=$1',[post.revisionId])).rows[0].visibility_policy,'post');
  assert.equal((await pool.query('SELECT count(*)::int n FROM community_revision_media WHERE revision_id=$1 AND asset_id=$2',[post.revisionId,assetId])).rows[0].n,1);
  await assert.rejects(service.get(null,post.id),{code:'POST_NOT_FOUND'});
  await service.decide(admin,post.id,{action:'approve',revisionId:post.revisionId,reason:'作者主动提交后的新公开版本'},'"'+post.version+'"',uuid());
  assert.equal((await service.get(null,post.id)).author.handle,null);
  assert.deepEqual(await media.content(null,assetId,'display'),image);
  assert.equal((await pool.query('SELECT social_visibility FROM users WHERE id=$1',[author.userId])).rows[0].social_visibility,'private');
  await assert.rejects(pool.query("UPDATE community_post_revisions SET visibility_policy='post' WHERE id=$1",[approved.revision]));
});
