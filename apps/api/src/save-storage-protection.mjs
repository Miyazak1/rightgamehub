import {GameSaveError} from './game-save-service.mjs';

const integer=(env,key,fallback,min,max)=>{
  const raw=env[key]??String(fallback),n=Number(raw);
  if(!/^\d+$/u.test(raw)||!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Invalid '+key);
  return n;
};
export function loadSaveStorageProtection(env={},production=false){
  const required=env.SAVE_STORAGE_REQUIRED??String(production);
  if(!['true','false'].includes(required))throw new Error('Invalid SAVE_STORAGE_REQUIRED');
  if(production&&required!=='true')throw new Error('SAVE_STORAGE_REQUIRED must be true in production');
  return Object.freeze({required:required==='true',
    maxAgeSeconds:integer(env,'SAVE_STORAGE_MAX_AGE_SECONDS',90,15,120),
    minFreeBytes:integer(env,'SAVE_STORAGE_MIN_FREE_BYTES',1073741824,67108864,1099511627776),
    maxUsedPercent:integer(env,'SAVE_STORAGE_MAX_USED_PERCENT',85,50,95),
    minFreeInodePercent:integer(env,'SAVE_STORAGE_MIN_FREE_INODE_PERCENT',5,1,50),
    maxWalBytes:integer(env,'SAVE_STORAGE_MAX_WAL_BYTES',2147483648,67108864,1099511627776)});
}
export const storageWriteCharge=bytes=>BigInt(bytes)*4n+16384n;
export function storageAdmission(config,row,counter,{now=new Date(),charge=0n}={}){
  if(!config.required)return {required:false,allowed:true,code:'DISABLED',observedAt:row?new Date(row.observed_at).toISOString():null};
  let code='OK';
  if(!row)code='PROBE_MISSING';
  else {
    const age=now-new Date(row.observed_at),baseline=BigInt(row.write_baseline),debt=BigInt(counter)-baseline;
    const total=BigInt(row.total_bytes),available=BigInt(row.available_bytes)-debt-charge;
    if(!Number.isFinite(age)||age<0||age>config.maxAgeSeconds*1000)code='PROBE_STALE';
    else if(row.actual_cluster_id!==row.cluster_id)code='PROBE_CLUSTER_MISMATCH';
    else if(debt<0n)code='PROBE_COUNTER_MISMATCH';
    else if(available<BigInt(config.minFreeBytes)||available*100n<total*BigInt(100-config.maxUsedPercent))code='DISK_HEADROOM';
    else if(BigInt(row.available_inodes)*100n<BigInt(row.total_inodes)*BigInt(config.minFreeInodePercent))code='INODE_HEADROOM';
    else if(BigInt(row.wal_bytes)+debt+charge>BigInt(config.maxWalBytes))code='WAL_HEADROOM';
  }
  return {required:true,allowed:code==='OK',code,observedAt:row?new Date(row.observed_at).toISOString():null};
}
export async function reserveSaveStorage(tx,config,capacity,bytes){
  const charge=storageWriteCharge(bytes);
  if(config.required){
    // Capacity is locked. Sampling starts before disk measurement and reads this
    // counter without locking, so a concurrent sample cannot erase new reservations.
    const row=(await tx.query('SELECT *,clock_timestamp() checked_at,(SELECT system_identifier::text FROM pg_control_system()) actual_cluster_id FROM game_save_storage_status WHERE singleton')).rows[0];
    const state=storageAdmission(config,row,capacity.storage_write_bytes,{now:row?.checked_at??new Date(),charge});
    if(!state.allowed)throw new GameSaveError('SAVE_STORAGE_UNAVAILABLE',503,'Cloud save storage protection is closed; keep the local copy.',{storageCode:state.code},true);
  }
  // The payload INSERT trigger commits this reservation with the bytes and receipt.
}
