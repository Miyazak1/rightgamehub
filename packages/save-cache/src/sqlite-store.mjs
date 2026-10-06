import {mkdir,chmod,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cacheKey,cacheGroup,cacheScope,serializeRecord,cacheError,CACHE_MAX_BYTES,CACHE_MAX_SLOTS} from './store-contract.mjs';

/** Host-owned application storage. SQLite arbitrates concurrent editor processes. */
export async function createSqliteSaveStore({root}={}) {
  if(!root||!path.isAbsolute(root))throw new TypeError('An absolute host-owned save directory is required.');
  await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink())throw cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','Save directory must not be a symbolic link.');
  if(process.platform!=='win32')await chmod(root,0o700);
  const {DatabaseSync}=await import('node:sqlite');
  const filename=path.join(root,'saves.sqlite');
  const existing=await lstat(filename).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(existing?.isSymbolicLink())throw cacheError('SAVE_LOCAL_STORAGE_UNAVAILABLE','Save database must not be a symbolic link.');
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,group_key TEXT NOT NULL,scope TEXT NOT NULL,version INTEGER NOT NULL,text TEXT NOT NULL,bytes INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
  if(process.platform!=='win32')await chmod(filename,0o600);
  const transaction=fn=>{
    db.exec('BEGIN IMMEDIATE');
    try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  };
  let closed=false;
  return {
    kind:'sqlite',
    async anonymousId(){return transaction(()=>{
      const found=db.prepare("SELECT value FROM meta WHERE key='anonymousId'").get();
      if(found)return found.value;
      const id=randomUUID();db.prepare("INSERT INTO meta VALUES ('anonymousId',?)").run(id);return id;
    });},
    async read(scope){
      const row=db.prepare('SELECT version,text FROM records WHERE key=?').get(cacheKey(scope));
      try{return row?{version:row.version,value:JSON.parse(row.text)}:{version:0,value:null};}
      catch{throw cacheError('SAVE_CACHE_CORRUPT','Local save data is unreadable.');}
    },
    async compareAndSwap(scope,version,value){
      const key=cacheKey(scope),group=cacheGroup(scope),text=serializeRecord(value),bytes=Buffer.byteLength(text);
      return transaction(()=>{
        const old=db.prepare('SELECT version,bytes FROM records WHERE key=?').get(key);
        if((old?.version??0)!==version)return false;
        const used=db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM records').get().bytes;
        const count=db.prepare('SELECT COUNT(*) AS count FROM records WHERE group_key=?').get(group).count;
        if(used-(old?.bytes??0)+bytes>CACHE_MAX_BYTES||!old&&count>=CACHE_MAX_SLOTS)
          throw cacheError('SAVE_LOCAL_QUOTA_EXCEEDED','Local save storage is full. Existing progress was retained.');
        db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,text=excluded.text,bytes=excluded.bytes')
          .run(key,group,JSON.stringify(cacheScope(scope)),version+1,text,bytes);
        return true;
      });
    },
    async list(scope){
      const group=cacheGroup({...scope,namespace:scope.namespace??'default',slot:'autosave'});
      return db.prepare('SELECT scope,version,text FROM records WHERE group_key=?').all(group)
        .map(row=>({scope:JSON.parse(row.scope),version:row.version,value:JSON.parse(row.text)}));
    },
    async close(){if(!closed){closed=true;db.close();}},
  };
}
