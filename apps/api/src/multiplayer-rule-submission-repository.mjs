import { withTransaction } from './database.mjs';
import { MultiplayerRuleSubmissionError } from './multiplayer-rule-submission-service.mjs';

const listView = row => ({
  id: row.id,workId: row.work_id,workTitle: row.work_title ?? null,ownerUserId: row.owner_user_id,ownerDisplayName: row.owner_display_name ?? null,
  modeKey: row.mode_key,modeName: row.mode_name,rulesetVersion: row.ruleset_version,minPlayers: Number(row.min_players),maxPlayers: Number(row.max_players),
  state: row.state,sourceFileName: row.source_file_name,declaredBytes: String(row.declared_bytes),actualBytes: row.actual_bytes == null ? null : String(row.actual_bytes),
  sourceSha256: row.actual_sha256 ?? row.declared_sha256,errorCode: row.error_code,reviewNote: row.review_note,
  submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),updatedAt: new Date(row.updated_at).toISOString(),
  doctorSummary: row.doctor_report?.summary ?? null,
});
const detailView = (row, events = []) => ({
  ...listView(row),modeConfig: row.mode_config,creatorSubmission: row.creator_submission,doctorReport: row.doctor_report,
  events: events.map(event => ({ id: event.id,action: event.action,fromState: event.from_state,toState: event.to_state,details: event.details,actorUserId: event.actor_user_id,createdAt: new Date(event.created_at).toISOString() })),
});
const stateForAction = { start: 'in_review',request_changes: 'changes_requested',approve_for_build: 'approved_for_build',reject: 'rejected' };
const eventForAction = { start: 'review_started',request_changes: 'changes_requested',approve_for_build: 'approved_for_build',reject: 'rejected' };

export class PostgresMultiplayerRuleSubmissionRepository {
  constructor(pool) { this.pool = pool; }

  async replayCreate(input) {
    const previous = (await this.pool.query("SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='multiplayer.rules.create' AND key=$2", [input.actor.userId,input.idempotencyKey])).rows[0];
    if (!previous) return null;
    if (previous.request_hash !== input.requestHash) throw new MultiplayerRuleSubmissionError('IDEMPOTENCY_CONFLICT', 409, '该 Idempotency-Key 已用于另一份规则提交。');
    return previous.result_json;
  }

  async createIdempotent(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`rules-submission:${input.actor.userId}:${input.idempotencyKey}`]);
      const previous = (await client.query("SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='multiplayer.rules.create' AND key=$2", [input.actor.userId,input.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.request_hash !== input.requestHash) throw new MultiplayerRuleSubmissionError('IDEMPOTENCY_CONFLICT', 409, '该 Idempotency-Key 已用于另一份规则提交。');
        return previous.result_json;
      }
      const work = (await client.query('SELECT id,state,title FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId,input.actor.userId])).rows[0];
      if (!work) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '作品不存在或不属于当前创作者。');
      if (work.state === 'suspended') throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, '作品已暂停，不能提交新的规则版本。');
      const stale = (await client.query(
        `SELECT id,state FROM multiplayer_rule_submissions
          WHERE work_id=$1 AND mode_key=$2 AND ruleset_version=$3 AND state IN ('created','receiving','uploaded') AND expires_at<=now()
          FOR UPDATE`, [input.workId,input.body.modeKey,input.body.rulesetVersion],
      )).rows[0];
      if (stale) {
        await client.query("UPDATE multiplayer_rule_submissions SET state='expired',updated_at=now() WHERE id=$1", [stale.id]);
        await client.query("INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state) VALUES ($1,$2,$3,'expired',$4,'expired')", [input.expiryEventId,stale.id,input.actor.userId,stale.state]);
      }
      const row = (await client.query(
        `INSERT INTO multiplayer_rule_submissions(id,owner_user_id,work_id,mode_key,mode_name,ruleset_version,min_players,max_players,mode_config,creator_submission,doctor_report,source_file_name,declared_bytes,declared_sha256,object_key,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()+interval '30 minutes') RETURNING *`,
        [input.submissionId,input.actor.userId,input.workId,input.body.modeKey,input.body.modeName,input.body.rulesetVersion,input.body.minPlayers,input.body.maxPlayers,input.body.modeConfig ?? {},input.body.creatorSubmission,input.body.doctorReport,input.body.fileName,input.declaredBytes,input.body.sha256,input.objectKey],
      )).rows[0];
      await client.query('INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,to_state) VALUES ($1,$2,$3,\'created\',\'created\')', [input.eventId,row.id,input.actor.userId]);
      const result = listView({ ...row,work_title: work.title });
      await client.query("INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at) VALUES ($1,'multiplayer.rules.create',$2,$3,200,$4,now()+interval '24 hours')", [input.actor.userId,input.idempotencyKey,input.requestHash,result]);
      return result;
    }).catch(error => {
      if (error?.code === '23505') throw new MultiplayerRuleSubmissionError('RULESET_ALREADY_ACTIVE', 409, '该作品、模式和规则版本已有一份进行中的提交。');
      throw error;
    });
  }

  async createGrant(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT * FROM multiplayer_rule_submissions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.submissionId,input.actor.userId])).rows[0];
      if (!row) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '规则提交不存在。');
      if (row.state !== 'created' || new Date(row.expires_at) <= new Date()) throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, '规则提交当前不能接收文件。');
      const expiresAt = new Date(Math.min(new Date(row.expires_at).getTime(), Date.now() + 15 * 60_000));
      await client.query('INSERT INTO multiplayer_rule_submission_grants(id,submission_id,owner_user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5)', [input.grantId,row.id,input.actor.userId,input.tokenHash,expiresAt]);
      return { expiresAt };
    });
  }

  async beginReceive(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT s.*,g.id AS grant_id,g.expires_at AS grant_expires_at,g.consumed_at,g.revoked_at
           FROM multiplayer_rule_submission_grants g JOIN multiplayer_rule_submissions s ON s.id=g.submission_id
          WHERE g.token_hash=$1 AND s.id=$2 FOR UPDATE OF g,s`, [input.tokenHash,input.submissionId],
      )).rows[0];
      if (!row || row.consumed_at || row.revoked_at || new Date(row.grant_expires_at) <= new Date()) throw new MultiplayerRuleSubmissionError('UPLOAD_GRANT_INVALID', 401, '规则包上传授权无效或已过期。');
      if (row.state !== 'created') throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, '规则提交当前不能接收文件。');
      await client.query('UPDATE multiplayer_rule_submission_grants SET consumed_at=now() WHERE id=$1', [row.grant_id]);
      await client.query("UPDATE multiplayer_rule_submissions SET state='receiving',updated_at=now() WHERE id=$1", [row.id]);
      return { objectKey: row.object_key,declaredBytes: Number(row.declared_bytes),declaredSha256: row.declared_sha256,ownerUserId: row.owner_user_id };
    });
  }

  async finishReceive(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query("UPDATE multiplayer_rule_submissions SET state='uploaded',actual_bytes=$2,actual_sha256=$3,updated_at=now() WHERE id=$1 AND state='receiving' RETURNING *", [input.submissionId,input.actualBytes,input.actualSha256])).rows[0];
      if (!row) throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, '规则包接收状态已变化。');
      await client.query("INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state,details) VALUES ($1,$2,$3,'uploaded','receiving','uploaded',$4)", [input.eventId,row.id,input.actorUserId,{ sha256: input.actualSha256,bytes: String(input.actualBytes) }]);
      return listView(row);
    });
  }

  async failReceive(input) {
    await withTransaction(this.pool, async client => {
      const row = (await client.query("UPDATE multiplayer_rule_submissions SET state='failed',error_code=$2,updated_at=now() WHERE id=$1 AND state='receiving' RETURNING *", [input.submissionId,input.errorCode])).rows[0];
      if (row) await client.query("INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state,details) VALUES ($1,$2,$3,'upload_failed','receiving','failed',$4)", [input.eventId,row.id,input.actorUserId,{ errorCode: input.errorCode }]);
    });
  }

  async submit(input) {
    const result = await withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT * FROM multiplayer_rule_submissions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.submissionId,input.actor.userId])).rows[0];
      if (!row) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '规则提交不存在。');
      if (row.state === 'submitted' || row.state === 'in_review') return listView(row);
      if (row.state !== 'uploaded') throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, '源码包完整上传后才能提交审核。');
      if (new Date(row.expires_at) <= new Date()) {
        await client.query("UPDATE multiplayer_rule_submissions SET state='expired',updated_at=now() WHERE id=$1", [row.id]);
        await client.query("INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state) VALUES ($1,$2,$3,'expired','uploaded','expired')", [input.expiryEventId,row.id,input.actor.userId]);
        return { expiredSubmissionId: row.id };
      }
      const updated = (await client.query("UPDATE multiplayer_rule_submissions SET state='submitted',submitted_at=now(),expires_at=now()+interval '365 days',updated_at=now() WHERE id=$1 RETURNING *", [row.id])).rows[0];
      await client.query("INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state) VALUES ($1,$2,$3,'submitted','uploaded','submitted')", [input.eventId,row.id,input.actor.userId]);
      return listView(updated);
    });
    if (result.expiredSubmissionId) throw new MultiplayerRuleSubmissionError('SUBMISSION_EXPIRED', 409, `规则提交 ${result.expiredSubmissionId} 已过期，请重新创建。`);
    return result;
  }

  async listMine({ actor,workId }) {
    const values = [actor.userId];
    const filter = workId ? (values.push(workId),' AND s.work_id=$2') : '';
    const rows = (await this.pool.query(`SELECT s.*,w.title AS work_title FROM multiplayer_rule_submissions s JOIN works w ON w.id=s.work_id WHERE s.owner_user_id=$1${filter} ORDER BY s.created_at DESC LIMIT 100`, values)).rows;
    return rows.map(listView);
  }

  async getMine({ actor,submissionId }) {
    const row = (await this.pool.query('SELECT s.*,w.title AS work_title FROM multiplayer_rule_submissions s JOIN works w ON w.id=s.work_id WHERE s.id=$1 AND s.owner_user_id=$2', [submissionId,actor.userId])).rows[0];
    if (!row) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '规则提交不存在。');
    const events = (await this.pool.query('SELECT * FROM multiplayer_rule_submission_events WHERE submission_id=$1 ORDER BY created_at,id', [submissionId])).rows;
    return detailView(row,events);
  }

  async adminList({ state = 'queue',limit = 50 } = {}) {
    const states = state === 'queue' ? ['submitted','in_review'] : [state];
    const rows = (await this.pool.query(
      `SELECT s.*,w.title AS work_title,u.display_name AS owner_display_name
         FROM multiplayer_rule_submissions s JOIN works w ON w.id=s.work_id JOIN users u ON u.id=s.owner_user_id
        WHERE s.state=ANY($1::text[]) ORDER BY COALESCE(s.submitted_at,s.created_at),s.id LIMIT $2`, [states,limit],
    )).rows;
    return rows.map(listView);
  }

  async adminGet(submissionId) {
    const row = (await this.pool.query('SELECT s.*,w.title AS work_title,u.display_name AS owner_display_name FROM multiplayer_rule_submissions s JOIN works w ON w.id=s.work_id JOIN users u ON u.id=s.owner_user_id WHERE s.id=$1', [submissionId])).rows[0];
    if (!row) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '规则提交不存在。');
    const events = (await this.pool.query('SELECT * FROM multiplayer_rule_submission_events WHERE submission_id=$1 ORDER BY created_at,id', [submissionId])).rows;
    return detailView(row,events);
  }

  async review(input) {
    const targetState = stateForAction[input.action];
    if (!targetState) throw new MultiplayerRuleSubmissionError('SCHEMA_INVALID', 400, '未知审核动作。');
    return withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT * FROM multiplayer_rule_submissions WHERE id=$1 FOR UPDATE', [input.submissionId])).rows[0];
      if (!row) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '规则提交不存在。');
      if (input.action === 'start' && row.state === 'in_review') return listView(row);
      const expected = input.action === 'start' ? 'submitted' : 'in_review';
      if (row.state !== expected) throw new MultiplayerRuleSubmissionError('STATE_CONFLICT', 409, `规则提交当前处于 ${row.state}，不能执行该审核动作。`);
      const terminal = input.action !== 'start';
      const updated = (await client.query(
        `UPDATE multiplayer_rule_submissions SET state=$2,review_note=$3,reviewed_by=$4,reviewed_at=CASE WHEN $5 THEN now() ELSE reviewed_at END,updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id,targetState,input.note,input.actor.userId,terminal],
      )).rows[0];
      await client.query('INSERT INTO multiplayer_rule_submission_events(id,submission_id,actor_user_id,action,from_state,to_state,details) VALUES ($1,$2,$3,$4,$5,$6,$7)', [input.eventId,row.id,input.actor.userId,eventForAction[input.action],row.state,targetState,input.note ? { note: input.note } : {}]);
      return listView(updated);
    });
  }

  async packageForAdmin(submissionId) {
    const row = (await this.pool.query("SELECT object_key,source_file_name,actual_sha256,actual_bytes FROM multiplayer_rule_submissions WHERE id=$1 AND state IN ('submitted','in_review','approved_for_build','changes_requested','rejected')", [submissionId])).rows[0];
    if (!row?.actual_sha256) throw new MultiplayerRuleSubmissionError('NOT_FOUND', 404, '可审核的规则源码包不存在。');
    return { objectKey: row.object_key,fileName: row.source_file_name,sha256: row.actual_sha256,bytes: String(row.actual_bytes) };
  }
}
