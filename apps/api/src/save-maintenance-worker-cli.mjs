import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {PostgresGameSaveRepository} from './game-save-repository.mjs';
import {createSaveMaintenanceWorker} from './save-maintenance-worker.mjs';

if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:3000,
  idleTimeoutMillis:10000,application_name:'gamehub-save-maintenance',
  ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
const worker=createSaveMaintenanceWorker({repository:new PostgresGameSaveRepository(pool)});
const abort=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>abort.abort());
try{
  if(process.argv.includes('--health')){
    const r=await pool.query({text:"SELECT last_tick_at>clock_timestamp()-interval '120 seconds' AS healthy FROM game_save_maintenance_status WHERE singleton",query_timeout:3000});
    process.exitCode=r.rows[0]?.healthy?0:1;
  }else while(!abort.signal.aborted){
    try{const r=await worker.runOnce();process.stdout.write(JSON.stringify({event:'save_maintenance',status:r.status,code:r.code})+'\n');}
    catch{process.stderr.write('{"event":"save_maintenance","status":"error","code":"DATABASE_UNAVAILABLE"}\n');}
    try{await delay(30000,undefined,{signal:abort.signal});}catch{}
  }
}finally{await pool.end();}
