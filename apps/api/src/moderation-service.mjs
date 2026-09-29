import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = new Set(['unsafe', 'malware', 'harassment', 'copyright', 'other']);
const decisions = new Set(['suspend', 'dismiss']);

export class ModerationError extends Error {
  constructor(code, statusCode, message) { super(message); this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500; }
}

const reportView = row => ({
  id: row.id, workId: row.work_id, workTitle: row.work_title, reporterUserId: row.reporter_user_id,
  category: row.category, details: row.details, status: row.status, resolutionAction: row.resolution_action,
  resolutionNote: row.resolution_note, createdAt: new Date(row.created_at).toISOString(),
  resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
});

const auditView = row => ({
  id: row.id, reportId: row.report_id, workId: row.work_id, workTitle: row.work_title,
  actorUserId: row.actor_user_id, action: row.action, reason: row.reason,
  beforeState: row.before_state, afterState: row.after_state, createdAt: new Date(row.created_at).toISOString(),
});

export class PostgresModerationRepository {
  constructor(pool) { this.pool = pool; }

  async createReport(input) {
    return withTransaction(this.pool, async client => {
      const work = (await client.query(
        "SELECT id,title,owner_user_id FROM works WHERE id=$1 AND state='published' AND visibility='public' FOR SHARE",
        [input.workId],
      )).rows[0];
      if (!work) throw new ModerationError('NOT_FOUND', 404, '作品不存在或已经不可公开访问。');
      if (work.owner_user_id === input.actor.userId) throw new ModerationError('OWN_WORK_REPORT', 409, '不能举报自己的作品。');
      const row = (await client.query(
        `INSERT INTO content_reports(id,work_id,reporter_user_id,category,details)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (reporter_user_id,work_id) WHERE status='open'
         DO UPDATE SET category=EXCLUDED.category,details=EXCLUDED.details
         RETURNING *, $6::text AS work_title`,
        [input.reportId, input.workId, input.actor.userId, input.category, input.details, work.title],
      )).rows[0];
      return reportView(row);
    });
  }

  async listReports(status, limit) {
    const rows = (await this.pool.query(
      `SELECT r.*,w.title AS work_title FROM content_reports r JOIN works w ON w.id=r.work_id
       WHERE ($1::text IS NULL OR r.status=$1) ORDER BY r.created_at DESC,r.id DESC LIMIT $2`, [status, limit],
    )).rows;
    return rows.map(reportView);
  }

  async decide(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `SELECT r.*,w.title AS work_title,w.state AS work_state,w.visibility AS work_visibility,w.revision AS work_revision
         FROM content_reports r JOIN works w ON w.id=r.work_id WHERE r.id=$1 FOR UPDATE OF r,w`, [input.reportId],
      )).rows[0];
      if (!row) throw new ModerationError('NOT_FOUND', 404, '举报记录不存在。');
      if (row.status !== 'open') throw new ModerationError('REPORT_ALREADY_DECIDED', 409, '这条举报已经处理。');
      const beforeState = { reportStatus: row.status, workState: row.work_state, visibility: row.work_visibility, revision: String(row.work_revision) };
      if (input.action === 'suspend') {
        await client.query(
          "UPDATE work_targets SET current_release_id=NULL,state='suspended',publish_generation=publish_generation+1,revision=revision+1,updated_at=now() WHERE work_id=$1",
          [row.work_id],
        );
        await client.query("UPDATE releases SET serving_state='revoked' WHERE work_id=$1 AND serving_state='enabled'", [row.work_id]);
        await client.query("UPDATE works SET state='suspended',visibility='private',revision=revision+1,updated_at=now() WHERE id=$1", [row.work_id]);
      }
      const status = input.action === 'suspend' ? 'resolved' : 'dismissed';
      const decided = (await client.query(
        `UPDATE content_reports SET status=$2,resolution_action=$3,resolution_note=$4,resolved_at=now(),resolved_by=$5
         WHERE id=$1 RETURNING *, $6::text AS work_title`,
        [input.reportId, status, input.action, input.note, input.actor.userId, row.work_title],
      )).rows[0];
      const workAfter = (await client.query('SELECT state,visibility,revision FROM works WHERE id=$1', [row.work_id])).rows[0];
      const afterState = { reportStatus: status, workState: workAfter.state, visibility: workAfter.visibility, revision: String(workAfter.revision) };
      await client.query(
        `INSERT INTO moderation_audit_events(id,actor_user_id,report_id,work_id,action,reason,before_state,after_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.auditId, input.actor.userId, input.reportId, row.work_id, input.action, input.note, beforeState, afterState],
      );
      return reportView(decided);
    });
  }

  async listAudit(limit) {
    const rows = (await this.pool.query(
      `SELECT a.*,w.title AS work_title FROM moderation_audit_events a JOIN works w ON w.id=a.work_id
       ORDER BY a.created_at DESC,a.id DESC LIMIT $1`, [limit],
    )).rows;
    return rows.map(auditView);
  }
}

export function createModerationService({ repository }) {
  const requireUser = actor => { if (!actor?.userId) throw new ModerationError('UNAUTHORIZED', 401, '请先登录。'); };
  const requireAdmin = actor => { requireUser(actor); if (actor.profile?.role !== 'admin') throw new ModerationError('ADMIN_REQUIRED', 403, '需要管理员权限。'); };
  return {
    async report(actor, workId, body) {
      requireUser(actor);
      if (!uuidPattern.test(workId)) throw new ModerationError('REPORT_UNAVAILABLE', 409, '官方内置作品请通过反馈渠道联系 GameHub。');
      if (!categories.has(body.category)) throw new ModerationError('CATEGORY_INVALID', 400, '请选择有效的举报类型。');
      const details = String(body.details ?? '').trim();
      if (details.length > 1000) throw new ModerationError('DETAILS_TOO_LONG', 400, '补充说明不能超过 1000 个字符。');
      return repository.createReport({ actor, workId, category: body.category, details, reportId: crypto.randomUUID() });
    },
    async list(actor, query = {}) {
      requireAdmin(actor);
      const status = query.status || 'open';
      if (!['open','resolved','dismissed','all'].includes(status)) throw new ModerationError('STATUS_INVALID', 400, '无效的举报状态。');
      return repository.listReports(status === 'all' ? null : status, Math.min(100, Math.max(1, Number(query.limit) || 50)));
    },
    async decide(actor, reportId, body) {
      requireAdmin(actor);
      if (!decisions.has(body.action)) throw new ModerationError('ACTION_INVALID', 400, '无效的处置操作。');
      const note = String(body.note ?? '').trim();
      if (!note || note.length > 1000) throw new ModerationError('NOTE_REQUIRED', 400, '处置说明需要填写，且不能超过 1000 个字符。');
      return repository.decide({ actor, reportId, action: body.action, note, auditId: crypto.randomUUID() });
    },
    async audit(actor, query = {}) {
      requireAdmin(actor);
      return repository.listAudit(Math.min(100, Math.max(1, Number(query.limit) || 50)));
    },
  };
}
