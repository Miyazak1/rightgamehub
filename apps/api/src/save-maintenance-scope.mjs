import {GameSaveError} from './game-save-service.mjs';

// Callers hold capacity, policies, then this usage row in that order.
export async function maintainSaveScope(tx,repository,usage,{mode='cleanup',now=new Date(),strict=false,checkBudget=()=>{}}={}){
  const scope={userId:usage.user_id,workId:usage.work_id,channel:usage.channel},key=[scope.userId,scope.workId,scope.channel];
  const query=async(sql,args)=>{checkBudget();const result=await tx.query(sql,args);checkBudget();return result;};
  const count=async()=> (await query(
    `SELECT count(*) FILTER(WHERE NOT r.tombstone)::int live_slots,
      COALESCE(sum(r.stored_bytes) FILTER(WHERE NOT r.tombstone),0)::text live_bytes,
      count(*) FILTER(WHERE NOT r.tombstone AND p.revision_id IS NULL)::int missing_current,
      (SELECT COALESCE(sum(octet_length(b.payload_inline)),0)::text FROM game_save_slots h
       JOIN game_save_revisions v ON v.slot_id=h.id JOIN game_save_payloads b ON b.revision_id=v.id
       WHERE h.user_id=$1 AND h.work_id=$2 AND h.channel=$3 AND v.id<>h.current_revision_id) history_bytes
      FROM game_save_slots s JOIN game_save_revisions r ON r.id=s.current_revision_id
      LEFT JOIN game_save_payloads p ON p.revision_id=r.id WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3`,key)).rows[0];
  const before=await count(),mismatch=before.live_slots!==usage.live_slots||before.live_bytes!==String(usage.live_bytes)||before.history_bytes!==String(usage.history_bytes);
  const sample=(await query(
    `SELECT count(*)::int sampled,count(*) FILTER(WHERE octet_length(payload_inline)<>stored_bytes OR encode(sha256(payload_inline),'hex')<>payload_sha256)::int invalid
    FROM (SELECT p.payload_inline,r.stored_bytes,r.payload_sha256 FROM game_save_slots s JOIN game_save_revisions r ON r.slot_id=s.id
    JOIN game_save_payloads p ON p.revision_id=r.id WHERE s.user_id=$1 AND s.work_id=$2 AND s.channel=$3 ORDER BY r.created_at DESC,r.id LIMIT 10) sampled`,key)).rows[0];
  const result={mismatchScopes:Number(mismatch),repairedScopes:0,purgedPayloads:0,sampledPayloads:sample.sampled,invalidPayloads:sample.invalid,missingCurrentPayloads:before.missing_current};
  if(strict&&(sample.invalid||before.missing_current))return {...result,integrityError:true};
  if(mode==='cleanup'){checkBudget();result.purgedPayloads=(await repository.trimHistory(tx,scope,now)).purgedPayloads;checkBudget();}
  const actual=mode==='cleanup'?await count():before;
  if(mode!=='inspect'){
    if(actual.live_slots>10||BigInt(actual.live_bytes)>1048576n||BigInt(actual.history_bytes)>5242880n)throw new GameSaveError('SAVE_RECONCILE_UNSAFE',409,'Usage exceeds hard limits; investigate before repair.');
    await query('UPDATE game_save_usage SET live_slots=$4,live_bytes=$5,history_bytes=$6,version=version+1,reconciled_at=$7 WHERE user_id=$1 AND work_id=$2 AND channel=$3',[...key,actual.live_slots,actual.live_bytes,actual.history_bytes,now]);
    result.repairedScopes=Number(mismatch);
  }
  return result;
}
