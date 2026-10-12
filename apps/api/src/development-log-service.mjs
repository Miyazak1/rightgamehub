import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(['update', 'release_notes', 'milestone']);
const iso = value => value ? new Date(value).toISOString() : null;

export class DevelopmentLogError extends Error {
  constructor(code, statusCode, message) {
    super(message); this.name = 'DevelopmentLogError'; this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500;
  }
}

const fail = (code, status, message) => { throw new DevelopmentLogError(code, status, message); };
const releaseView = row => row.release_id ? {
  id: row.release_id,
  label: row.release_label,
  targetKey: row.release_target_key,
  available: row.release_available === true,
} : null;
const entryView = row => ({
  id: row.id,
  workId: row.work_id,
  entryKind: row.entry_kind,
  title: row.title,
  body: row.body,
  publicationState: row.publication_state,
  version: Number(row.version),
  release: releaseView(row),
  authorDisplayName: row.author_display_name,
  publishedAt: iso(row.published_at),
  withdrawnAt: iso(row.withdrawn_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const entrySelect = `SELECT e.*,u.display_name AS author_display_name,r.label AS release_label,r.target_key AS release_target_key,
  (t.current_release_id=r.id AND t.state='published' AND r.validation_state='ready' AND r.serving_state='enabled'
    AND w.state='published' AND w.visibility='public') AS release_available
  FROM work_development_entries e
  JOIN works w ON w.id=e.work_id
  JOIN users u ON u.id=e.author_user_id
  LEFT JOIN releases r ON r.id=e.release_id
  LEFT JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key`;

async function ensureRelease(client, workId, releaseId) {
  if (!releaseId) return;
  const release = (await client.query(
    `SELECT r.id FROM releases r JOIN work_targets t ON t.work_id=r.work_id AND t.target_key=r.target_key
      WHERE r.id=$1 AND r.work_id=$2 AND t.current_release_id=r.id AND t.state='published'
        AND r.validation_state='ready' AND r.serving_state='enabled'`,
    [releaseId, workId],
  )).rows[0];
  if (!release) fail('DEVELOPMENT_RELEASE_INVALID', 409, '只能关联该作品当前公开可用的版本。');
}

async function appendEvent(client, input, entryId, action, details = {}) {
  await client.query(
    `INSERT INTO work_development_entry_events(id,entry_id,actor_user_id,action,details)
     VALUES($1,$2,$3,$4,$5)`,
    [input.eventId, entryId, input.actor.userId, action, details],
  );
}

export class PostgresDevelopmentLogRepository {
  constructor(pool) { this.pool = pool; }

  async listPublic(workId, limit) {
    const work = (await this.pool.query(
      "SELECT id FROM works WHERE id=$1 AND state='published' AND visibility='public'",
      [workId],
    )).rows[0];
    if (!work) fail('WORK_NOT_FOUND', 404, '作品不存在或当前不可公开访问。');
    const entries = (await this.pool.query(
      `${entrySelect} WHERE e.work_id=$1 AND e.publication_state='published' AND w.state='published' AND w.visibility='public'
       ORDER BY e.published_at DESC,e.id DESC LIMIT $2`,
      [workId, limit],
    )).rows.map(row => ({
      id: row.id,
      type: 'development_entry',
      entryKind: row.entry_kind,
      title: row.title,
      body: row.body,
      authorDisplayName: row.author_display_name,
      contributorDisplayName: null,
      contributionTaskId: null,
      release: releaseView(row),
      occurredAt: iso(row.published_at),
    }));
    const contributions = (await this.pool.query(
      `SELECT task.id,task.title,task.description,task.completed_at,contributor.display_name AS contributor_display_name,
              release.id AS release_id,release.label AS release_label,release.target_key AS release_target_key,
              (target.current_release_id=release.id AND target.state='published' AND release.validation_state='ready'
                AND release.serving_state='enabled') AS release_available
         FROM contribution_tasks task
         JOIN works w ON w.id=task.work_id
         JOIN users contributor ON contributor.id=task.claimant_user_id
         LEFT JOIN releases release ON release.id=task.resolved_release_id
         LEFT JOIN work_targets target ON target.work_id=release.work_id AND target.target_key=release.target_key
        WHERE task.work_id=$1 AND task.status='completed' AND w.state='published' AND w.visibility='public'
        ORDER BY task.completed_at DESC,task.id DESC LIMIT $2`,
      [workId, limit],
    )).rows.map(row => ({
      id: row.id,
      type: 'contribution_completed',
      entryKind: null,
      title: row.title,
      body: row.description,
      authorDisplayName: null,
      contributorDisplayName: row.contributor_display_name,
      contributionTaskId: row.id,
      release: releaseView(row),
      occurredAt: iso(row.completed_at),
    }));
    return [...entries, ...contributions]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
      .slice(0, limit);
  }

  async listForCreator(actor, workId) {
    const owner = (await this.pool.query('SELECT id FROM works WHERE id=$1 AND owner_user_id=$2', [workId, actor.userId])).rows[0];
    if (!owner) fail('WORK_NOT_FOUND', 404, '作品不存在，或不属于当前账号。');
    return (await this.pool.query(
      `${entrySelect} WHERE e.work_id=$1 AND e.author_user_id=$2 ORDER BY e.updated_at DESC,e.id DESC LIMIT 100`,
      [workId, actor.userId],
    )).rows.map(entryView);
  }

  async createDraft(input) {
    return withTransaction(this.pool, async client => {
      const work = (await client.query('SELECT id FROM works WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [input.workId, input.actor.userId])).rows[0];
      if (!work) fail('WORK_NOT_FOUND', 404, '作品不存在，或不属于当前账号。');
      const recent = Number((await client.query(
        "SELECT count(*)::int AS count FROM work_development_entries WHERE author_user_id=$1 AND created_at>now()-interval '24 hours'",
        [input.actor.userId],
      )).rows[0].count);
      if (recent >= 30) fail('DEVELOPMENT_LOG_RATE_LIMITED', 429, '今天创建的开发日志较多，请稍后再试。');
      await ensureRelease(client, input.workId, input.releaseId);
      await client.query(
        `INSERT INTO work_development_entries(id,work_id,author_user_id,entry_kind,title,body,release_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [input.entryId, input.workId, input.actor.userId, input.entryKind, input.title, input.body, input.releaseId],
      );
      await appendEvent(client, input, input.entryId, 'draft_created');
      const row = (await client.query(`${entrySelect} WHERE e.id=$1`, [input.entryId])).rows[0];
      return entryView(row);
    });
  }

  async update(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT w.id FROM works w WHERE w.id=(SELECT work_id FROM work_development_entries WHERE id=$1) FOR UPDATE', [input.entryId]);
      const row = (await client.query(
        `SELECT e.*,w.state AS work_state,w.visibility AS work_visibility
           FROM work_development_entries e JOIN works w ON w.id=e.work_id
          WHERE e.id=$1 AND e.author_user_id=$2 FOR UPDATE OF e`,
        [input.entryId, input.actor.userId],
      )).rows[0];
      if (!row) fail('DEVELOPMENT_ENTRY_NOT_FOUND', 404, '开发日志不存在，或不属于当前账号。');
      if (Number(row.version) !== input.expectedVersion) fail('DEVELOPMENT_ENTRY_STALE', 409, '开发日志已经变化，请刷新后重试。');
      if (input.action === 'edit') {
        if (row.publication_state !== 'draft') fail('DEVELOPMENT_ENTRY_STATE_CONFLICT', 409, '只有草稿可以编辑。');
        await ensureRelease(client, row.work_id, input.releaseId);
        await client.query(
          `UPDATE work_development_entries SET entry_kind=$2,title=$3,body=$4,release_id=$5,version=version+1,updated_at=now() WHERE id=$1`,
          [row.id, input.entryKind, input.title, input.body, input.releaseId],
        );
        await appendEvent(client, input, row.id, 'edited');
      } else if (input.action === 'publish') {
        if (row.publication_state !== 'draft') fail('DEVELOPMENT_ENTRY_STATE_CONFLICT', 409, '只有草稿可以发布。');
        if (row.work_state !== 'published' || row.work_visibility !== 'public') fail('WORK_NOT_PUBLIC', 409, '作品公开发布后才能发布开发日志。');
        await ensureRelease(client, row.work_id, row.release_id);
        await client.query(
          "UPDATE work_development_entries SET publication_state='published',published_at=now(),version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await appendEvent(client, input, row.id, 'published');
      } else if (input.action === 'withdraw') {
        if (row.publication_state !== 'published') fail('DEVELOPMENT_ENTRY_STATE_CONFLICT', 409, '只有已发布日志可以撤回。');
        await client.query(
          "UPDATE work_development_entries SET publication_state='withdrawn',withdrawn_at=now(),version=version+1,updated_at=now() WHERE id=$1",
          [row.id],
        );
        await appendEvent(client, input, row.id, 'withdrawn');
      }
      return entryView((await client.query(`${entrySelect} WHERE e.id=$1`, [row.id])).rows[0]);
    });
  }
}

export function createDevelopmentLogService({ repository, ids = () => crypto.randomUUID() }) {
  const requireCreator = (actor, scope = 'works:read') => {
    if (!actor?.userId) fail('UNAUTHORIZED', 401, '请先登录。');
    if (!actor.profile?.canPublish || !actor.scopes?.includes(scope)) fail('CREATOR_REQUIRED', 403, '需要创作者权限。');
  };
  const workId = value => { if (!uuidPattern.test(value)) fail('WORK_NOT_FOUND', 404, '作品不存在。'); return value; };
  const entryId = value => { if (!uuidPattern.test(value)) fail('DEVELOPMENT_ENTRY_NOT_FOUND', 404, '开发日志不存在。'); return value; };
  const text = (value, min, max, message) => {
    const cleaned = String(value ?? '').trim();
    if (cleaned.length < min || cleaned.length > max) fail('DEVELOPMENT_ENTRY_INVALID', 400, message);
    return cleaned;
  };
  const releaseId = value => {
    if (value == null || value === '') return null;
    if (!uuidPattern.test(value)) fail('DEVELOPMENT_RELEASE_INVALID', 400, '关联版本无效。');
    return value;
  };
  const fields = body => {
    if (!kinds.has(body?.entryKind)) fail('DEVELOPMENT_ENTRY_INVALID', 400, '请选择有效的日志类型。');
    return {
      entryKind: body.entryKind,
      title: text(body.title, 5, 120, '日志标题需要 5—120 个字符。'),
      body: text(body.body, 20, 4000, '日志正文需要 20—4,000 个字符。'),
      releaseId: releaseId(body.releaseId),
    };
  };
  return {
    listPublic: (id, query = {}) => {
      const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 50)));
      return repository.listPublic(workId(id), limit);
    },
    listForCreator: (actor, id) => { requireCreator(actor); return repository.listForCreator(actor, workId(id)); },
    createDraft: (actor, id, body) => {
      requireCreator(actor, 'works:write');
      return repository.createDraft({ actor, workId: workId(id), entryId: ids(), eventId: ids(), ...fields(body) });
    },
    update: (actor, id, body) => {
      requireCreator(actor, 'works:write');
      if (!['edit', 'publish', 'withdraw'].includes(body?.action)) fail('DEVELOPMENT_ENTRY_INVALID', 400, '日志操作无效。');
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) fail('DEVELOPMENT_ENTRY_INVALID', 400, '缺少当前日志版本。');
      const payload = { actor, entryId: entryId(id), eventId: ids(), action: body.action, expectedVersion };
      return repository.update(body.action === 'edit' ? { ...payload, ...fields(body) } : payload);
    },
  };
}
