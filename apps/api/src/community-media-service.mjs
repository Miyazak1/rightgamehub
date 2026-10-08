import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { LIMITS,hash,uuid } from './community-contract.mjs';
import { fail } from './community-errors.mjs';

export class CommunityMediaService {
  constructor({service,store,runner,capacity}) { Object.assign(this,{service,store,runner,capacity}); }
  available() { this.service.enabled();if(!this.service.config.imagesEnabled)fail('COMMUNITY_IMAGES_DISABLED',503,'图片上传暂未开放。'); }
  async reserve(actor,postId,input,key) {
    this.available();
    if(!Number.isInteger(input?.bytes)||input.bytes<1||input.bytes>LIMITS.inputBytes||!['image/jpeg','image/png','image/webp'].includes(input.contentType)||!/^[a-f0-9]{64}$/.test(input.sha256??'')) fail('MEDIA_INVALID',400,'图片大小或格式无效。');
    const charge=input.bytes+LIMITS.variantBytes;
    return this.service.mutation(actor,'media',key,{postId,input},async client=>{
      await this.service.postLock(client,postId,actor);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('community-media-budget',0))");
      const totals=(await client.query("SELECT COALESCE(sum(reserved_bytes+stored_bytes),0)::text AS total,COALESCE(sum(reserved_bytes+stored_bytes) FILTER(WHERE owner_id=$1),0)::text AS own,count(*) FILTER(WHERE owner_id=$1 AND created_at>now()-interval '1 day') AS daily,count(*) FILTER(WHERE state IN ('reserved','uploaded','processing')) AS queued FROM community_media_assets",[actor.userId])).rows[0];
      if(BigInt(totals.total)+BigInt(charge)>BigInt(this.service.config.totalMediaBytes??LIMITS.totalBytes)||BigInt(totals.own)+BigInt(charge)>BigInt(LIMITS.userBytes)||Number(totals.daily)>=LIMITS.dailyUploads||Number(totals.queued)>=LIMITS.queue) fail('MEDIA_QUOTA_EXCEEDED',429,'图片额度或处理队列已满。');
      const reservations=(await client.query('SELECT COALESCE(sum(reserved_bytes),0)::text AS bytes FROM community_media_assets')).rows[0].bytes;
      if(this.capacity) await this.capacity(charge+Number(reservations));
      const id=crypto.randomUUID();
      await client.query('INSERT INTO community_media_assets(id,owner_id,post_id,declared_bytes,reserved_bytes,input_hash,input_type) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor.userId,postId,input.bytes,charge,input.sha256,input.contentType]);
      return {id,state:'reserved'};
    },{posting:true});
  }
  async asset(actor,id) {
    if(!uuid(id))fail('MEDIA_NOT_FOUND',404,'图片不存在。');
    const asset=(await this.service.pool.query('SELECT * FROM community_media_assets WHERE id=$1 AND owner_id=$2',[id,actor?.userId??null])).rows[0];
    if(!asset)fail('MEDIA_NOT_FOUND',404,'图片不存在。');
    return asset;
  }
  async upload(actor,id,stream) {
    this.available();
    return this.service.tx(async client=>{
      await this.service.actor(client,actor,{posting:true});
      const asset=(await client.query('SELECT * FROM community_media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.userId])).rows[0];
      if(!asset||!['reserved','uploaded'].includes(asset.state)||new Date(asset.expires_at)<new Date())fail('MEDIA_NOT_FOUND',404,'图片上传已失效。');
      const chunks=[];let length=0;
      for await(const chunk of stream){length+=chunk.length;if(length>asset.declared_bytes||length>LIMITS.inputBytes)fail('MEDIA_TOO_LARGE',413,'图片超过声明大小。');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);
      if(bytes.length!==asset.declared_bytes||hash(bytes)!==asset.input_hash)fail('MEDIA_INTEGRITY',400,'图片内容校验失败。');
      await this.store.put(id,'input',bytes);
      return {id,uploaded:true};
    });
  }
  async complete(actor,id) {
    this.available();return this.service.tx(async client=>{
      await this.service.actor(client,actor,{posting:true});
      const asset=(await client.query('SELECT * FROM community_media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.userId])).rows[0];
      if(!asset||asset.state==='deleted'||new Date(asset.expires_at)<new Date()&&asset.state==='reserved')fail('MEDIA_NOT_FOUND',404,'图片不存在或已过期。');
      if(asset.state==='reserved') {
        await this.store.get(id,'input',asset.input_hash,asset.declared_bytes);
        await client.query("UPDATE community_media_assets SET state='uploaded' WHERE id=$1",[id]);
      }
      return {id,state:asset.state==='reserved'?'uploaded':asset.state};
    });
  }
  async status(actor,id) {
    this.service.enabled();const asset=await this.asset(actor,id);
    return {id:asset.id,state:asset.state,width:asset.width,height:asset.height,errorCode:asset.error_code};
  }
  async content(actor,id,variant,{preview=false}={}) {
    this.service.enabled();
    if(!uuid(id)||!['thumb','display'].includes(variant))fail('MEDIA_NOT_FOUND',404,'图片不存在。');
    const asset=(await this.service.pool.query("SELECT * FROM community_media_assets WHERE id=$1 AND state='ready'",[id])).rows[0];
    if(!asset)fail('MEDIA_NOT_FOUND',404,'图片不存在或不可见。');
    if(preview) {
      const user=actor?.userId?(await this.service.pool.query("SELECT role FROM users WHERE id=$1 AND status='active'",[actor.userId])).rows[0]:null;
      if(!user||(asset.owner_id!==actor.userId&&user.role!=='admin'))fail('MEDIA_NOT_FOUND',404,'图片不存在或不可见。');
    } else {
      const post=await this.service.get(actor,asset.post_id);
      if(!post.blocks.some(block=>block.type==='image'&&block.assetId===id))fail('MEDIA_NOT_FOUND',404,'图片不在已发布版本中。');
    }
    const value=asset.variants[variant];if(!value)fail('MEDIA_NOT_FOUND',404,'图片不存在。');
    return this.store.get(id,value.key,value.sha256,variant==='thumb'?163840:1048576);
  }
  async runOnce() {
    if(!this.service.config.enabled||!this.service.config.imagesEnabled)return false;
    const connection=await this.service.pool.connect();
    let locked=false,job;
    try{
      locked=(await connection.query("SELECT pg_try_advisory_lock(hashtextextended('community-image-worker',0)) AS locked")).rows[0].locked;
      if(!locked)return false;
      const lease=crypto.randomUUID();
      job=await this.service.tx(async client=>{
        const asset=(await client.query("SELECT * FROM community_media_assets WHERE state='uploaded' OR (state='processing' AND lease_until<now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
        if(!asset)return null;
        if(asset.attempts>=3){await client.query("UPDATE community_media_assets SET state='failed',lease_id=NULL,lease_until=NULL,error_code='IMAGE_RETRY_EXHAUSTED' WHERE id=$1",[asset.id]);return null;}
        return (await client.query("UPDATE community_media_assets SET state='processing',lease_id=$2,lease_until=now()+interval '40 seconds',attempts=attempts+1 WHERE id=$1 RETURNING *",[asset.id,lease])).rows[0];
      });
      if(!job)return false;
      try{
        await this.store.get(job.id,'input',job.input_hash,job.declared_bytes);
        const {report,output}=await this.runner.run(job,lease);
        if(report.format!=={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[job.input_type])fail('IMAGE_INVALID',400,'实际图片格式不匹配。');
        const variants={};let bytes=job.declared_bytes;
        for(const variant of ['thumb','display']){
          const file=path.join(output,variant+'.webp'),stat=await fs.stat(file),limit=variant==='thumb'?163840:1048576;
          if(!stat.isFile()||stat.size<1||stat.size>limit)fail('IMAGE_INVALID',400,'派生图片大小无效。');
          const body=await fs.readFile(file),sha256=hash(body),key=sha256+'-'+variant+'.webp';
          await this.store.put(job.id,key,body);variants[variant]={key,sha256,bytes:body.length};bytes+=body.length;
        }
        const dimensions=report.variants?.display;
        if(!Number.isInteger(dimensions?.width)||!Number.isInteger(dimensions?.height)||dimensions.width<1||dimensions.height<1||dimensions.width>1600||dimensions.height>1600)fail('IMAGE_INVALID',400,'图片尺寸无效。');
        await this.service.pool.query("UPDATE community_media_assets SET state='ready',variants=$3,width=$4,height=$5,stored_bytes=$6,reserved_bytes=0,lease_id=NULL,lease_until=NULL,error_code=NULL WHERE id=$1 AND lease_id=$2 AND state='processing' AND lease_until>now()",[job.id,lease,variants,dimensions.width,dimensions.height,bytes]);
      }catch(error){
        await this.service.pool.query("UPDATE community_media_assets SET state='failed',lease_id=NULL,lease_until=NULL,error_code=$3 WHERE id=$1 AND lease_id=$2",[job.id,lease,['IMAGE_INVALID','IMAGE_TIMEOUT'].includes(error.code)?error.code:'IMAGE_PROCESSOR_UNAVAILABLE']);
      }finally{await this.runner.cleanup(lease).catch(()=>{});}
      return true;
    }finally{
      if(locked)await connection.query("SELECT pg_advisory_unlock(hashtextextended('community-image-worker',0))").catch(()=>{});
      connection.release();
    }
  }
  async cleanOnce() {
    if(!this.service.config.enabled)return 0;
    await this.service.pool.query('DELETE FROM community_write_receipts WHERE (actor_id,operation,key_hash) IN (SELECT actor_id,operation,key_hash FROM community_write_receipts WHERE expires_at<now() ORDER BY expires_at LIMIT 500)');
    if(!this.service.config.imagesEnabled)return 0;
    const connection=await this.service.pool.connect();
    let locked=false,removed=0;
    try {
      // Backups hold this session lock until both the database and immutable files are copied.
      locked=(await connection.query("SELECT pg_try_advisory_lock(hashtextextended('community-media-gc',0)) AS locked")).rows[0].locked;
      if(!locked)return 0;
      const protectedReference="EXISTS(SELECT 1 FROM community_revision_media rm JOIN community_posts p ON p.id=rm.post_id WHERE rm.asset_id=a.id AND (p.publication_state<>'deleted' OR p.updated_at>now()-interval '30 days'))";
      const rows=(await connection.query("SELECT a.id FROM community_media_assets a WHERE a.expires_at<now() AND a.state NOT IN ('processing','deleted') AND NOT "+protectedReference+" ORDER BY a.expires_at LIMIT 10")).rows;
      for(const row of rows) {
        const claimed=await this.service.tx(async client=>{
          const asset=(await client.query('SELECT * FROM community_media_assets WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
          if(!asset||['processing','deleted'].includes(asset.state))return false;
          if((await client.query("SELECT 1 FROM community_media_assets a WHERE a.id=$1 AND "+protectedReference,[row.id])).rowCount)return false;
          await client.query("UPDATE community_media_assets SET state='deleting',lease_id=NULL,lease_until=NULL WHERE id=$1",[row.id]);
          return true;
        });
        if(!claimed)continue;
        // Intent commits before removing bytes, so a crash is resumed on the next pass.
        await this.store.remove(row.id);
        await connection.query("UPDATE community_media_assets SET state='deleted',reserved_bytes=0,stored_bytes=0 WHERE id=$1 AND state='deleting'",[row.id]);removed++;
      }
      await this.runner.prune?.();
      return removed;
    } finally {
      if(locked)await connection.query("SELECT pg_advisory_unlock(hashtextextended('community-media-gc',0))").catch(()=>{});
      connection.release();
    }
  }
}
