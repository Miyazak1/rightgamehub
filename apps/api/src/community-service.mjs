import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { fail } from './community-errors.mjs';
import { CHANNELS, LIMITS, hash, uuid, normalizeContent, receiptKey, expectedVersion, cursorFor, readCursor } from './community-contract.mjs';

const visible = "p.publication_state='published' AND p.moderation_state='clear' AND u.status='active' AND u.social_visibility='public' AND c.enabled AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.author_id) OR (b.blocked_user_id=$1 AND b.blocker_user_id=p.author_id))";
const columns = "p.*,r.title,r.blocks,r.channel_key AS revision_channel,r.review_status,r.review_reason,r.id AS revision_id,u.display_name,u.profile_handle,COALESCE(s.like_count,0)::text AS like_count,EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,EXISTS(SELECT 1 FROM community_post_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) AS bookmarked";
const joins = " JOIN users u ON u.id=p.author_id JOIN community_channels c ON c.key=p.channel_key LEFT JOIN community_post_stats s ON s.post_id=p.id ";
const view = (row,manage=false) => ({
  id:row.id,author:{id:row.author_id,displayName:row.display_name,handle:row.profile_handle},
  channel:row.revision_channel,title:row.title,blocks:row.blocks,schemaVersion:1,
  publicationState:row.publication_state,moderationState:row.moderation_state,
  revisionId:row.revision_id,reviewStatus:row.review_status,reviewReason:manage?row.review_reason??null:null,
  version:String(row.version),likeCount:String(row.like_count),liked:row.liked,bookmarked:row.bookmarked,
  publishedAt:row.first_published_at?new Date(row.first_published_at).toISOString():null,
  updatedAt:new Date(row.updated_at).toISOString(),
});

export class CommunityService {
  constructor({pool,config,store=null,clock=()=>new Date()}) { Object.assign(this,{pool,config,store,clock}); }
  enabled() { if(!this.config.enabled) fail('COMMUNITY_DISABLED',503,'分享板块暂未开放。'); }
  async actor(client,actor,{posting=false,admin=false}={}) {
    if(!actor?.userId) fail('AUTH_REQUIRED',401,'请登录后继续。');
    const user=(await client.query("SELECT u.*,COALESCE(m.posting_allowed,false) AS posting_allowed FROM users u LEFT JOIN community_members m ON m.user_id=u.id WHERE u.id=$1 FOR SHARE OF u",[actor.userId])).rows[0];
    if(!user||user.status!=='active') fail('AUTH_REQUIRED',401,'账号当前不可用。');
    if(admin&&user.role!=='admin') fail('FORBIDDEN',403,'需要管理员权限。');
    if(posting&&(!this.config.postingEnabled||!user.posting_allowed||user.social_visibility!=='public')) fail('SHARE_NOT_ALLOWED',403,'暂不具备投稿资格，或个人资料未设为公开。');
    return user;
  }
  async capabilities(actor) {
    let member=null;
    if(this.config.enabled&&actor?.userId) member=(await this.pool.query("SELECT u.status,u.role,u.social_visibility,COALESCE(m.posting_allowed,false) AS posting_allowed FROM users u LEFT JOIN community_members m ON m.user_id=u.id WHERE u.id=$1",[actor.userId])).rows[0];
    const canShare=Boolean(this.config.enabled&&this.config.postingEnabled&&member?.status==='active'&&member.posting_allowed&&member.social_visibility==='public');
    return {readEnabled:this.config.enabled,postingEnabled:this.config.postingEnabled&&this.config.enabled,imagesEnabled:this.config.imagesEnabled&&canShare,likesEnabled:this.config.enabled,bookmarksEnabled:this.config.enabled,commentsEnabled:false,canShare,isAdmin:member?.role==='admin',reason:canShare?null:!this.config.enabled?'COMMUNITY_DISABLED':!actor?.userId?'AUTH_REQUIRED':member?.social_visibility!=='public'?'PROFILE_NOT_PUBLIC':'SHARE_NOT_ALLOWED',channels:CHANNELS,limits:{...LIMITS,totalBytes:this.config.totalMediaBytes??LIMITS.totalBytes}};
  }
  async tx(action) {
    return withTransaction(this.pool,async client=>{
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='3s'");
      return action(client);
    });
  }
  async interactionLimit(client,actor) {
    const rate=await client.query("INSERT INTO community_interaction_limits(user_id,minute,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(user_id) DO UPDATE SET minute=EXCLUDED.minute,count=CASE WHEN community_interaction_limits.minute=EXCLUDED.minute THEN community_interaction_limits.count+1 ELSE 1 END RETURNING count",[actor.userId]);
    if(rate.rows[0].count>60)fail('RATE_LIMITED',429,'操作太频繁，请稍后再试。');
  }
  async mutation(actor,operation,key,input,action,options={}) {
    this.enabled();const keyHash=receiptKey(key),requestHash=hash(JSON.stringify(input));
    return this.tx(async client=>{
      await this.actor(client,actor,options);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['community-user:'+actor.userId]);
      const prior=(await client.query('SELECT * FROM community_write_receipts WHERE actor_id=$1 AND operation=$2 AND key_hash=$3',[actor.userId,operation,keyHash])).rows[0];
      if(prior) {
        if(prior.request_hash!==requestHash) fail('IDEMPOTENCY_CONFLICT',409,'请求标识已用于其他内容。');
        return prior.result;
      }
      const result=await action(client);
      await client.query('INSERT INTO community_write_receipts(actor_id,operation,key_hash,request_hash,result) VALUES($1,$2,$3,$4,$5)',[actor.userId,operation,keyHash,requestHash,result]);
      return result;
    });
  }
  async postLock(client,id,actor,version,{admin=false,deleted=false}={}) {
    if(!uuid(id)) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
    const post=(await client.query('SELECT * FROM community_posts WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!post||(!admin&&post.author_id!==actor.userId)||(!deleted&&post.publication_state==='deleted')) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
    if(version!==undefined&&String(post.version)!==version) fail('POST_VERSION_CONFLICT',409,'分享已更新，请重新加载。');
    return post;
  }
  async own(client,id,viewerId,admin=false) {
    const row=(await client.query('SELECT '+columns+' FROM community_posts p'+joins+' JOIN community_post_revisions r ON r.id=p.working_revision_id WHERE p.id=$2'+(admin?'':' AND p.author_id=$1'),[viewerId,id])).rows[0];
    if(!row) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
    return view(row,true);
  }
  async assertMedia(client,postId,authorId,blocks) {
    const ids=blocks.filter(b=>b.type==='image').map(b=>b.assetId);
    if(!ids.length) return;
    const rows=(await client.query("SELECT id FROM community_media_assets WHERE id=ANY($1::uuid[]) AND post_id=$2 AND owner_id=$3 AND state='ready' FOR SHARE",[ids,postId,authorId])).rows;
    if(rows.length!==ids.length) fail('MEDIA_NOT_READY',409,'图片尚未完成处理，或不属于当前分享。');
  }
  async save(actor,id,input,version,key) {
    const content=normalizeContent(input),expected=id?expectedVersion(version):null;
    if(!id&&content.blocks.some(b=>b.type==='image')) fail('MEDIA_NOT_READY',409,'请先保存草稿，再上传图片。');
    return this.mutation(actor,id?'edit':'create',key,{id,content,expected},async client=>{
      let post;
      if(id) post=await this.postLock(client,id,actor,expected);
      else {
        const count=Number((await client.query("SELECT count(*) FROM community_posts WHERE author_id=$1 AND publication_state IN ('draft','withdrawn')",[actor.userId])).rows[0].count);
        if(count>=LIMITS.drafts) fail('DRAFT_LIMIT',429,'请先清理或发布已有草稿。');
        id=crypto.randomUUID();
        post=(await client.query('INSERT INTO community_posts(id,author_id,channel_key) VALUES($1,$2,$3) RETURNING *',[id,actor.userId,content.channel])).rows[0];
        await client.query('INSERT INTO community_post_stats(post_id) VALUES($1)',[id]);
      }
      const daily=Number((await client.query("SELECT count(*) FROM community_write_receipts WHERE actor_id=$1 AND operation IN ('create','edit') AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[actor.userId])).rows[0].count);
      if(daily>=30) fail('RATE_LIMITED',429,'今天的编辑次数已达上限。');
      const count=Number((await client.query('SELECT count(*) FROM community_post_revisions WHERE post_id=$1',[id])).rows[0].count);
      if(count>=100) fail('REVISION_LIMIT',429,'该分享的修订数量已达上限。');
      await this.assertMedia(client,id,actor.userId,content.blocks);
      if(post.working_revision_id) await client.query("UPDATE community_post_revisions SET review_status='superseded' WHERE id=$1 AND review_status IN ('draft','pending')",[post.working_revision_id]);
      const revision=crypto.randomUUID();
      await client.query('INSERT INTO community_post_revisions(id,post_id,channel_key,title,blocks,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[revision,id,content.channel,content.title,JSON.stringify(content.blocks),hash(JSON.stringify(content))]);
      for(const block of content.blocks.filter(b=>b.type==='image')) await client.query('INSERT INTO community_revision_media(post_id,revision_id,asset_id) VALUES($1,$2,$3)',[id,revision,block.assetId]);
      await client.query("UPDATE community_posts SET working_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1",[id,revision]);
      return this.own(client,id,actor.userId);
    },{posting:true});
  }
  async submit(actor,id,version,key) {
    const expected=expectedVersion(version);
    return this.mutation(actor,'submit',key,{id,expected},async client=>{
      const post=await this.postLock(client,id,actor,expected);
      const revision=(await client.query('SELECT * FROM community_post_revisions WHERE id=$1',[post.working_revision_id])).rows[0];
      if(!['draft','rejected'].includes(revision.review_status)) fail('REVIEW_STATE_INVALID',409,'当前版本不能再次提交。');
      const counts=(await client.query("SELECT (SELECT count(*) FROM community_write_receipts WHERE actor_id=$1 AND operation='submit' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS daily,(SELECT count(*) FROM community_posts p JOIN community_post_revisions r ON r.id=p.working_revision_id WHERE p.author_id=$1 AND r.review_status='pending') AS pending",[actor.userId])).rows[0];
      if(Number(counts.daily)>=LIMITS.dailyPosts||Number(counts.pending)>=LIMITS.pending) fail('RATE_LIMITED',429,'投稿次数或待审核数量已达上限。');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('community-review-queue',0))");
      const total=Number((await client.query("SELECT count(*) FROM community_post_revisions WHERE review_status='pending'")).rows[0].count);
      if(total>=200) fail('REVIEW_QUEUE_FULL',429,'审核队列已满，请稍后再试。');
      await this.assertMedia(client,id,actor.userId,revision.blocks);
      await client.query("UPDATE community_post_revisions SET review_status='pending',review_reason=NULL,submitted_at=now() WHERE id=$1",[revision.id]);
      await client.query('UPDATE community_posts SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      return this.own(client,id,actor.userId);
    },{posting:true});
  }
  async withdraw(actor,id,version,remove=false) {
    this.enabled();const expected=expectedVersion(version);
    return this.tx(async client=>{
      await this.actor(client,actor);
      const post=await this.postLock(client,id,actor,undefined,{deleted:true});
      if(post.publication_state==='deleted') return {deleted:true};
      if(String(post.version)!==expected) fail('POST_VERSION_CONFLICT',409,'分享已更新，请重新加载。');
      await client.query("UPDATE community_post_revisions SET review_status='superseded' WHERE id=$1 AND review_status='pending'",[post.working_revision_id]);
      await client.query('UPDATE community_posts SET publication_state=$2,version=version+1,updated_at=now() WHERE id=$1',[id,remove?'deleted':'withdrawn']);
      return remove?{deleted:true}:this.own(client,id,actor.userId);
    });
  }
  async get(actor,id,{manage=false}={}) {
    this.enabled();
    if(manage) return this.tx(async client=>{await this.actor(client,actor);return this.own(client,id,actor.userId);});
    if(!uuid(id)) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
    const row=(await this.pool.query('SELECT '+columns+' FROM community_posts p'+joins+' JOIN community_post_revisions r ON r.id=p.published_revision_id WHERE '+visible+' AND p.id=$2',[actor?.userId??null,id])).rows[0];
    if(!row) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
    return view(row);
  }
  async list(actor,{channel=null,author=null,cursor=null,kind='feed'}={}) {
    this.enabled();
    if(!['feed','mine','bookmarks'].includes(kind)||channel&&!CHANNELS.some(c=>c.key===channel)||author&&!uuid(author)) fail('SCHEMA_INVALID',400,'列表参数无效。');
    if(kind!=='feed'&&!actor?.userId) fail('AUTH_REQUIRED',401,'请登录后查看。');
    const scope=JSON.stringify([kind,channel,author,actor?.userId??null]),position=readCursor(cursor,scope),anchor=position?.anchor??this.clock().toISOString();
    const mine=kind==='mine',saved=kind==='bookmarks',time=saved?'b.created_at':mine?'p.updated_at':'p.first_published_at',sortId=saved?'b.id':'p.id';
    const query='SELECT '+columns+','+time+'::text AS sort_at,'+sortId+' AS sort_id FROM community_posts p'+joins+
      ' JOIN community_post_revisions r ON r.id=p.'+(mine?'working_revision_id':'published_revision_id')+
      (saved?' JOIN community_post_bookmarks b ON b.post_id=p.id AND b.user_id=$1':'')+
      ' WHERE '+(mine?"p.author_id=$1 AND p.publication_state<>'deleted'":visible)+
      ' AND ($2::text IS NULL OR r.channel_key=$2) AND ($3::uuid IS NULL OR p.author_id=$3) AND '+time+'<=$4::timestamptz AND ($5::timestamptz IS NULL OR ('+time+','+sortId+')<($5::timestamptz,$6::uuid)) ORDER BY '+time+' DESC,'+sortId+' DESC LIMIT 21';
    const rows=(await this.pool.query(query,[actor?.userId??null,channel,author,anchor,position?.at??null,position?.id??null])).rows;
    const page=rows.slice(0,20);
    return {items:page.map(row=>view(row,mine)),nextCursor:rows.length>20?cursorFor(scope,page.at(-1),anchor):null};
  }
  async interaction(actor,id,type,add) {
    this.enabled();if(!['like','bookmark'].includes(type)||!uuid(id)) fail('SCHEMA_INVALID',400,'互动参数无效。');
    return this.tx(async client=>{
      await this.actor(client,actor);
      await this.interactionLimit(client,actor);
      await client.query('SELECT id FROM community_posts WHERE id=$1 FOR UPDATE',[id]);
      if(add) {
        const allowed=(await client.query('SELECT p.id FROM community_posts p'+joins+' WHERE '+visible+' AND p.id=$2',[actor.userId,id])).rowCount;
        if(!allowed) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
      }
      const table=type==='like'?'community_post_likes':'community_post_bookmarks';
      const changed=add
        ? await client.query('INSERT INTO '+table+'('+(type==='bookmark'?'id,':'')+'post_id,user_id) VALUES('+(type==='bookmark'?'$3,':'')+'$1,$2) ON CONFLICT(post_id,user_id) DO NOTHING',type==='bookmark'?[id,actor.userId,crypto.randomUUID()]:[id,actor.userId])
        : await client.query('DELETE FROM '+table+' WHERE post_id=$1 AND user_id=$2',[id,actor.userId]);
      if(type==='like'&&changed.rowCount) await client.query('UPDATE community_post_stats SET like_count=GREATEST(0,like_count+$2) WHERE post_id=$1',[id,add?1:-1]);
      return {active:add};
    });
  }
  async audit(client,actor,id,revision,action,reason,details={}) {
    await client.query('INSERT INTO community_moderation_events(id,actor_id,post_id,revision_id,action,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),actor.userId,id,revision,action,reason,details]);
  }
  async reviewQueue(actor,{cursor=null}={}) {
    this.enabled();return this.tx(async client=>{
      await this.actor(client,actor,{admin:true});
      const scope='review:'+actor.userId,position=readCursor(cursor,scope),anchor=position?.anchor??this.clock().toISOString();
      const rows=(await client.query('SELECT '+columns+",p.updated_at::text AS sort_at,p.id AS sort_id,rpub.id AS public_revision,rpub.title AS public_title,rpub.blocks AS public_blocks FROM community_posts p"+joins+" JOIN community_post_revisions r ON r.id=p.working_revision_id LEFT JOIN community_post_revisions rpub ON rpub.id=p.published_revision_id WHERE p.publication_state<>'deleted' AND (r.review_status='pending' OR p.moderation_state='hidden' OR EXISTS(SELECT 1 FROM community_reports cr WHERE cr.post_id=p.id AND cr.status='open')) AND p.updated_at<=$2::timestamptz AND ($3::timestamptz IS NULL OR (p.updated_at,p.id)>($3::timestamptz,$4::uuid)) ORDER BY p.updated_at ASC,p.id LIMIT 51",[actor.userId,anchor,position?.at??null,position?.id??null])).rows;
      const posts=rows.slice(0,50);
      const ids=posts.map(p=>p.id),reports=(await client.query("SELECT id,post_id,category,details,created_at FROM community_reports WHERE post_id=ANY($1::uuid[]) AND status='open' ORDER BY created_at LIMIT 100",[ids])).rows;
      return {items:posts.map(p=>({...view(p,true),publishedContent:p.public_revision?{revisionId:p.public_revision,title:p.public_title,blocks:p.public_blocks}:null,reports:reports.filter(r=>r.post_id===p.id)})),nextCursor:rows.length>50?cursorFor(scope,posts.at(-1),anchor):null};
    });
  }
  async decide(actor,id,input,version,key) {
    if(!['approve','reject','hide','restore','dismiss_reports'].includes(input?.action)||!uuid(input.revisionId)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000) fail('SCHEMA_INVALID',400,'请填写审核操作与理由。');
    const expected=expectedVersion(version);
    return this.mutation(actor,'decision',key,{id,input,expected},async client=>{
      const post=await this.postLock(client,id,actor,expected,{admin:true});
      if(post.working_revision_id!==input.revisionId) fail('REVIEW_VERSION_STALE',409,'待审版本已改变，请重新加载。');
      const revision=(await client.query('SELECT * FROM community_post_revisions WHERE id=$1',[input.revisionId])).rows[0];
      if(['approve','reject'].includes(input.action)) {
        if(revision.review_status!=='pending') fail('REVIEW_STATE_INVALID',409,'该版本不在待审状态。');
        if(input.action==='approve') {
          await this.assertMedia(client,id,post.author_id,revision.blocks);
          await client.query("UPDATE community_posts SET published_revision_id=$2,channel_key=$3,publication_state='published',first_published_at=COALESCE(first_published_at,now()) WHERE id=$1",[id,revision.id,revision.channel_key]);
        }
        await client.query('UPDATE community_post_revisions SET review_status=$2,review_reason=$3 WHERE id=$1',[revision.id,input.action==='approve'?'approved':'rejected',input.reason.trim()]);
      } else if(['hide','restore'].includes(input.action)) {
        await client.query('UPDATE community_posts SET moderation_state=$2 WHERE id=$1',[id,input.action==='hide'?'hidden':'clear']);
      }
      if(['hide','dismiss_reports'].includes(input.action)) await client.query("UPDATE community_reports SET status=$2,resolved_at=now() WHERE post_id=$1 AND status='open'",[id,input.action==='hide'?'resolved':'dismissed']);
      await client.query('UPDATE community_posts SET version=version+1,updated_at=now() WHERE id=$1',[id]);
      await this.audit(client,actor,id,revision.id,input.action,input.reason.trim(),{previousVersion:String(post.version)});
      return this.own(client,id,actor.userId,true);
    },{admin:true});
  }
  async allowMember(actor,userId,input) {
    this.enabled();
    if(!uuid(userId)||typeof input?.allowed!=='boolean'||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000) fail('SCHEMA_INVALID',400,'资格设置无效。');
    return this.tx(async client=>{
      await this.actor(client,actor,{admin:true});
      if(!(await client.query("SELECT id FROM users WHERE id=$1 AND status='active'",[userId])).rowCount) fail('NOT_FOUND',404,'用户不存在。');
      await client.query('INSERT INTO community_members(user_id,posting_allowed,reason,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET posting_allowed=EXCLUDED.posting_allowed,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()',[userId,input.allowed,input.reason.trim(),actor.userId]);
      await this.audit(client,actor,null,null,'member_policy',input.reason.trim(),{userId,allowed:input.allowed});
      return {allowed:input.allowed};
    });
  }
  async report(actor,id,input) {
    this.enabled();
    if(!['unsafe','harassment','copyright','spam','other'].includes(input?.category)||typeof input.details!=='string'||!input.details.trim()||input.details.length>1000) fail('SCHEMA_INVALID',400,'举报内容无效。');
    return this.tx(async client=>{
      await this.actor(client,actor);
      const allowed=(await client.query('SELECT p.id FROM community_posts p'+joins+' WHERE '+visible+' AND p.id=$2',[actor.userId,id])).rowCount;
      if(!allowed) fail('POST_NOT_FOUND',404,'分享不存在或不可见。');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['community-user:'+actor.userId]);
      const recent=Number((await client.query("SELECT count(*) FROM community_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 day'",[actor.userId])).rows[0].count);
      await this.interactionLimit(client,actor);
      if(recent>=20) fail('RATE_LIMITED',429,'今日举报数量已达上限。');
      await client.query("INSERT INTO community_reports(id,post_id,reporter_id,category,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(post_id,reporter_id) WHERE status='open' DO UPDATE SET category=EXCLUDED.category,details=EXCLUDED.details",[crypto.randomUUID(),id,actor.userId,input.category,input.details.trim()]);
      return {received:true};
    });
  }
}
