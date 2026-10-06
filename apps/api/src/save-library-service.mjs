import crypto from 'node:crypto';
import {saveError,prepareSaveMutation,validateSavePayload} from './game-save-service.mjs';
import {saveMetadata} from './game-save-repository.mjs';
import {deriveGameSessionScope} from './game-session-service.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const checkId=value=>{if(!uuid.test(value??''))saveError('SCHEMA_INVALID',400,'Invalid save ID.');};
const view=row=>({...saveMetadata(row),slotId:row.slot_id,workId:row.work_id,workTitle:row.title,channel:row.channel});
const slotQuery=`SELECT r.*,s.id AS slot_id,s.work_id,s.channel,s.namespace,s.slot_key,w.title
  FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id JOIN works w ON w.id=s.work_id
  WHERE s.user_id=$1`;

// Account-only recovery surface. No game session or iframe bridge exposes these methods.
export function createSaveLibraryService({repository,clock=()=>new Date()}) {
  const perform=(actor,action)=>repository.transaction(async tx=>{
    if(!actor?.userId||!actor.grantId)saveError('AUTH_REQUIRED',401,'Authentication is required.');
    // Take the same grant-first authority locks as game-session writes, then recheck expiry after waiting.
    await tx.query('SELECT id FROM device_grants WHERE id=$1 AND user_id=$2 FOR SHARE',[actor.grantId,actor.userId]);
    await tx.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor.userId]);
    const valid=(await tx.query(`SELECT g.id FROM device_grants g JOIN users u ON u.id=g.user_id
      WHERE g.id=$1 AND g.user_id=$2 AND g.revoked_at IS NULL AND g.expires_at>GREATEST($3::timestamptz,clock_timestamp()) AND u.status='active'`,[actor.grantId,actor.userId,clock()])).rowCount;
    if(!valid)saveError('AUTH_REQUIRED',401,'Authentication is required.');
    const result=await action(tx);
    if(!(await tx.query('SELECT id FROM device_grants WHERE id=$1 AND expires_at>GREATEST($2::timestamptz,clock_timestamp())',[actor.grantId,clock()])).rowCount)
      saveError('AUTH_REQUIRED',401,'Authentication expired during the operation.');
    return result;
  });
  const ownSlot=async(tx,actor,id)=>{
    checkId(id);
    const row=(await tx.query(slotQuery+' AND s.id=$2',[actor.userId,id])).rows[0];
    if(!row)saveError('SAVE_SLOT_NOT_FOUND',404,'Save slot was not found.');
    return row;
  };
  const audit=(tx,actor,slotId,revisionId,action,requestId)=>tx.query(`INSERT INTO game_save_user_events(id,user_id,grant_id,slot_id,revision_id,action,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slot_id,revision_id) WHERE action='restore' DO NOTHING`,
    [crypto.randomUUID(),actor.userId,actor.grantId,slotId,revisionId,action,typeof requestId==='string'&&requestId.length>0&&requestId.length<=200?requestId:crypto.randomUUID()]);
  return Object.freeze({
    list:(actor,{afterSlotId}={})=>perform(actor,async tx=>{
      if(afterSlotId!==undefined)checkId(afterSlotId);
      const rows=(await tx.query(slotQuery+' AND ($2::uuid IS NULL OR s.id>$2) ORDER BY s.id LIMIT 51',[actor.userId,afterSlotId??null])).rows;
      return {items:rows.slice(0,50).map(view),nextAfterSlotId:rows.length>50?rows[49].slot_id:null};
    }),
    history:(actor,{slotId,beforeRevision})=>perform(actor,async tx=>{
      if(beforeRevision!==undefined&&(!/^[1-9][0-9]{0,18}$/u.test(beforeRevision)||BigInt(beforeRevision)>9223372036854775807n))saveError('SCHEMA_INVALID',400,'Invalid history cursor.');
      const row=await ownSlot(tx,actor,slotId);
      const history=await repository.history(tx,{userId:actor.userId,workId:row.work_id,channel:row.channel},
        {namespace:row.namespace,slotKey:row.slot_key,beforeRevision});
      return {slot:view(row),...history};
    }),
    content:(actor,{slotId,revisionId,expectedEtag,requestId})=>perform(actor,async tx=>{
      checkId(slotId);checkId(revisionId);
      // A single MVCC statement binds owner, immutable revision and retained bytes.
      const row=(await tx.query(`SELECT r.*,s.namespace,s.slot_key,p.payload_inline FROM game_save_slots s
        JOIN game_save_revisions r ON r.slot_id=s.id LEFT JOIN game_save_payloads p ON p.revision_id=r.id
        WHERE s.user_id=$1 AND s.id=$2 AND r.id=$3`,[actor.userId,slotId,revisionId])).rows[0];
      if(!row)saveError('SAVE_SLOT_NOT_FOUND',404,'Save revision was not found.');
      if(!row.payload_inline||row.tombstone)saveError('SAVE_HISTORY_UNAVAILABLE',410,'This history payload is no longer retained.');
      if(expectedEtag!==undefined&&expectedEtag!==row.etag)saveError('SAVE_CONFLICT',412,'Save revision does not match.');
      validateSavePayload(row.payload_inline,row.content_type,row.payload_sha256);
      await audit(tx,actor,slotId,revisionId,'export',requestId);
      return {metadata:saveMetadata(row),bytes:row.payload_inline};
    }),
    restore:(actor,input)=>perform(actor,async tx=>{
      const row=await ownSlot(tx,actor,input.slotId);
      const command=prepareSaveMutation({...input,workId:row.work_id,namespace:row.namespace,slotKey:row.slot_key},'restore');
      // Follow the current published target for the slot's last release; never accept client-supplied approval or schema ranges.
      const release=(await tx.query(`SELECT r.*,w.owner_user_id,w.state AS work_state,w.visibility,t.state AS target_state
        FROM releases saved JOIN work_targets t ON t.work_id=saved.work_id AND t.target_key=saved.target_key
        JOIN releases r ON r.id=t.current_release_id AND r.work_id=t.work_id AND r.target_key=t.target_key
        JOIN works w ON w.id=t.work_id WHERE saved.id=$1 AND w.id=$2 FOR SHARE OF r,w,t`,[row.release_id,row.work_id])).rows[0];
      const approved=release?(await tx.query('SELECT namespaces,status AS scope_status FROM game_release_service_scopes WHERE release_id=$1 AND channel=$2 FOR SHARE',[release.id,row.channel])).rows[0]:null;
      const scope=deriveGameSessionScope({...release,...approved});
      const now=clock();
      const allowed=release&&release.validation_state==='ready'&&release.serving_state==='enabled'
        &&(!release.retire_after||new Date(release.retire_after)>now)&&!['withdrawn','suspended'].includes(release.work_state)
        &&(row.channel==='production'?release.work_state==='published'&&release.visibility==='public'&&release.target_state==='published':release.owner_user_id===actor.userId)
        &&scope.capabilities.includes('cloudSave')&&Object.hasOwn(scope.namespaces,row.namespace);
      if(!allowed)saveError('SAVE_RESTORE_NOT_ALLOWED',403,'The current release is not approved for restoring this save.');
      const result=await repository.mutate(tx,{...scope,userId:actor.userId,workId:row.work_id,channel:row.channel,releaseId:release.id},command,now);
      if(!(await tx.query('SELECT id FROM releases WHERE id=$1 AND (retire_after IS NULL OR retire_after>GREATEST($2::timestamptz,clock_timestamp()))',[release.id,clock()])).rowCount)
        saveError('SAVE_RESTORE_NOT_ALLOWED',403,'The release expired during restore.');
      await audit(tx,actor,row.slot_id,result.revisionId,'restore',input.requestId);
      return result;
    }),
  });
}
