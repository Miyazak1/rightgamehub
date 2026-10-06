import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { GameSaveError,SAVE_LIMITS,saveError } from './game-save-service.mjs';

const scopeKey=s=>[s.userId,s.workId,s.channel];
export const saveMetadata=row=>({
  slot:row.slot_key,namespace:row.namespace,revisionId:row.id,revision:String(row.revision),
  etag:row.etag,schemaVersion:row.schema_version,contentType:row.content_type,contentEncoding:row.content_encoding,
  sha256:row.payload_sha256,bytes:row.stored_bytes,updatedAt:new Date(row.created_at).toISOString(),
  deleted:row.tombstone,restoredFromRevisionId:row.restored_from_revision_id,
});
const policyView=p=>({namespace:p.namespace,status:p.status,maxSlots:p.max_slots,maxDocumentBytes:p.max_document_bytes,
  maxLiveBytes:p.max_live_bytes,maxHistoryBytes:p.max_history_bytes,historyVersions:p.history_versions,historyDays:p.history_days,
  writesPaused:p.writes_paused,schemaMin:p.schema_min,schemaMax:p.schema_max,contentTypes:p.content_types});
const assertReadable=(scope,namespace,row)=>{
  const read=scope.namespaces[namespace].readSchema;
  if(!row.tombstone&&(row.schema_version<read.min||row.schema_version>read.max))
    saveError('SAVE_RELEASE_INCOMPATIBLE',409,'This release cannot safely read the current save schema.');
};
const currentQuery=`SELECT r.*,s.namespace,s.slot_key FROM game_save_slots s
  JOIN game_save_revisions r ON r.id=s.current_revision_id
  WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND s.namespace=$4 AND s.slot_key=$5`;

export class PostgresGameSaveRepository {
  constructor(pool) {this.pool=pool;}
  async transaction(action) {
    try {
      return await withTransaction(this.pool,async tx=>{
        await tx.query("SET LOCAL lock_timeout='3s'");
        await tx.query("SET LOCAL statement_timeout='10s'");
        return action(tx);
      });
    } catch(error) {
      if(error.code==='P7501')throw new GameSaveError('SAVE_CAPACITY_EXCEEDED',507,'Cloud save capacity is closed; keep the local copy.',{},true);
      if(['55P03','57014','40P01','40001'].includes(error.code))
        throw new GameSaveError('SAVE_STORAGE_UNAVAILABLE',503,'Save storage is busy; retry the same operation.',{},true);
      throw error;
    }
  }
  async getPolicy(tx,scope,namespace) {
    const p=(await tx.query('SELECT * FROM game_save_policies WHERE work_id=$1 AND namespace=$2 FOR SHARE',[scope.workId,namespace])).rows[0];
    if(!p||!['active','retired'].includes(p.status))saveError('SAVE_POLICY_NOT_ACTIVE',409,'Save policy has not been activated.');
    return p;
  }
  async writeReceipt(tx,scope,input) {
    await this.getPolicy(tx,scope,input.namespace);
    const row=(await tx.query(`SELECT o.request_digest,o.result FROM game_save_slots s
      JOIN game_save_operations o ON o.slot_id=s.id
      WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND s.namespace=$4 AND s.slot_key=$5 AND o.idempotency_key_hash=$6`,
      [...scopeKey(scope),input.namespace,input.slotKey,input.keyHash])).rows[0];
    if(!row)return {result:null};
    if(!row.request_digest.equals(input.requestDigest))saveError('SAVE_IDEMPOTENCY_MISMATCH',409,'Idempotency key belongs to a different save request.');
    return {result:row.result};
  }
  async policy(tx,scope,namespace) {return policyView(await this.getPolicy(tx,scope,namespace));}
  async list(tx,scope,namespace) {
    await this.getPolicy(tx,scope,namespace);
    return (await tx.query(`SELECT r.*,s.namespace,s.slot_key FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id
      WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND s.namespace=$4 AND s.deleted_at IS NULL ORDER BY s.slot_key`,
      [...scopeKey(scope),namespace])).rows.map(saveMetadata);
  }
  async read(tx,scope,input,content) {
    await this.getPolicy(tx,scope,input.namespace);
    const query=content?currentQuery.replace('r.*,s.namespace,s.slot_key','r.*,s.namespace,s.slot_key,b.payload_inline')
      .replace('WHERE s.user_id','LEFT JOIN game_save_payloads b ON b.revision_id=r.id WHERE s.user_id'):currentQuery;
    const row=(await tx.query(query,[...scopeKey(scope),input.namespace,input.slotKey])).rows[0];
    if(!row||content&&row.tombstone)saveError('SAVE_SLOT_NOT_FOUND',404,'Save slot was not found.');
    if(!content)return saveMetadata(row);
    if(input.expectedEtag!==undefined&&input.expectedEtag!==row.etag)saveError('SAVE_CONFLICT',412,'Save changed before download.',{expectedEtag:row.etag,currentRevision:String(row.revision),currentUpdatedAt:new Date(row.created_at).toISOString()});
    assertReadable(scope,input.namespace,row);
    // One MVCC statement reads the pointer and bytes together, even if another
    // transaction replaces the save and purges history immediately afterwards.
    if(!row.payload_inline)saveError('SAVE_STORAGE_UNAVAILABLE',503,'Save payload is unavailable.');
    return {metadata:saveMetadata(row),bytes:row.payload_inline};
  }
  async history(tx,scope,input) {
    await this.getPolicy(tx,scope,input.namespace);
    const rows=(await tx.query(`SELECT r.*,s.namespace,s.slot_key,(p.revision_id IS NOT NULL) AS payload_available
      FROM game_save_slots s JOIN game_save_revisions r ON r.slot_id=s.id LEFT JOIN game_save_payloads p ON p.revision_id=r.id
      WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND s.namespace=$4 AND s.slot_key=$5 AND r.revision<$6::bigint
      ORDER BY r.revision DESC LIMIT 51`,[...scopeKey(scope),input.namespace,input.slotKey,input.beforeRevision??'9223372036854775807'])).rows;
    const more=rows.length>50,items=rows.slice(0,50);
    return {items:items.map(r=>({...saveMetadata(r),payloadAvailable:r.payload_available})),nextBeforeRevision:more?String(items.at(-1).revision):null};
  }
  async mutate(tx,scope,input,now) {
    // All save mutations and maintenance take this short global admission lock before policy/usage locks.
    // Receipts are still returned when admission is closed. The trigger accounts exact retained bytes.
    const capacity=(await tx.query('SELECT * FROM game_save_capacity WHERE singleton FOR UPDATE')).rows[0];
    if(!capacity)saveError('SAVE_STORAGE_UNAVAILABLE',503,'Save capacity state is unavailable.');
    const key=scopeKey(scope),p=await this.getPolicy(tx,scope,input.namespace);
    const day=now.toISOString().slice(0,10);
    await tx.query('INSERT INTO game_save_rate_usage(user_id,work_id,day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[scope.userId,scope.workId,day]);
    const rate=(await tx.query('SELECT *,day::text AS utc_day FROM game_save_rate_usage WHERE user_id=$1 AND work_id=$2 FOR UPDATE',[scope.userId,scope.workId])).rows[0];
    await tx.query('INSERT INTO game_save_usage(user_id,work_id,channel) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',key);
    const usage=(await tx.query('SELECT * FROM game_save_usage WHERE user_id=$1 AND work_id=$2 AND channel=$3 FOR UPDATE',key)).rows[0];
    let slot=(await tx.query(`SELECT * FROM game_save_slots WHERE user_id=$1 AND work_id=$2 AND channel=$3 AND namespace=$4 AND slot_key=$5 FOR UPDATE`,
      [...key,input.namespace,input.slotKey])).rows[0];
    if(slot) {
      const receipt=(await tx.query('SELECT request_digest,result FROM game_save_operations WHERE slot_id=$1 AND idempotency_key_hash=$2',[slot.id,input.keyHash])).rows[0];
      if(receipt) {
        if(!receipt.request_digest.equals(input.requestDigest))saveError('SAVE_IDEMPOTENCY_MISMATCH',409,'Idempotency key belongs to a different save request.');
        return receipt.result;
      }
    }
    const current=slot?(await tx.query('SELECT * FROM game_save_revisions WHERE id=$1',[slot.current_revision_id])).rows[0]:null;
    if(input.createOnly?!!slot:!current||current.etag!==input.ifMatch)saveError('SAVE_CONFLICT',412,'Cloud save changed; resolve the conflict before saving.',
      {expectedEtag:current?.etag??null,currentRevision:current?String(current.revision):null,currentUpdatedAt:current?new Date(current.created_at).toISOString():null});
    if(input.kind==='delete'&&current?.tombstone)saveError('SAVE_SLOT_NOT_FOUND',404,'Save slot is already deleted.');
    if(input.kind!=='delete'&&p.status!=='active')saveError('SAVE_POLICY_NOT_ACTIVE',409,'Save policy is retired; existing saves can still be read or deleted.');
    let bytes=input.bytes,schema=input.schemaVersion,contentType=input.contentType,sha=input.payloadHash;
    if(input.kind==='restore') {
      const source=(await tx.query(`SELECT r.*,p.payload_inline FROM game_save_revisions r JOIN game_save_payloads p ON p.revision_id=r.id
        WHERE r.id=$1 AND r.slot_id=$2 AND NOT r.tombstone`,[input.revisionId,slot.id])).rows[0];
      if(!source)saveError('SAVE_HISTORY_UNAVAILABLE',410,'This history payload is no longer retained.');
      bytes=source.payload_inline;schema=source.schema_version;contentType=source.content_type;sha=source.payload_sha256;
    }
    const tombstone=input.kind==='delete';
    if(!tombstone&&p.writes_paused)throw new GameSaveError('SAVE_WRITES_PAUSED',503,'New cloud saves are paused for this game; keep the local copy.',{},true);
    if(!tombstone&&(capacity.writes_paused||BigInt(capacity.retained_bytes)+BigInt(bytes.length)>BigInt(capacity.max_payload_bytes)))
      throw new GameSaveError('SAVE_CAPACITY_EXCEEDED',507,'Cloud save capacity is closed; keep the local copy.',{},true);
    if(!tombstone) {
      if(current)assertReadable(scope,input.namespace,current);
      const approved=scope.namespaces[input.namespace];
      if(schema<p.schema_min||schema>p.schema_max||(input.kind==='write'?schema!==approved.writeSchema:schema<approved.readSchema.min||schema>approved.readSchema.max))
        saveError('SAVE_SCHEMA_UNSUPPORTED',422,'Save schema is outside the approved range.');
      if(!p.content_types.includes(contentType))saveError('SAVE_CONTENT_INVALID',422,'Content type is not permitted by this policy.');
      if(bytes.length>p.max_document_bytes)saveError('SAVE_DOCUMENT_TOO_LARGE',413,'Save document exceeds its policy limit.');
    }
    const length=tombstone?0:bytes.length,oldLive=current&&!current.tombstone?current.stored_bytes:0;
    const deltaSlots=(tombstone?0:1)-(current&&!current.tombstone?1:0);
    const ns=(await tx.query(`SELECT count(*)::int AS slots,COALESCE(sum(r.stored_bytes),0)::int AS bytes
      FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id
      WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND s.namespace=$4 AND NOT r.tombstone`,[...key,input.namespace])).rows[0];
    const liveBytes=Number(usage.live_bytes)-oldLive+length,liveSlots=usage.live_slots+deltaSlots;
    if(!tombstone&&(liveBytes>SAVE_LIMITS.liveBytes||liveSlots>SAVE_LIMITS.slots||ns.bytes-oldLive+length>p.max_live_bytes||ns.slots+deltaSlots>p.max_slots))
      saveError('SAVE_QUOTA_EXCEEDED',409,'Current save storage quota is full.');
    const recent=rate.recent_writes.filter(date=>new Date(date).getTime()>now.getTime()-60000);
    const sameDay=rate.utc_day===day;
    const dayWrites=sameDay?rate.day_writes:0,dayBytes=sameDay?Number(rate.day_bytes):0;
    if(recent.length>=20||!tombstone&&dayWrites>=2000)saveError('SAVE_RATE_LIMITED',429,'Too many save operations; retry later.');
    if(!slot) {
      slot={id:crypto.randomUUID(),revision:'0'};
      await tx.query(`INSERT INTO game_save_slots(id,user_id,work_id,channel,namespace,slot_key,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,[slot.id,...key,input.namespace,input.slotKey,now]);
    }
    const revision=(BigInt(slot.revision)+1n).toString(),id=crypto.randomUUID(),etag='"ghsave-'+crypto.randomBytes(24).toString('base64url')+'"';
    const row=(await tx.query(`INSERT INTO game_save_revisions(id,slot_id,revision,base_revision,etag,schema_version,content_type,payload_sha256,
      stored_bytes,release_id,source_kind,created_at,restored_from_revision_id,tombstone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id,slot.id,revision,slot.revision,etag,tombstone?null:schema,tombstone?null:contentType,tombstone?null:sha,length,scope.releaseId,input.kind,now,input.kind==='restore'?input.revisionId:null,tombstone])).rows[0];
    if(!tombstone)await tx.query('INSERT INTO game_save_payloads(revision_id,payload_inline) VALUES($1,$2)',[id,bytes]);
    await tx.query('UPDATE game_save_slots SET current_revision_id=$2,revision=$3,deleted_at=$4,updated_at=$5 WHERE id=$1',[slot.id,id,revision,tombstone?now:null,now]);
    const history=await this.trimHistory(tx,scope,now);
    await tx.query(`UPDATE game_save_usage SET live_slots=$4,live_bytes=$5,history_bytes=$6,version=version+1
      WHERE user_id=$1 AND work_id=$2 AND channel=$3`,[...key,liveSlots,liveBytes,history.bytes]);
    await tx.query(`UPDATE game_save_rate_usage SET recent_writes=$3,day=$4,day_writes=$5,day_bytes=$6 WHERE user_id=$1 AND work_id=$2`,
      [scope.userId,scope.workId,[...recent,now],day,dayWrites+1,dayBytes+length]);
    const result={...saveMetadata({...row,namespace:input.namespace,slot_key:input.slotKey}),historyDegraded:history.degraded,durability:'cloud'};
    await tx.query(`INSERT INTO game_save_operations(id,slot_id,revision_id,idempotency_key_hash,request_digest,result,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),slot.id,id,input.keyHash,input.requestDigest,JSON.stringify(result),now]);
    return result;
  }
  async trimHistory(tx,scope,now) {
    const rows=(await tx.query(`SELECT r.id,r.stored_bytes,r.created_at,s.namespace,s.deleted_at,p.max_history_bytes,p.history_versions,p.history_days,
      row_number() OVER(PARTITION BY s.id ORDER BY r.revision DESC)::int AS rank
      FROM game_save_slots s JOIN game_save_revisions r ON r.slot_id=s.id JOIN game_save_payloads b ON b.revision_id=r.id
      JOIN game_save_policies p ON p.work_id=s.work_id AND p.namespace=s.namespace
      WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 AND r.id<>s.current_revision_id
      ORDER BY rank ASC,r.created_at DESC,r.id`,scopeKey(scope))).rows;
    // A deleted slot's undo body is ordinary history. Protect the previous
    // version of each live slot before spending budget on deleted slots.
    rows.sort((a,b)=>(a.rank===1&&!a.deleted_at?0:1)-(b.rank===1&&!b.deleted_at?0:1)
      ||new Date(b.created_at)-new Date(a.created_at)||a.id.localeCompare(b.id));
    let total=0,degraded=false;const perNamespace=new Map(),purge=[];
    for(const row of rows) {
      const nsBytes=perNamespace.get(row.namespace)??0;
      const eligible=row.rank<=row.history_versions&&new Date(row.created_at).getTime()>now.getTime()-row.history_days*86400000;
      const fits=total+row.stored_bytes<=SAVE_LIMITS.historyBytes&&nsBytes+row.stored_bytes<=row.max_history_bytes;
      if(eligible&&fits){total+=row.stored_bytes;perNamespace.set(row.namespace,nsBytes+row.stored_bytes);}
      else{purge.push(row.id);if(row.rank===1||eligible&&!fits)degraded=true;}
    }
    if(purge.length)await tx.query('DELETE FROM game_save_payloads WHERE revision_id=ANY($1::uuid[])',[purge]);
    return {bytes:total,degraded,purgedPayloads:purge.length};
  }
}
