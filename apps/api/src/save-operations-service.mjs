import {maintainSaveScope} from './save-maintenance-scope.mjs';
import {storageAdmission} from './save-storage-protection.mjs';
import crypto from 'node:crypto';
import {saveError,saveHash,GameSaveError} from './game-save-service.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const checkId=value=>{if(!uuid.test(value??''))saveError('SCHEMA_INVALID',400,'Invalid identifier.');};
const checkVersion=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/u.test(value)||BigInt(value)>9223372036854775807n)saveError('SCHEMA_INVALID',400,'Invalid control version.');};
const capacityView=r=>({retainedBytes:String(r.retained_bytes),maxPayloadBytes:String(r.max_payload_bytes),writesPaused:r.writes_paused,version:String(r.version)});
const policyView=p=>({id:p.id,workId:p.work_id,namespace:p.namespace,status:p.status,writesPaused:p.writes_paused,version:String(p.control_version),schemaMin:p.schema_min,schemaMax:p.schema_max,maxSlots:p.max_slots,maxDocumentBytes:p.max_document_bytes,maxLiveBytes:p.max_live_bytes,maxHistoryBytes:p.max_history_bytes,historyVersions:p.history_versions,historyDays:p.history_days});
const trafficView=rows=>{
  const groups=new Map();
  for(const row of rows){
    const key=row.channel+':'+row.operation;
    const group=groups.get(key)??{channel:row.channel,operation:row.operation,requests:0,successes:0,errors:new Map(),buckets:new Map()};
    const count=Number(row.count);group.requests+=count;
    if(row.code==='OK')group.successes+=count;else group.errors.set(row.code,(group.errors.get(row.code)??0)+count);
    group.buckets.set(row.latency_bucket,(group.buckets.get(row.latency_bucket)??0)+count);groups.set(key,group);
  }
  return [...groups.values()].map(g=>{
    const percentile=p=>{let n=0;for(const [bound,count] of [...g.buckets].sort((a,b)=>a[0]-b[0])){n+=count;if(n>=Math.ceil(g.requests*p))return bound===60001?null:bound;}return null;};
    return {channel:g.channel,operation:g.operation,requests:g.requests,successes:g.successes,errors:[...g.errors].map(([code,count])=>({code,count})),p50MsUpperBound:percentile(.5),p95MsUpperBound:percentile(.95),p99MsUpperBound:percentile(.99)};
  });
};

export function createSaveOperationsService({repository,metrics,clock=()=>new Date()}) {
  const perform=(actor,admin,action)=>repository.transaction(async tx=>{
    if(!actor?.userId||!actor.grantId)saveError('AUTH_REQUIRED',401,'Authentication is required.');
    await tx.query('SELECT id FROM device_grants WHERE id=$1 AND user_id=$2 FOR SHARE',[actor.grantId,actor.userId]);
    await tx.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actor.userId]);
    const authority=(await tx.query(
      "SELECT u.role,u.can_publish,g.scopes FROM device_grants g JOIN users u ON u.id=g.user_id WHERE g.id=$1 AND g.user_id=$2 AND g.revoked_at IS NULL AND g.expires_at>GREATEST($3::timestamptz,clock_timestamp()) AND u.status='active'",
      [actor.grantId,actor.userId,clock()])).rows[0];
    if(!authority)saveError('AUTH_REQUIRED',401,'Authentication is required.');
    if(admin?authority.role!=='admin':!authority.can_publish||!authority.scopes.includes('works:read'))saveError('FORBIDDEN',403,'Save operations access is not granted.');
    const result=await action(tx);
    if(!(await tx.query('SELECT id FROM device_grants WHERE id=$1 AND expires_at>GREATEST($2::timestamptz,clock_timestamp())',[actor.grantId,clock()])).rowCount)
      saveError('AUTH_REQUIRED',401,'Authentication expired during the operation.');
    return result;
  });
  const change=(actor,input,action,workId,execute)=>{
    checkId(input.operationId);
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)saveError('SCHEMA_INVALID',400,'An operation reason is required.');
    // Fixed field order at each caller; requestId is tracing, not semantic input.
    const digest=saveHash(JSON.stringify([action,workId,input.semantic,input.reason.trim()]));
    return perform(actor,true,async tx=>{
      const capacity=(await tx.query('SELECT * FROM game_save_capacity WHERE singleton FOR UPDATE')).rows[0];
      if(!capacity)saveError('SAVE_STORAGE_UNAVAILABLE',503,'Save capacity state is unavailable.');
      const prior=(await tx.query('SELECT request_digest,result FROM game_save_admin_events WHERE actor_user_id=$1 AND operation_id=$2',[actor.userId,input.operationId])).rows[0];
      if(prior){if(!prior.request_digest.equals(digest))saveError('SAVE_IDEMPOTENCY_MISMATCH',409,'Operation ID was used for another request.');return prior.result;}
      let beforeState=action==='capacity'?capacityView(capacity):['inspect','repair','cleanup'].includes(action)?{after:input.after??null}:{};
      const result=await execute(tx,capacity,state=>{beforeState=state;});
      await tx.query('INSERT INTO game_save_admin_events(id,actor_user_id,grant_id,operation_id,request_digest,action,work_id,reason,request_id,before_state,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [crypto.randomUUID(),actor.userId,actor.grantId,input.operationId,digest,action,workId??result.workId??null,input.reason.trim(),typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=200?input.requestId:crypto.randomUUID(),JSON.stringify(beforeState),JSON.stringify(result)]);
      return result;
    });
  };
  return Object.freeze({
    health:(actor,{admin=false,afterWorkId}={})=>{
      if(afterWorkId!==undefined)checkId(afterWorkId);
      return perform(actor,admin,async tx=>{
        const works=(await tx.query('SELECT w.id,w.title FROM works w WHERE ($1::boolean OR w.owner_user_id=$2) AND ($3::uuid IS NULL OR w.id>$3) AND EXISTS(SELECT 1 FROM game_save_policies p WHERE p.work_id=w.id) ORDER BY w.id LIMIT 51',[admin,actor.userId,afterWorkId??null])).rows;
        const page=works.slice(0,50),ids=page.map(w=>w.id);
        const policies=(await tx.query('SELECT * FROM game_save_policies WHERE work_id=ANY($1::uuid[]) ORDER BY namespace',[ids])).rows;
        const usage=(await tx.query('SELECT work_id,channel,sum(live_slots)::text live_slots,sum(live_bytes)::text live_bytes,sum(history_bytes)::text history_bytes,min(reconciled_at) reconciled_at,bool_and(reconciled_at IS NOT NULL) reconciled FROM game_save_usage WHERE work_id=ANY($1::uuid[]) GROUP BY work_id,channel',[ids])).rows;
        const traffic=(await tx.query("SELECT work_id,channel,operation,code,latency_bucket,sum(count)::text count FROM game_save_health_buckets WHERE work_id=ANY($1::uuid[]) AND hour>=date_trunc('hour',$2::timestamptz)-interval '23 hours' GROUP BY work_id,channel,operation,code,latency_bucket",[ids,clock()])).rows;
        return {items:page.map(w=>({workId:w.id,title:w.title,policies:policies.filter(p=>p.work_id===w.id).map(policyView),usage:usage.filter(u=>u.work_id===w.id).map(u=>({channel:u.channel,liveSlots:Number(u.live_slots),liveBytes:u.live_bytes,historyBytes:u.history_bytes,lastReconciledAt:u.reconciled&&u.reconciled_at?new Date(u.reconciled_at).toISOString():null})),traffic:trafficView(traffic.filter(r=>r.work_id===w.id))})),nextAfterWorkId:works.length>50?page.at(-1).id:null,windowHours:24};
      });
    },
    capacity:actor=>perform(actor,true,async tx=>{
      const row=(await tx.query('SELECT * FROM game_save_capacity WHERE singleton')).rows[0];
      if(!row)saveError('SAVE_STORAGE_UNAVAILABLE',503,'Save capacity state is unavailable.');
      const size=(await tx.query("SELECT pg_database_size(current_database())::text database_bytes,(SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'game_save_%') save_table_bytes")).rows[0];
      const sample=(await tx.query('SELECT *,clock_timestamp() checked_at,(SELECT system_identifier::text FROM pg_control_system()) actual_cluster_id,(SELECT storage_write_bytes FROM game_save_capacity WHERE singleton) current_write_bytes FROM game_save_storage_status WHERE singleton')).rows[0];
      const maintenance=(await tx.query('SELECT * FROM game_save_maintenance_status WHERE singleton')).rows[0];
      const errorScopes=(await tx.query('SELECT count(*)::int count FROM game_save_usage WHERE maintenance_last_code IS NOT NULL')).rows[0].count;
      const storage=storageAdmission(repository.storageProtection,sample,sample?.current_write_bytes??row.storage_write_bytes,{now:sample?.checked_at??clock()});
      return {...capacityView(row),databaseBytes:size.database_bytes,saveTableBytes:size.save_table_bytes,diskFreeBytes:sample?String(sample.available_bytes):null,
        storage:{...storage,totalBytes:sample?String(sample.total_bytes):null,walBytes:sample?String(sample.wal_bytes):null},
        maintenance:maintenance?{lastTickAt:new Date(maintenance.last_tick_at).toISOString(),lastRunAt:maintenance.last_run_at?new Date(maintenance.last_run_at).toISOString():null,status:maintenance.status,code:maintenance.code,errorScopes}:null,
        telemetryDropped:metrics?.status().dropped??0};
    }),
    pausePolicy:(actor,input)=>{
      checkId(input.policyId);checkVersion(input.expectedVersion);
      if(typeof input.writesPaused!=='boolean')saveError('SCHEMA_INVALID',400,'Invalid pause state.');
      return change(actor,{...input,semantic:[input.policyId,input.expectedVersion,input.writesPaused]},'policy_pause',null,async(tx,_capacity,captureBefore)=>{
        const p=(await tx.query('SELECT * FROM game_save_policies WHERE id=$1 FOR UPDATE',[input.policyId])).rows[0];
        if(!p)saveError('SAVE_POLICY_NOT_ACTIVE',404,'Save policy was not found.');
        if(String(p.control_version)!==input.expectedVersion)saveError('SAVE_CONTROL_CONFLICT',409,'Policy changed; refresh before applying.');
        captureBefore(policyView(p));
        const row=(await tx.query('UPDATE game_save_policies SET writes_paused=$2,approved_by=$3,reason=$4 WHERE id=$1 RETURNING *',[input.policyId,input.writesPaused,actor.userId,input.reason.trim()])).rows[0];
        return policyView(row);
      });
    },
    setCapacity:(actor,input)=>{
      checkVersion(input.expectedVersion);
      if(typeof input.writesPaused!=='boolean'||!Number.isSafeInteger(input.maxPayloadBytes)||input.maxPayloadBytes<1||input.maxPayloadBytes>5368709120)saveError('SCHEMA_INVALID',400,'Invalid retained payload limit.');
      return change(actor,{...input,semantic:[input.expectedVersion,input.writesPaused,input.maxPayloadBytes]},'capacity',null,async(tx,capacity)=>{
        if(String(capacity.version)!==input.expectedVersion)saveError('SAVE_CONTROL_CONFLICT',409,'Capacity policy changed; refresh before applying.');
        return capacityView((await tx.query('UPDATE game_save_capacity SET writes_paused=$1,max_payload_bytes=$2,version=version+1 WHERE singleton RETURNING *',[input.writesPaused,input.maxPayloadBytes])).rows[0]);
      });
    },
    maintain:(actor,input)=>{
      checkId(input.workId);
      if(!['inspect','repair','cleanup'].includes(input.mode))saveError('SCHEMA_INVALID',400,'Invalid maintenance mode.');
      if(input.after){checkId(input.after.userId);if(!['production','preview'].includes(input.after.channel))saveError('SCHEMA_INVALID',400,'Invalid maintenance cursor.');}
      return change(actor,{...input,semantic:[input.mode,input.after?[input.after.userId,input.after.channel]:null]},input.mode,input.workId,async(tx,capacity)=>{
        // The admission lock excludes all save writers; lock policies before usage just as writers do.
        if(!(await tx.query('SELECT id FROM works WHERE id=$1',[input.workId])).rowCount)saveError('WORK_NOT_FOUND',404,'Work was not found.');
        await tx.query('SELECT id FROM game_save_policies WHERE work_id=$1 ORDER BY id FOR SHARE',[input.workId]);
        const rows=(await tx.query('SELECT * FROM game_save_usage WHERE work_id=$1 AND ($2::uuid IS NULL OR (user_id,channel)>($2::uuid,$3::text)) ORDER BY user_id,channel LIMIT 6 FOR UPDATE',[input.workId,input.after?.userId??null,input.after?.channel??null])).rows;
        const scopes=rows.slice(0,5);let mismatchScopes=0,repairedScopes=0,purgedPayloads=0,sampledPayloads=0,invalidPayloads=0,missingCurrentPayloads=0;
        for(const usage of scopes){
          const r=await maintainSaveScope(tx,repository,usage,{mode:input.mode,now:clock()});
          mismatchScopes+=r.mismatchScopes;repairedScopes+=r.repairedScopes;purgedPayloads+=r.purgedPayloads;
          sampledPayloads+=r.sampledPayloads;invalidPayloads+=r.invalidPayloads;missingCurrentPayloads+=r.missingCurrentPayloads;
        }
        // Capacity is independently maintained by payload triggers; don't scan every payload in a bounded work batch.
        return {scopes:scopes.length,mismatchScopes,repairedScopes,purgedPayloads,sampledPayloads,invalidPayloads,missingCurrentPayloads,next:rows.length>5?{userId:scopes.at(-1).user_id,channel:scopes.at(-1).channel}:null};
      });
    },
    audit:actor=>perform(actor,true,async tx=>({items:(await tx.query('SELECT id,actor_user_id,action,work_id,reason,request_id,before_state,result,created_at FROM game_save_admin_events ORDER BY created_at DESC,id LIMIT 50')).rows.map(r=>({id:r.id,actorUserId:r.actor_user_id,action:r.action,workId:r.work_id,reason:r.reason,requestId:r.request_id,beforeState:r.before_state,result:r.result,createdAt:new Date(r.created_at).toISOString()}))})),
  });
}
