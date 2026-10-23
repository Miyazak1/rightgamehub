import crypto from 'node:crypto';
import {withTransaction} from './database.mjs';
import {blogRequestHash} from './blog-contract.mjs';
import {AgentBlogAutomationError} from './agent-blog-writer.mjs';

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const slugPattern=/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/u;
const iso=value=>value?new Date(value).toISOString():null;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));

export class AgentBlogFollowUpError extends Error{
  constructor(code,statusCode,message,{retryable=false}={}){super(message);this.name='AgentBlogFollowUpError';this.code=code;this.statusCode=statusCode;this.retryable=retryable;}
}
const fail=(code,status,message,options)=>{throw new AgentBlogFollowUpError(code,status,message,options);};

const resultView=row=>({
  id:row.id,
  question:row.question,
  answer:row.answer,
  citationIds:Array.isArray(row.citation_ids)?row.citation_ids:[],
  parentQuestionId:row.parent_question_id??null,
  revisionId:row.revision_id,
  status:row.status,
  basis:(Array.isArray(row.citation_ids)&&row.citation_ids.length)?'article-and-sources':'article-only',
  createdAt:iso(row.created_at),
  completedAt:iso(row.completed_at),
});

const publicFailure=row=>{
  if(row.status==='processing')fail('BLOG_FOLLOW_UP_IN_PROGRESS',409,'这个问题正在回答，请稍后查看。',{retryable:true});
  if(row.status==='unknown')fail('BLOG_FOLLOW_UP_RESULT_UNKNOWN',409,'模型请求结果尚无法确认，为避免重复计费不会自动重试。请稍后再提一个新问题。');
  fail(row.error_code||'BLOG_FOLLOW_UP_FAILED',409,'这个问题未能完成，请使用新的问题重试。');
};

export class PostgresAgentBlogFollowUpRepository{
  constructor(pool){this.pool=pool;}
  async begin(input){
    return withTransaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`blog-follow-up:user:${input.askerUserId}`]);
      const article=(await client.query(`SELECT a.id AS article_id,a.published_revision_id AS revision_id,a.author_user_id AS agent_user_id,
        r.title,r.summary,r.blocks,r.citations,r.content_hash,aa.status AS agent_status,u.status AS user_status
        FROM blog_articles a
        JOIN blog_article_revisions r ON r.article_id=a.id AND r.id=a.published_revision_id
        JOIN users u ON u.id=a.author_user_id AND u.account_type='agent'
        JOIN agent_accounts aa ON aa.user_id=a.author_user_id
        WHERE a.slug=$1 AND a.publication_state='published'
        FOR SHARE OF a,r,u,aa`,[input.slug])).rows[0];
      if(!article)fail('BLOG_FOLLOW_UP_UNAVAILABLE',404,'这篇文章暂不支持站内追问。');
      const evidenceSnapshotHash=blogRequestHash({articleId:article.article_id,revisionId:article.revision_id,contentHash:article.content_hash,blocks:article.blocks,citations:article.citations});
      const requestHash=blogRequestHash({requestHash:input.requestHash,revisionId:article.revision_id,evidenceSnapshotHash});
      const duplicate=(await client.query('SELECT * FROM blog_article_questions WHERE asker_user_id=$1 AND idempotency_key=$2',[input.askerUserId,input.idempotencyKey])).rows[0];
      if(duplicate){if(duplicate.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT',409,'请求标识已用于其他追问或文章版本。');if(duplicate.status==='completed')return{replay:true,result:resultView(duplicate)};publicFailure(duplicate);}
      if(article.agent_status!=='active'||article.user_status!=='active')fail('BLOG_FOLLOW_UP_UNAVAILABLE',409,'文章作者机器人当前已暂停回答。');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`blog-follow-up:agent:${article.agent_user_id}`]);
      const provider=(await client.query(`SELECT s.model,k.ciphertext,k.nonce,k.auth_tag FROM agent_blog_automation_settings s
        JOIN agent_provider_secrets k ON k.agent_user_id=s.agent_user_id AND k.provider='deepseek'
        WHERE s.agent_user_id=$1 FOR SHARE OF s,k`,[article.agent_user_id])).rows[0];
      if(!provider)fail('BLOG_FOLLOW_UP_UNAVAILABLE',409,'文章作者机器人尚未配置回答能力。');
      let parent=null,depth=0;
      if(input.parentQuestionId){
        parent=(await client.query(`SELECT id,question,answer,depth FROM blog_article_questions
          WHERE id=$1 AND asker_user_id=$2 AND article_id=$3 AND revision_id=$4 AND status='completed'`,[input.parentQuestionId,input.askerUserId,article.article_id,article.revision_id])).rows[0];
        if(!parent)fail('BLOG_FOLLOW_UP_PARENT_INVALID',409,'上一条追问不存在，或文章已经发布了新版本。');
        depth=Number(parent.depth)+1;if(depth>4)fail('BLOG_FOLLOW_UP_DEPTH_LIMIT',409,'本轮追问已达到上限，请重新开始一个问题。');
      }
      const userUsed=Number((await client.query(`SELECT count(*)::int AS n FROM blog_article_questions
        WHERE asker_user_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`,[input.askerUserId])).rows[0].n);
      if(userUsed>=input.userDailyLimit)fail('BLOG_FOLLOW_UP_USER_LIMIT',429,'今天的文章追问次数已用完，请明天再试。');
      const agentUsed=Number((await client.query(`SELECT count(*)::int AS n FROM blog_article_questions
        WHERE agent_user_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`,[article.agent_user_id])).rows[0].n);
      if(agentUsed>=input.agentDailyLimit)fail('BLOG_FOLLOW_UP_AGENT_LIMIT',429,'这位机器人今天的回答额度已用完，请明天再试。');
      const row=(await client.query(`INSERT INTO blog_article_questions
        (id,article_id,revision_id,asker_user_id,agent_user_id,parent_question_id,depth,idempotency_key,request_hash,question,evidence_snapshot_hash,status,model)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'processing',$12) RETURNING *`,
      [input.id,article.article_id,article.revision_id,input.askerUserId,article.agent_user_id,input.parentQuestionId,depth,input.idempotencyKey,requestHash,input.question,evidenceSnapshotHash,provider.model])).rows[0];
      return{replay:false,row,article:{id:article.article_id,revisionId:article.revision_id,title:article.title,summary:article.summary,blocks:article.blocks,citations:article.citations},parent};
    });
  }
  async authorizeDispatch(id){
    const row=(await this.pool.query(`SELECT q.agent_user_id,q.model,k.ciphertext,k.nonce,k.auth_tag
      FROM blog_article_questions q JOIN agent_accounts aa ON aa.user_id=q.agent_user_id
      JOIN users u ON u.id=q.agent_user_id
      JOIN agent_provider_secrets k ON k.agent_user_id=q.agent_user_id AND k.provider='deepseek'
      WHERE q.id=$1 AND q.status='processing' AND aa.status='active' AND u.status='active'`,[id])).rows[0];
    if(!row)fail('BLOG_FOLLOW_UP_UNAVAILABLE',409,'文章作者机器人已暂停，或模型 Key 已撤销。');
    return{agentUserId:row.agent_user_id,model:row.model,secret:{ciphertext:row.ciphertext,nonce:row.nonce,authTag:row.auth_tag}};
  }
  async complete(id,output){
    const row=(await this.pool.query(`UPDATE blog_article_questions SET status='completed',answer=$2,citation_ids=$3,provider_usage=$4,provider_request_id=$5,completed_at=now()
      WHERE id=$1 AND status='processing' RETURNING *`,[id,output.answer,JSON.stringify(output.citationIds),JSON.stringify(output.usage??{}),output.requestId??null])).rows[0];
    if(row)return resultView(row);
    const existing=(await this.pool.query('SELECT * FROM blog_article_questions WHERE id=$1',[id])).rows[0];
    if(existing?.status==='completed'&&existing.answer===output.answer&&JSON.stringify(existing.citation_ids)===JSON.stringify(output.citationIds))return resultView(existing);
    fail('BLOG_FOLLOW_UP_STATE_CONFLICT',409,'问题状态已经变化。');
  }
  async finishFailure(id,status,errorCode){
    await this.pool.query(`UPDATE blog_article_questions SET status=$2,error_code=$3,completed_at=now() WHERE id=$1 AND status='processing'`,[id,status,errorCode]);
  }
}

export function createAgentBlogFollowUpService({repository,vault,writer,ids=()=>crypto.randomUUID(),userDailyLimit=10,agentDailyLimit=200}={}){
  return{
    async ask(actor,slug,input,idempotencyKey){
      if(!actor?.userId)fail('AUTH_REQUIRED',401,'请先登录后追问。');
      if(!slugPattern.test(String(slug??'')))fail('BLOG_ARTICLE_NOT_FOUND',404,'文章不存在。');
      if(!exact(input,['question','parentQuestionId']))fail('BLOG_FOLLOW_UP_INPUT_INVALID',400,'追问内容无效。');
      const question=String(input?.question??'').replace(/\s+/gu,' ').trim();
      const parentQuestionId=input?.parentQuestionId==null?null:String(input.parentQuestionId);
      if(question.length<2||question.length>500)fail('BLOG_FOLLOW_UP_INPUT_INVALID',400,'问题应为 2 至 500 个字符。');
      if(parentQuestionId&&!uuidPattern.test(parentQuestionId))fail('BLOG_FOLLOW_UP_INPUT_INVALID',400,'上一条追问标识无效。');
      const key=String(idempotencyKey??'').trim();if(key.length<8||key.length>128)fail('IDEMPOTENCY_KEY_REQUIRED',400,'请提供有效的请求标识。');
      const requestHash=blogRequestHash({slug,question,parentQuestionId});
      const begun=await repository.begin({id:ids(),askerUserId:actor.userId,slug,question,parentQuestionId,idempotencyKey:key,requestHash,userDailyLimit,agentDailyLimit});
      if(begun.replay)return begun.result;
      let apiKey,dispatch;
      try{dispatch=await repository.authorizeDispatch(begun.row.id);apiKey=vault.decrypt(dispatch.agentUserId,'deepseek',dispatch.secret);}
      catch(error){await repository.finishFailure(begun.row.id,'failed',error?.code||'AGENT_SECRET_VAULT_FAILED').catch(()=>{});fail('BLOG_FOLLOW_UP_UNAVAILABLE',503,'文章作者机器人暂时无法回答。',{retryable:true});}
      let output;
      try{output=await writer.answerArticle({apiKey,model:dispatch.model,article:begun.article,question,parent:begun.parent});}
      catch(error){
        const unknown=error instanceof AgentBlogAutomationError&&['AGENT_PROVIDER_TIMEOUT','AGENT_PROVIDER_FAILED'].includes(error.code);
        await repository.finishFailure(begun.row.id,unknown?'unknown':'failed',error?.code||'BLOG_FOLLOW_UP_FAILED').catch(()=>{});
        if(unknown)fail('BLOG_FOLLOW_UP_RESULT_UNKNOWN',502,'模型请求结果尚无法确认，为避免重复计费不会自动重试。');
        if(error instanceof AgentBlogAutomationError)fail(error.code,error.statusCode,error.message,{retryable:error.retryable});
        fail('BLOG_FOLLOW_UP_FAILED',502,'机器人暂时无法回答。',{retryable:true});
      }
      let persistenceError;
      for(let attempt=0;attempt<3;attempt++){try{return await repository.complete(begun.row.id,output);}catch(error){if(error instanceof AgentBlogFollowUpError)throw error;persistenceError=error;}}
      await repository.finishFailure(begun.row.id,'unknown','BLOG_FOLLOW_UP_PERSIST_FAILED').catch(()=>{});
      fail('BLOG_FOLLOW_UP_RESULT_UNKNOWN',503,'回答已经生成，但保存结果尚无法确认；为避免重复计费不会再次调用模型。',{retryable:true,cause:persistenceError});
    },
  };
}
