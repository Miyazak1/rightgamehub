import crypto from 'node:crypto';
import {AgentAccountError} from './agent-account-repository.mjs';
import {accountAvatarView,avatarColumns} from './account-avatar-view.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const fail=code=>{throw new AgentAccountError(code);};
const digest=body=>crypto.createHash('sha256').update(body).digest();

export class PostgresAgentAvatarRepository {
  constructor(pool,store){this.pool=pool;this.store=store;}
  async authorize(operator,id,client=this.pool,lock=false){
    const row=(await client.query(`SELECT a.user_id FROM agent_accounts a
      JOIN users target ON target.id=a.user_id AND target.account_type='agent'
      JOIN users operator ON operator.id=a.operator_user_id AND operator.account_type='human'
        AND operator.role='admin' AND operator.status='active'
      WHERE a.user_id=$1 AND a.operator_user_id=$2 ${lock?'FOR UPDATE OF a,target FOR SHARE OF operator':''}`,[id,operator])).rows[0];
    if(!row)fail('AGENT_NOT_FOUND');
  }
  async view(client,id){
    const row=(await client.query(`SELECT ${avatarColumns('a','agent')} FROM user_avatars a WHERE user_id=$1`,[id])).rows[0];
    return accountAvatarView(row??{agent_preset_key:'xiaomoyu'},id,'agent');
  }
  async replace(operator,id,image){
    const client=await this.pool.connect(),key='agent-avatar:'+id,created=[];
    let locked=false,destroy=false;
    // This lock covers storage writes, commit and cleanup, including identical
    // content uploads. Every agent-avatar writer follows this same protocol.
    const cleanup=async candidates=>{
      if(!this.store)return;
      let current;
      try{current=(await client.query('SELECT body_key,poster_key FROM user_avatars WHERE user_id=$1',[id])).rows[0];}
      catch{return;} // Unknown commit: retain objects until a later safe cleanup.
      const live=new Set([current?.body_key,current?.poster_key]);
      for(const object of new Set(candidates.filter(Boolean)))if(!live.has(object))await this.store.remove(object).catch(()=>{});
    };
    try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='10s'");
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[key]);locked=true;
      await this.authorize(operator,id,client,true);
      const previous=(await client.query('SELECT * FROM user_avatars WHERE user_id=$1 FOR UPDATE',[id])).rows[0];
      let bodyKey=null,posterKey=null;
      if(image&&this.store){
        bodyKey=await this.store.put({userId:id,variant:'animated',body:image.body,sha256:image.sha256});created.push(bodyKey);
        posterKey=await this.store.put({userId:id,variant:'static',body:image.posterBody,sha256:image.posterSha256});created.push(posterKey);
      }
      await client.query(`INSERT INTO user_avatars(user_id,kind,preset_key,media_type,body,body_key,sha256,byte_length,
        animated,poster_media_type,poster_body,poster_key,poster_sha256,width,height,frame_count,duration_ms,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,clock_timestamp())
        ON CONFLICT(user_id) DO UPDATE SET kind=EXCLUDED.kind,preset_key=EXCLUDED.preset_key,
        media_type=EXCLUDED.media_type,body=EXCLUDED.body,body_key=EXCLUDED.body_key,sha256=EXCLUDED.sha256,
        byte_length=EXCLUDED.byte_length,animated=EXCLUDED.animated,poster_media_type=EXCLUDED.poster_media_type,
        poster_body=EXCLUDED.poster_body,poster_key=EXCLUDED.poster_key,poster_sha256=EXCLUDED.poster_sha256,
        width=EXCLUDED.width,height=EXCLUDED.height,frame_count=EXCLUDED.frame_count,duration_ms=EXCLUDED.duration_ms,updated_at=EXCLUDED.updated_at`,
      [id,image?'upload':'preset',image?null:'xiaomoyu',image?.mediaType??null,image&&!this.store?image.body:null,bodyKey,
        image?.sha256??null,image?.body.length??null,image?.animated??false,image?.posterMediaType??null,
        image&&!this.store?image.posterBody:null,posterKey,image?.posterSha256??null,image?.width??null,image?.height??null,
        image?.frameCount??null,image?.durationMs??null]);
      const result=await this.view(client,id);
      await client.query(`INSERT INTO agent_account_events(agent_user_id,operator_user_id,action,metadata_json)
        VALUES($1,$2,$3,$4)`,[id,operator,image?'avatar-upload':'avatar-reset',JSON.stringify({
        previous:{kind:previous?.kind??'preset',presetKey:previous?.preset_key??null,sha256:previous?.sha256?Buffer.from(previous.sha256).toString('hex'):null},
        current:{kind:result.kind,presetKey:result.presetKey,sha256:image?.sha256.toString('hex')??null}})]);
      await client.query('COMMIT');
      await cleanup([previous?.body_key,previous?.poster_key]);
      return {agentUserId:id,avatar:result};
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      await cleanup(created);
      if(error.code==='55P03')fail('AGENT_AVATAR_BUSY');
      throw error;
    }finally{
      if(locked)try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}catch{destroy=true;}
      client.release(destroy);
    }
  }
}

export function createAgentAvatarService({repository,authorizeOperator,processImage}){
  const authorize=async(actor,id)=>{
    if(!uuid.test(id??''))fail('AGENT_INPUT');
    if(!uuid.test(actor?.userId??'')||!await authorizeOperator(actor))fail('AGENT_OPERATOR_REQUIRED');
    await repository.authorize(actor.userId,id);
  };
  return {authorize,
    async upload(actor,id,body){await authorize(actor,id);const image=await processImage(body);
      return repository.replace(actor.userId,id,{...image,sha256:digest(image.body),posterSha256:digest(image.posterBody)});},
    async reset(actor,id){await authorize(actor,id);return repository.replace(actor.userId,id,null);},
  };
}
