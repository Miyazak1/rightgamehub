import crypto from 'node:crypto';
import {withTransaction} from './database.mjs';
import {maintainSaveScope} from './save-maintenance-scope.mjs';

export function createSaveMaintenanceWorker({repository,workerId=crypto.randomUUID(),budgetMs=1000}){
  const pool=repository.pool;let running=false;
  const transaction=action=>withTransaction(pool,async tx=>{
    await tx.query("SET LOCAL lock_timeout='100ms'");
    await tx.query("SET LOCAL statement_timeout='250ms'");
    await tx.query("SET LOCAL idle_in_transaction_session_timeout='2s'");
    return action(tx);
  });
  const heartbeat=(tx,status,code,ran=false)=>tx.query(
    `INSERT INTO game_save_maintenance_status(singleton,last_tick_at,last_run_at,status,code)
    VALUES(true,clock_timestamp(),CASE WHEN $3 THEN clock_timestamp() END,$1,$2)
    ON CONFLICT(singleton) DO UPDATE SET last_tick_at=EXCLUDED.last_tick_at,
    last_run_at=COALESCE(EXCLUDED.last_run_at,game_save_maintenance_status.last_run_at),status=EXCLUDED.status,code=EXCLUDED.code`,[status,code,ran]);
  const record=async(tx,usage,id,status,code,result)=>{
    const key=[usage.user_id,usage.work_id,usage.channel];
    await tx.query(
      'INSERT INTO game_save_maintenance_runs(id,worker_id,user_id,work_id,channel,status,code,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [id,workerId,...key,status,code,JSON.stringify(result)]);
    await tx.query(
      `UPDATE game_save_usage SET maintenance_next_at=clock_timestamp()+CASE WHEN $4='ok' THEN interval '6 hours' ELSE interval '15 minutes' END,
      maintenance_last_code=CASE WHEN $4='ok' THEN NULL ELSE $5 END WHERE user_id=$1 AND work_id=$2 AND channel=$3`,[...key,status,code]);
    await heartbeat(tx,status,code,true);
  };
  return {async runOnce(){
    if(running)return {status:'busy',code:'LOCAL_BUSY'};
    running=true;let selected;const id=crypto.randomUUID();
    try{
      return await transaction(async tx=>{
        // NOWAIT yields to live saves; all mutators share this lock order.
        await tx.query('SELECT singleton FROM game_save_capacity WHERE singleton FOR UPDATE NOWAIT');
        const started=performance.now(),checkBudget=()=>{if(performance.now()-started>budgetMs)throw Object.assign(new Error('maintenance budget exceeded'),{code:'SAVE_MAINTENANCE_BUDGET'});};
        selected=(await tx.query('SELECT *,maintenance_next_at::text due_text FROM game_save_usage WHERE maintenance_next_at<=clock_timestamp() ORDER BY maintenance_next_at,user_id,work_id,channel LIMIT 1')).rows[0];
        if(!selected){await heartbeat(tx,'idle','NO_DUE_SCOPE');return {status:'idle',code:'NO_DUE_SCOPE'};}
        await tx.query('SELECT id FROM game_save_policies WHERE work_id=$1 ORDER BY id FOR SHARE',[selected.work_id]);
        const usage=(await tx.query('SELECT * FROM game_save_usage WHERE user_id=$1 AND work_id=$2 AND channel=$3 FOR UPDATE',[selected.user_id,selected.work_id,selected.channel])).rows[0];
        const result=await maintainSaveScope(tx,repository,usage,{strict:true,checkBudget});
        checkBudget();
        const status=result.integrityError?'error':'ok',code=result.integrityError?'SAVE_INTEGRITY_ALERT':'OK';
        await record(tx,usage,id,status,code,result);
        checkBudget();
        return {status,code,result};
      });
    }catch(error){
      const code=['55P03','57014','40P01','40001'].includes(error.code)?'SAVE_MAINTENANCE_BUSY':
        ['SAVE_RECONCILE_UNSAFE','SAVE_MAINTENANCE_BUDGET'].includes(error.code)?error.code:'SAVE_MAINTENANCE_FAILED';
      // A new transaction records failures only after the work transaction rolled back.
      // A lost COMMIT response is detected by its immutable run ID.
      return await transaction(async tx=>{
        const existing=(await tx.query('SELECT status,code,result FROM game_save_maintenance_runs WHERE id=$1',[id])).rows[0];
        if(existing)return existing;
        if(selected){
          const same=(await tx.query('SELECT * FROM game_save_usage WHERE user_id=$1 AND work_id=$2 AND channel=$3 AND maintenance_next_at=$4 FOR UPDATE NOWAIT',
            [selected.user_id,selected.work_id,selected.channel,selected.due_text])).rows[0];
          if(same){await record(tx,same,id,'error',code,{});return {status:'error',code};}
        }
        await heartbeat(tx,'busy',code);
        return {status:'busy',code};
      }).catch(failure=>{
        // Another worker may own the status/usage row. Never wait or undo its work
        // merely to publish a skipped tick; the next tick retries reporting.
        if(['55P03','57014','40P01','40001'].includes(failure.code))return {status:'busy',code:'SAVE_MAINTENANCE_BUSY'};
        throw failure;
      });
    }finally{running=false;}
  }};
}
