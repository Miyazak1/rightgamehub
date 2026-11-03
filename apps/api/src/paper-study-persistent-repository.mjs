import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { TEXT_DRAFT_NOTICE } from './agent-paper-text-draft.mjs';

export const paperStudyError = (code, statusCode = 409) => Object.assign(Error(code), { code, statusCode, retryable: false });
const fail = (code, status) => { throw paperStudyError(code, status); };
export function persistentPaperView(row) {
  const parsed = row.parsed_json, pack = row.analysis_json;
  const failed = ['failed','rejected','uncertain','cancelled'].includes(row.run_status) && !row.task_result;
  return { id: row.id, title: row.title, filename: row.filename, sourceSha256: row.source_sha256,
    status: failed ? 'failed' : row.status, errorCode: failed ? row.run_error ?? 'PAPER_STUDY_TASK_STOPPED' : null,
    pageCount: parsed?.pageCount ?? 0,
    pages: parsed?.pages.map((p,i) => ({ page:i+1, text:(p.blocks ?? []).map(b=>b.text).join('\n\n') })) ?? [],
    analysis: pack ? { findings:pack.findings,evidence:pack.evidence,limitations:pack.limitations,readingScope:pack.readingScope,notice:TEXT_DRAFT_NOTICE } : null,
    draft: row.draft_json, mode:'private-persistent', modelCallsEnabled:false, private:true, publicPublicationEnabled:false, manualReviewRequired:true };
}
const projection = `SELECT d.id,d.owner_user_id,d.title,d.filename,d.source_sha256,d.status,d.parsed_json,d.analysis_json,d.draft_json,d.created_at,r.status AS run_status,r.error_code AS run_error,t.result_json AS task_result
  FROM paper_study_documents d LEFT JOIN LATERAL (SELECT * FROM paper_study_tasks WHERE document_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
  LEFT JOIN agent_runs r ON r.id=t.runtime_run_id`;
export class PostgresPaperStudyRepository {
  constructor(pool) { this.pool=pool; }
  async list(owner) { return (await this.pool.query(projection+' WHERE d.owner_user_id=$1 ORDER BY d.created_at DESC,d.id',[owner])).rows; }
  async read(owner,id) { const row=(await this.pool.query(projection+' WHERE d.owner_user_id=$1 AND d.id=$2',[owner,id])).rows[0];if(!row)fail('PAPER_STUDY_NOT_FOUND',404);return row; }
  async source(owner,id) {const row=(await this.pool.query('SELECT pdf_bytes FROM paper_study_documents WHERE owner_user_id=$1 AND id=$2',[owner,id])).rows[0];if(!row)fail('PAPER_STUDY_NOT_FOUND',404);return row.pdf_bytes;}
  async import(owner,input,bytes,agentUserId) {
    return withTransaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['paper-study-owner:'+owner]);
      const source=crypto.createHash('sha256').update(bytes).digest('hex');
      const prior=(await client.query('SELECT * FROM paper_study_documents WHERE owner_user_id=$1 AND source_sha256=$2',[owner,source])).rows[0];
      if(prior) {
        if (input.arxivId && input.arxivId !== prior.arxiv_id) fail('PAPER_STUDY_IMPORT_CONFLICT');
        return prior;
      }
      const usage=(await client.query('SELECT count(*)::int AS count,COALESCE(sum(octet_length(pdf_bytes)),0)::bigint AS bytes FROM paper_study_documents WHERE owner_user_id=$1',[owner])).rows[0];
      if(usage.count>=20||Number(usage.bytes)+bytes.length>100*1024*1024)fail('PAPER_STUDY_LIBRARY_LIMIT',429);
      const id=crypto.randomUUID();
      const row=(await client.query(`INSERT INTO paper_study_documents(id,owner_user_id,title,filename,source_sha256,pdf_bytes,arxiv_id,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'importing') RETURNING *`,[id,owner,input.title.trim(),input.filename.replace(/[\\/\u0000-\u001f]/g,'_'),source,bytes,input.arxivId||null])).rows[0];
      await this.createTask(client,id,'import',agentUserId); return row;
    });
  }
  async createTask(client,id,operation,agent) {
    await client.query(`INSERT INTO paper_study_tasks(id,document_id,operation,execution_agent_user_id,desired_run_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(document_id,operation) DO NOTHING`,[crypto.randomUUID(),id,operation,agent,crypto.randomUUID()]);
  }
  async enqueue(owner,id,operation,agent) {
    return withTransaction(this.pool,async client=>{
      const row=(await client.query('SELECT * FROM paper_study_documents WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[id,owner])).rows[0];
      if(!row)fail('PAPER_STUDY_NOT_FOUND',404);
      const prior=(await client.query('SELECT id FROM paper_study_tasks WHERE document_id=$1 AND operation=$2',[id,operation])).rows[0];
      if(prior)return;
      if(operation==='analyze'&&!row.parsed_json)fail('PAPER_STUDY_NOT_READY');
      if(operation==='draft'&&!row.analysis_json)fail('PAPER_STUDY_ANALYSIS_REQUIRED');
      await this.createTask(client,id,operation,agent);
      await client.query('UPDATE paper_study_documents SET status=$2,updated_at=now() WHERE id=$1',[id,operation==='analyze'?'analyzing':'drafting']);
    });
  }
  async pending(agentUserId,operations) { return (await this.pool.query(`SELECT t.*,d.owner_user_id,d.source_sha256 FROM paper_study_tasks t JOIN paper_study_documents d ON d.id=t.document_id
    WHERE t.runtime_run_id IS NULL AND t.execution_agent_user_id=$1 AND t.operation=ANY($2::text[])
    ORDER BY t.created_at,t.id LIMIT 25`,[agentUserId,operations])).rows; }
  async attach(taskId,runId) { await this.pool.query('UPDATE paper_study_tasks SET runtime_run_id=$2 WHERE id=$1 AND runtime_run_id IS NULL',[taskId,runId]); }
  async execution(context) {
    const row=(await this.pool.query(`SELECT t.*,d.owner_user_id,d.source_sha256,d.pdf_bytes,d.parsed_json,d.analysis_json,d.draft_json,d.arxiv_id FROM paper_study_tasks t JOIN paper_study_documents d ON d.id=t.document_id
      WHERE t.runtime_run_id=$1 AND t.id=$2 AND d.id=$3 AND d.owner_user_id=$4 AND t.execution_agent_user_id=$5`,
    [context.run.id,context.run.input.taskId,context.run.input.documentId,context.run.input.ownerUserId,context.run.agentUserId])).rows[0];
    if(!row||row.source_sha256!==context.run.input.sourceSha256)fail('PAPER_STUDY_TASK_BINDING_INVALID');return row;
  }
  async checkpoint(context,execution,result,patch) {
    return withTransaction(this.pool,async client=>{
      const stage=(await client.query(`SELECT id FROM agent_run_stages WHERE id=$1 AND run_id=$2 AND status='running' AND leased_by=$3 AND lease_token=$4 AND lease_until>now() FOR UPDATE`,[context.stage.id,context.run.id,execution.workerId,execution.leaseToken])).rows[0];
      if(!stage)fail('AGENT_RUNTIME_LEASE_LOST');
      const task=(await client.query('SELECT * FROM paper_study_tasks WHERE id=$1 AND runtime_run_id=$2 FOR UPDATE',[context.run.input.taskId,context.run.id])).rows[0];
      if(!task)fail('PAPER_STUDY_TASK_BINDING_INVALID');
      const digest=stableHash(result);
      if(task.result_json){if(task.result_sha256!==digest)fail('PAPER_STUDY_CHECKPOINT_CONFLICT');return task.result_json;}
      const column={import:'parsed_json',analyze:'analysis_json',draft:'draft_json'}[task.operation];
      const status={import:'imported',analyze:'analyzed',draft:'draft-ready'}[task.operation];
      await client.query(`UPDATE paper_study_documents SET ${column}=$2,status=$3,updated_at=now() WHERE id=$1`,[task.document_id,JSON.stringify(patch),status]);
      await client.query('UPDATE paper_study_tasks SET result_json=$2,result_sha256=$3 WHERE id=$1',[task.id,JSON.stringify(result),digest]);return result;
    });
  }
}
