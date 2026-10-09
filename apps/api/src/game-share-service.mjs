import crypto from 'node:crypto';
import { SHARE_CODE_PATTERN, validateShare } from '../../../packages/web-game-sdk/src/sharing-protocol.mjs';
export class GameShareError extends Error {
  constructor(code,statusCode,message,retryable=false) { super(message); Object.assign(this,{code,statusCode,retryable}); }
}
const unavailable=()=>{throw new GameShareError('SHARE_UNAVAILABLE',404,'分享已过期、撤销，或对应游戏版本不可用。');};
const hash=code=>crypto.createHash('sha256').update(code).digest();
const codeHash=code=>{if(typeof code!=='string'||!SHARE_CODE_PATTERN.test(code))unavailable();return hash(code);};
export function createGameShareService({pool,gameSessionService,siteOrigin='https://mooyu.fun',logger=console}) {
  const origin=new URL(siteOrigin);
  if(origin.origin!==siteOrigin || !['https:','http:'].includes(origin.protocol) || (origin.protocol==='http:'&&!['localhost','127.0.0.1'].includes(origin.hostname)))throw new TypeError('Invalid game share site origin.');
  let timer=null,maintenance=null;
  const cleanup=()=>maintenance??=(async()=>{
    await pool.query("DELETE FROM game_share_links WHERE code_hash IN (SELECT code_hash FROM game_share_links WHERE expires_at<=clock_timestamp() OR revoked_at<clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 500)");
    await pool.query("DELETE FROM game_share_events WHERE id IN (SELECT id FROM game_share_events WHERE created_at<clock_timestamp()-interval '90 days' ORDER BY created_at LIMIT 500)");
  })().finally(()=>{maintenance=null;});
  const transaction=async action=>{const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query("SET LOCAL statement_timeout='5s'");const result=await action(tx);await tx.query('COMMIT');return result;}catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}};
  return Object.freeze({
    cleanup,
    start(){if(timer)return;timer=setInterval(()=>{cleanup().catch(()=>logger.warn?.('Game share cleanup failed'));},60000);timer.unref?.();},
    async stop(){clearInterval(timer);timer=null;await maintenance?.catch(()=>{});},
    async create(actor,token,input){
      if(!actor?.userId||!actor.grantId)throw new GameShareError('AUTH_REQUIRED',401,'请登录后创建分享。');
      let safe;try{safe=validateShare(input);}catch(error){throw new GameShareError(error.code,400,error.message);}
      return transaction(async tx=>{
        // Serialize admission before session locks; quotas remain correct across API processes.
        await tx.query("SELECT pg_advisory_xact_lock(55155001)");
        const scope=await gameSessionService.resolve(actor,token,{capability:'shareLinks',channel:'production'},tx);
        const counts=(await tx.query("SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp())::int active,count(*) FILTER(WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 day')::int daily,count(*) FILTER(WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 minute')::int recent FROM game_share_links",[scope.userId])).rows[0];
        if(counts.total>=10000||counts.active>=100||counts.daily>=20||counts.recent>=5)throw new GameShareError('SHARE_QUOTA_EXCEEDED',429,'分享额度已用完，请稍后重试。',true);
        const code=crypto.randomBytes(24).toString('base64url');
        const row=(await tx.query("INSERT INTO game_share_links(code_hash,user_id,work_id,release_id,title,payload,work_generation,target_generation,release_generation,created_at,expires_at) SELECT $1,$2,w.id,r.id,$5,$6,w.game_session_generation,t.game_session_generation,r.game_session_generation,now(),now()+interval '30 days' FROM releases r JOIN works w ON w.id=r.work_id JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key WHERE w.id=$3 AND r.id=$4 RETURNING expires_at",[hash(code),scope.userId,scope.workId,scope.releaseId,safe.title,JSON.stringify(safe.payload)])).rows[0];
        await tx.query("INSERT INTO game_share_events(code_hash,user_id,work_id,release_id,action) VALUES($1,$2,$3,$4,'created')",[hash(code),scope.userId,scope.workId,scope.releaseId]);
        return {code,url:siteOrigin+'/#/s/'+code,expiresAt:row.expires_at.toISOString()};
      });
    },
    async get(code){
      const row=(await pool.query("SELECT s.title,s.payload,s.work_id,s.release_id,s.expires_at FROM game_share_links s JOIN releases r ON r.id=s.release_id AND r.work_id=s.work_id JOIN works w ON w.id=s.work_id JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key JOIN users u ON u.id=s.user_id JOIN users owner ON owner.id=w.owner_user_id WHERE s.code_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.status='active' AND owner.status='active' AND w.state='published' AND w.visibility='public' AND t.state='published' AND r.target_key='web' AND r.validation_state='ready' AND r.serving_state='enabled' AND (r.retire_after IS NULL OR r.retire_after>clock_timestamp()) AND r.approved_capabilities ? 'shareLinks' AND s.work_generation=w.game_session_generation AND s.target_generation=t.game_session_generation AND s.release_generation=r.game_session_generation",[codeHash(code)])).rows[0];
      if(!row)unavailable();
      return {code,title:row.title,payload:row.payload,workId:row.work_id,releaseId:row.release_id,expiresAt:row.expires_at.toISOString()};
    },
    async revoke(actor,code){
      if(!actor?.userId)throw new GameShareError('AUTH_REQUIRED',401,'请先登录。');
      return transaction(async tx=>{
        const row=(await tx.query('UPDATE game_share_links SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE code_hash=$1 AND user_id=$2 RETURNING *',[codeHash(code),actor.userId])).rows[0];
        if(!row)unavailable();
        await tx.query("INSERT INTO game_share_events(code_hash,user_id,work_id,release_id,action) VALUES($1,$2,$3,$4,'revoked') ON CONFLICT DO NOTHING",[row.code_hash,row.user_id,row.work_id,row.release_id]);
        return {revoked:true};
      });
    },
  });
}
