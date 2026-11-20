import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {reject,parseInbound,applyQQControlPolicy} from './config.mjs';
import {qqPolicyView,qqAdminError} from '../../api/src/qq-admin-protocol.mjs';
import {agentRequestId} from './agent-bridge.mjs';
const day="date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'";
export class QQRepository {
  async enableAgentBridge(){await this.pool.query(await readFile(new URL('./agent-schema.sql',import.meta.url),'utf8'));this.agentBridge=true;}
  async agentLink(c,row){return (await c.query(`INSERT INTO mooyu_qq.agent_links(channel_id,message_id,request_id) VALUES($1,$2,$3)
    ON CONFLICT(channel_id,message_id) DO UPDATE SET request_id=mooyu_qq.agent_links.request_id RETURNING *`,[this.id,row.message_id,agentRequestId([this.id,row.message_id])])).rows[0];}
  async agentLinked(c,row,value){await c.query('UPDATE mooyu_qq.agent_links SET interaction_id=$3,task_id=coalesce(task_id,$4) WHERE channel_id=$1 AND message_id=$2',[this.id,row.message_id,value.id,value.task?.id??null]);}
  async agentDefer(c,row){await c.query("UPDATE mooyu_qq.messages SET next_at=now()+interval '2 seconds',updated_at=now() WHERE channel_id=$1 AND message_id=$2 AND status='queued'",[this.id,row.message_id]);}
  async agentReady(c,row,reply){await this.transaction(c,async client=>{const result=await client.query("UPDATE mooyu_qq.messages SET status='ready',reply=$3,error_code=NULL,updated_at=now() WHERE channel_id=$1 AND message_id=$2 AND status='queued'",[this.id,row.message_id,reply]);if(result.rowCount!==1)reject('QQ_JOB_STATE_CHANGED');await this.event(client,row.message_id,'agent-response-ready');});}
  async agentPending(c){return (await c.query(`SELECT m.*,l.task_id FROM mooyu_qq.agent_links l JOIN mooyu_qq.messages m USING(channel_id,message_id)
    WHERE l.channel_id=$1 AND l.task_id IS NOT NULL AND NOT l.task_settled AND l.next_poll_at<=now() AND m.status='delivered' ORDER BY l.next_poll_at LIMIT 1`,[this.id])).rows[0];}
  async agentPollLater(c,row){await c.query("UPDATE mooyu_qq.agent_links SET next_poll_at=now()+interval '5 seconds' WHERE channel_id=$1 AND message_id=$2",[this.id,row.message_id]);}
  async agentFinish(c,row,{reply,denied=false}){await this.transaction(c,async client=>{
    const link=await client.query('UPDATE mooyu_qq.agent_links SET task_settled=true WHERE channel_id=$1 AND message_id=$2 AND NOT task_settled RETURNING task_id',[this.id,row.message_id]);if(!link.rowCount)return;
    if(denied){await this.event(client,row.message_id,'agent-result-policy-rejected');return;}
    const id='-'+BigInt('0x'+createHash('sha256').update(this.id+':'+row.task_id).digest('hex').slice(0,12)).toString();
    await client.query(`INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,status,reply,origin_group_id,error_code)
      VALUES($1,$2,$3,'',$4,'ready',$5,$6,'QQ_AGENT_TASK_RESULT') ON CONFLICT DO NOTHING`,[this.id,id,row.user_id,'agent-task:'+row.task_id,reply,row.origin_group_id]);
    await client.query('INSERT INTO mooyu_qq.agent_deliveries(channel_id,message_id,source_message_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.id,id,row.message_id]);
    await this.event(client,row.message_id,'agent-result-queued',{taskId:row.task_id});
  });}
  constructor(pool,config){this.pool=pool;this.config=config;this.bootstrap=structuredClone(config);this.id=config.channelId;this.control=false;}
  async transaction(client,fn){
    try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[this.id]);
      const value=await fn(client);await client.query('COMMIT');return value;
    }catch(error){try{await client.query('ROLLBACK');}catch{client.qqBroken=true;}throw error;}
  }
  async locked(fn){
    const client=await this.pool.connect();let locked=false,destroy=false;
    const disconnected=()=>{destroy=true;};client.on('error',disconnected);
    try{
      locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,2)) AS acquired',[this.id])).rows[0].acquired;
      if(!locked)return {busy:true};
      return await fn(client);
    }finally{
      if(locked)try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,2))',[this.id]);}catch{destroy=true;}
      client.removeListener('error',disconnected);client.release(destroy||Boolean(client.qqBroken));
    }
  }
  async initialize(){return this.locked(client=>this.transaction(client,async c=>{
    await c.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    const existing=(await c.query('SELECT policy_hash FROM mooyu_qq.settings WHERE channel_id=$1',[this.id])).rows[0];
    if(existing?.policy_hash.startsWith('managed:'))reject('QQ_MANAGED_INITIALIZATION_REQUIRED');
    await c.query(`INSERT INTO mooyu_qq.settings(channel_id,policy_hash) VALUES($1,$2)
      ON CONFLICT(channel_id) DO UPDATE SET policy_hash=EXCLUDED.policy_hash`,[this.id,this.config.policyHash]);
    await this.event(c,null,'configured',{policyHash:this.config.policyHash});return {initialized:true};
  }));}
  async check(client=this.pool){
    if(this.control){
      const row=(await client.query('SELECT s.policy_hash,c.bootstrap_hash,c.policy FROM mooyu_qq.settings s JOIN mooyu_qq.control_settings c USING(channel_id) WHERE s.channel_id=$1',[this.id])).rows[0];
      if(row?.bootstrap_hash!==this.bootstrap.policyHash||row?.policy_hash!=='managed:'+this.bootstrap.policyHash)reject('QQ_POLICY_REINITIALIZATION_REQUIRED');
      this.config=applyQQControlPolicy(this.bootstrap,row.policy);return this.config;
    }
    const row=(await client.query('SELECT policy_hash FROM mooyu_qq.settings WHERE channel_id=$1',[this.id])).rows[0];
    if(row?.policy_hash!==this.config.policyHash)reject('QQ_POLICY_REINITIALIZATION_REQUIRED');
    return this.config;
  }
  async enableControl(){
    const outcome=await this.locked(c=>this.transaction(c,async client=>{
      const row=(await client.query('SELECT policy_hash FROM mooyu_qq.settings WHERE channel_id=$1 FOR UPDATE',[this.id])).rows[0];
      if(![this.bootstrap.policyHash,'managed:'+this.bootstrap.policyHash].includes(row?.policy_hash))reject('QQ_POLICY_REINITIALIZATION_REQUIRED');
      await client.query(await readFile(new URL('./control-schema.sql',import.meta.url),'utf8'));
      const inserted=await client.query('INSERT INTO mooyu_qq.control_settings(channel_id,bootstrap_hash,policy) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING channel_id',[this.id,this.bootstrap.policyHash,JSON.stringify(qqPolicyView(this.bootstrap))]);
      const control=(await client.query('SELECT bootstrap_hash FROM mooyu_qq.control_settings WHERE channel_id=$1',[this.id])).rows[0];
      if(control.bootstrap_hash!==this.bootstrap.policyHash)reject('QQ_POLICY_REINITIALIZATION_REQUIRED');
      await client.query('UPDATE mooyu_qq.messages SET origin_group_id=$2 WHERE channel_id=$1 AND origin_group_id IS NULL',[this.id,this.bootstrap.groupId]);
      await client.query('UPDATE mooyu_qq.settings SET policy_hash=$2 WHERE channel_id=$1',[this.id,'managed:'+this.bootstrap.policyHash]);
      if(inserted.rowCount)await this.event(client,null,'control-initialized',{revision:1});
      return {initialized:true};
    }));
    if(outcome.busy)throw qqAdminError('QQ_WORKER_BUSY',409);this.control=true;await this.check();return outcome;
  }
  async status(client=this.pool){
    await this.check(client);
    const states=(await client.query('SELECT status,count(*)::int AS count FROM mooyu_qq.messages WHERE channel_id=$1 GROUP BY status',[this.id])).rows;
    const review=(await client.query("SELECT message_id,error_code FROM mooyu_qq.messages WHERE channel_id=$1 AND status='needs-review' ORDER BY created_at",[this.id])).rows;
    const budget=(await client.query(`SELECT count(*)::int AS calls,COALESCE(sum(reserved_tokens),0)::int AS tokens
      FROM mooyu_qq.attempts WHERE channel_id=$1 AND created_at>=(${day})`,[this.id])).rows[0];
    return {states,review,budget:{...budget,maxCalls:this.config.dailyCalls,maxTokens:this.config.dailyTokens,timezone:'Asia/Shanghai'}};
  }
  async event(c,messageId,type,details={}){await c.query('INSERT INTO mooyu_qq.events(channel_id,message_id,event_type,details) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.id,messageId,type,JSON.stringify(details)]);}
  async admit(event){return this.accept(event,true);}
  async accept(input,inbound=false){
    const client=await this.pool.connect();let destroy=false;
    const disconnected=()=>{destroy=true;};client.on('error',disconnected);
    try{return await this.transaction(client,async c=>{
      await this.check(c);
      if(inbound){input=parseInbound(this.config,input);if(!input)return {accepted:false,code:'QQ_IGNORED'};}
      else if(this.control&&!this.config.enabled)return {accepted:false,code:'QQ_DISABLED'};
      const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const prior=(await c.query('SELECT fingerprint,status FROM mooyu_qq.messages WHERE channel_id=$1 AND message_id=$2',[this.id,input.messageId])).rows[0];
      if(prior){if(prior.fingerprint!==fingerprint){await this.event(c,input.messageId,'id-conflict');return {accepted:false,code:'QQ_MESSAGE_CONFLICT'};}
        return {accepted:true,duplicate:true,status:prior.status};}
      const counts=(await c.query(`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute')::int AS recent,
        count(*) FILTER(WHERE created_at>now()-interval '1 minute' AND user_id=$2)::int AS user_recent,
        count(*) FILTER(WHERE created_at>=(${day}))::int AS daily,
        count(*) FILTER(WHERE created_at>=(${day}) AND user_id=$2)::int AS user_daily,
        count(*) FILTER(WHERE status IN ('queued','generating','ready','sending'))::int AS pending
        FROM mooyu_qq.messages WHERE channel_id=$1`,[this.id,input.userId])).rows[0];
      if(counts.daily>=this.config.dailyCalls*2||counts.user_daily>=this.config.userDailyCalls*2)return {accepted:false,code:'QQ_DAILY_MESSAGE_LIMIT'};
      if(counts.recent>=this.config.groupMinuteMessages||counts.user_recent>=this.config.userMinuteMessages||counts.pending>=50)
        return {accepted:false,code:'QQ_RATE_LIMITED'};
      if(this.control)await c.query('INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint,origin_group_id) VALUES($1,$2,$3,$4,$5,$6)',[this.id,input.messageId,input.userId,input.text,fingerprint,this.config.groupId]);
      else await c.query('INSERT INTO mooyu_qq.messages(channel_id,message_id,user_id,input_text,fingerprint) VALUES($1,$2,$3,$4,$5)',[this.id,input.messageId,input.userId,input.text,fingerprint]);
      await this.event(c,input.messageId,'accepted');return {accepted:true,duplicate:false};
    });}finally{client.removeListener('error',disconnected);client.release(destroy||Boolean(client.qqBroken));}
  }
  async recover(c){return this.transaction(c,async client=>{
    await this.check(client);
    const sending=(await client.query(`UPDATE mooyu_qq.messages SET status='needs-review',error_code='QQ_DELIVERY_UNCERTAIN',run_token=NULL,updated_at=now()
      WHERE channel_id=$1 AND status='sending' RETURNING message_id`,[this.id])).rows;
    for(const row of sending)await this.event(client,row.message_id,'delivery-uncertain');
    const generating=(await client.query(`UPDATE mooyu_qq.messages SET status='queued',error_code='QQ_GENERATION_INTERRUPTED',run_token=NULL,updated_at=now()
      WHERE channel_id=$1 AND status='generating' RETURNING message_id`,[this.id])).rows;
    for(const row of generating)await this.event(client,row.message_id,'generation-recovered');
  });}
  async next(c){return (await c.query(`SELECT * ${this.agentBridge?',(SELECT source_message_id FROM mooyu_qq.agent_deliveries d WHERE d.channel_id=mooyu_qq.messages.channel_id AND d.message_id=mooyu_qq.messages.message_id) AS reply_to_message_id':''} FROM mooyu_qq.messages WHERE channel_id=$1 AND status IN ('ready','queued') AND next_at<=now()
    ORDER BY CASE WHEN status='ready' THEN 0 ELSE 1 END,created_at,message_id LIMIT 1`,[this.id])).rows[0]??null;}
  async history(c,row){
    const messages=(await c.query(`SELECT input_text,reply FROM mooyu_qq.messages WHERE channel_id=$1 AND user_id=$2 AND status='delivered' AND error_code IS NULL
      AND created_at<$3 ${this.control?'AND origin_group_id=$4':''} ORDER BY created_at DESC LIMIT 3`,this.control?[this.id,row.user_id,row.created_at,row.origin_group_id]:[this.id,row.user_id,row.created_at])).rows.reverse();
    return messages.flatMap(item=>[{role:'user',content:item.input_text},{role:'assistant',content:item.reply}]);
  }
  async deny(c,row){return this.transaction(c,async client=>{
    await client.query(`UPDATE mooyu_qq.messages SET status='failed',run_token=NULL,error_code='QQ_USER_NO_LONGER_ALLOWED',updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND status IN ('queued','ready')`,[this.id,row.message_id]);
    await this.event(client,row.message_id,'policy-rejected');
  });}
  async reserve(c,row,tokens){return this.transaction(c,async client=>{
    await this.check(client);
    const budget=(await client.query(`SELECT count(*)::int AS calls,COALESCE(sum(reserved_tokens),0)::int AS tokens,
      count(*) FILTER(WHERE user_id=$2)::int AS user_calls FROM mooyu_qq.attempts WHERE channel_id=$1 AND created_at>=(${day})`,[this.id,row.user_id])).rows[0];
    if(row.attempt_count>=this.config.maxAttempts||budget.calls>=this.config.dailyCalls||budget.tokens+tokens>this.config.dailyTokens||budget.user_calls>=this.config.userDailyCalls){
      await client.query(`UPDATE mooyu_qq.messages SET status='ready',reply=$3,error_code='QQ_BUDGET_EXHAUSTED',updated_at=now() WHERE channel_id=$1 AND message_id=$2 AND status='queued'`,
        [this.id,row.message_id,'本次暂未生成回答：已达到本地测试的调用预算或重试上限，请稍后再试。']);
      await this.event(client,row.message_id,'budget-exhausted');return null;
    }
    const token=randomUUID();
    const next=(await client.query(`UPDATE mooyu_qq.messages SET status='generating',run_token=$3,attempt_count=attempt_count+1,updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND status='queued' RETURNING *`,[this.id,row.message_id,token])).rows[0];
    if(!next)reject('QQ_JOB_STATE_CHANGED');
    await client.query(`INSERT INTO mooyu_qq.attempts(channel_id,message_id,user_id,attempt_no,reserved_tokens) VALUES($1,$2,$3,$4,$5)`,[this.id,row.message_id,row.user_id,next.attempt_count,tokens]);
    await this.event(client,row.message_id,'generation-started',{attempt:next.attempt_count,reservedTokens:tokens});return next;
  });}
  async generated(c,row,reply,result={}){return this.transaction(c,async client=>{
    const updated=await client.query(`UPDATE mooyu_qq.messages SET status='ready',reply=$4,run_token=NULL,error_code=NULL,updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND run_token=$3 AND status='generating'`,[this.id,row.message_id,row.run_token,reply]);
    if(updated.rowCount!==1)reject('QQ_JOB_STATE_CHANGED');
    const actual=Math.ceil(Number(result.usage?.inputTokens??0)+Number(result.usage?.outputTokens??0));
    if(Number.isSafeInteger(actual)&&actual>=0&&actual<=10000000)await client.query(`UPDATE mooyu_qq.attempts SET actual_tokens=$4,reserved_tokens=greatest(reserved_tokens,$4),provider_request_id=$5
      WHERE channel_id=$1 AND message_id=$2 AND attempt_no=$3`,[this.id,row.message_id,row.attempt_count,actual,result.providerRequestId?.slice(0,200)??null]);
    await this.event(client,row.message_id,'generated',{attempt:row.attempt_count});
  });}
  async generationFailed(c,row,code,retry){return this.transaction(c,async client=>{
    const safeCode=/^[A-Z][A-Z0-9_]{1,80}$/u.test(code??'')?code:'QQ_MODEL_FAILED';
    const res=await client.query(`UPDATE mooyu_qq.messages SET status=$4,run_token=NULL,reply=$5,error_code=$6,next_at=now()+interval '5 seconds',updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND run_token=$3 AND status='generating'`,[this.id,row.message_id,row.run_token,retry?'queued':'ready',retry?null:'暂时无法生成回答，请稍后再试。',safeCode]);
    if(res.rowCount!==1)reject('QQ_JOB_STATE_CHANGED');await this.event(client,row.message_id,retry?'generation-retry':'generation-failed',{code:safeCode});
  });}
  async beginSend(c,row){
    const token=randomUUID();return this.transaction(c,async client=>{
      const saved=(await client.query(`UPDATE mooyu_qq.messages SET status='sending',run_token=$3,updated_at=now()
        WHERE channel_id=$1 AND message_id=$2 AND status='ready' RETURNING *`,[this.id,row.message_id,token])).rows[0];
      if(!saved)reject('QQ_JOB_STATE_CHANGED');await this.event(client,row.message_id,'send-started');return {...saved,reply_to_message_id:row.reply_to_message_id};
    });
  }
  async sent(c,row,remoteId){return this.transaction(c,async client=>{
    const saved=await client.query(`UPDATE mooyu_qq.messages SET status='delivered',remote_message_id=$4,run_token=NULL,updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND run_token=$3 AND status='sending'`,[this.id,row.message_id,row.run_token,remoteId]);
    if(saved.rowCount!==1)reject('QQ_JOB_STATE_CHANGED');await this.event(client,row.message_id,'delivered',{remoteMessageId:remoteId});
  });}
  async sendFailed(c,row,{notSent=false,code='QQ_DELIVERY_UNCERTAIN'}={}){return this.transaction(c,async client=>{
    const safeCode=/^[A-Z][A-Z0-9_]{1,80}$/u.test(code)?code:'QQ_DELIVERY_UNCERTAIN';
    const updated=await client.query(`UPDATE mooyu_qq.messages SET status=$4,run_token=NULL,error_code=$5,next_at=now()+interval '10 seconds',updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND run_token=$3 AND status='sending'`,[this.id,row.message_id,row.run_token,notSent?'ready':'needs-review',safeCode]);
    if(updated.rowCount!==1)reject('QQ_JOB_STATE_CHANGED');
    await this.event(client,row.message_id,notSent?'send-not-dispatched':'delivery-uncertain',{code:safeCode});
  });}
  async resolve(messageId,{sent,remoteId=null}){return this.locked(c=>this.transaction(c,async client=>{
    await this.check(client);
    if(typeof sent!=='boolean'||!/^[-0-9]{1,24}$/u.test(messageId)||(sent?!/^[-0-9]{1,24}$/u.test(remoteId??''):remoteId!==null))reject('QQ_REVIEW_INPUT_INVALID');
    const row=await client.query(`UPDATE mooyu_qq.messages SET status=$3,remote_message_id=$4,error_code=NULL,next_at=now(),updated_at=now()
      WHERE channel_id=$1 AND message_id=$2 AND status='needs-review'`,[this.id,messageId,sent?'delivered':'ready',remoteId]);
    if(row.rowCount!==1)reject('QQ_REVIEW_STATE_INVALID');
    await this.event(client,messageId,sent?'operator-confirmed-sent':'operator-confirmed-not-sent');return {resolved:true};
  }));}
}
