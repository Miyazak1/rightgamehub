import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = new Set(['bug', 'idea', 'compatibility', 'other']);
const statuses = new Set(['new', 'reviewed', 'archived', 'issue_drafted', 'issue_linked', 'resolved']);
const actions = new Set(['review', 'archive', 'reopen', 'link_issue']);

export class CreatorFeedbackError extends Error {
  constructor(code, statusCode, message) { super(message); this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500; }
}

const feedbackView = row => ({
  id: row.id,
  workId: row.work_id,
  workTitle: row.work_title,
  category: row.category,
  summary: row.summary,
  details: row.details,
  reproductionSteps: row.reproduction_steps,
  environment: row.environment,
  status: row.status,
  issueUrl: row.issue_url,
  contributionTaskId: row.contribution_task_id ?? null,
  repositoryUrl: row.repository_url,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const lockFeedback = async (client, feedbackId, ownerUserId) => {
  await client.query('SELECT w.id FROM works w WHERE w.id=(SELECT work_id FROM creator_feedback WHERE id=$1) FOR UPDATE', [feedbackId]);
  const row = (await client.query(
    `SELECT f.*,w.title AS work_title,w.repository_url,(SELECT id FROM contribution_tasks WHERE feedback_id=f.id) AS contribution_task_id
     FROM creator_feedback f JOIN works w ON w.id=f.work_id
     WHERE f.id=$1 AND w.owner_user_id=$2 FOR UPDATE OF f`,
    [feedbackId, ownerUserId],
  )).rows[0];
  if (!row) throw new CreatorFeedbackError('FEEDBACK_NOT_FOUND', 404, '反馈不存在，或不属于你的作品。');
  return row;
};

const appendEvent = (client, { eventId, feedbackId, actorUserId, action, details = {} }) => client.query(
  `INSERT INTO creator_feedback_events(id,feedback_id,actor_user_id,action,details)
   VALUES ($1,$2,$3,$4,$5)`,
  [eventId, feedbackId, actorUserId, action, details],
);

export class PostgresCreatorFeedbackRepository {
  constructor(pool) { this.pool = pool; }

  async create(input) {
    return withTransaction(this.pool, async client => {
      const work = (await client.query(
        "SELECT id,title,owner_user_id,repository_url FROM works WHERE id=$1 AND state='published' AND visibility='public' FOR SHARE",
        [input.workId],
      )).rows[0];
      if (!work) throw new CreatorFeedbackError('FEEDBACK_UNAVAILABLE', 404, '作品不存在或已经不可公开访问。');
      if (work.owner_user_id === input.actor.userId) throw new CreatorFeedbackError('OWN_WORK_FEEDBACK', 409, '不能给自己的作品提交玩家反馈。');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [input.actor.userId, input.workId]);
      const recent = Number((await client.query(
        "SELECT count(*)::int AS count FROM creator_feedback WHERE reporter_user_id=$1 AND work_id=$2 AND created_at >= now() - interval '24 hours'",
        [input.actor.userId, input.workId],
      )).rows[0].count);
      if (recent >= 5) throw new CreatorFeedbackError('FEEDBACK_RATE_LIMITED', 429, '你今天给这个作品提交的反馈已达到上限，请稍后再试。');
      const row = (await client.query(
        `INSERT INTO creator_feedback(id,work_id,reporter_user_id,category,summary,details,reproduction_steps,environment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *, $9::text AS work_title, $10::text AS repository_url`,
        [input.feedbackId, input.workId, input.actor.userId, input.category, input.summary, input.details, input.reproductionSteps, input.environment, work.title, work.repository_url],
      )).rows[0];
      await appendEvent(client, { eventId: input.eventId, feedbackId: row.id, actorUserId: input.actor.userId, action: 'submitted' });
      return feedbackView(row);
    });
  }

  async listForCreator({ actor, status, limit }) {
    const rows = (await this.pool.query(
      `SELECT f.*,w.title AS work_title,w.repository_url,(SELECT id FROM contribution_tasks WHERE feedback_id=f.id) AS contribution_task_id
       FROM creator_feedback f JOIN works w ON w.id=f.work_id
       WHERE w.owner_user_id=$1 AND ($2::text IS NULL OR f.status=$2)
       ORDER BY CASE WHEN f.status='new' THEN 0 WHEN f.status='issue_drafted' THEN 1 WHEN f.status='reviewed' THEN 2 WHEN f.status='issue_linked' THEN 3 ELSE 4 END,
         f.created_at DESC,f.id DESC LIMIT $3`,
      [actor.userId, status, limit],
    )).rows;
    return rows.map(feedbackView);
  }

  async getForCreator({ actor, feedbackId }) {
    const row = (await this.pool.query(
      `SELECT f.*,w.title AS work_title,w.repository_url,(SELECT id FROM contribution_tasks WHERE feedback_id=f.id) AS contribution_task_id
       FROM creator_feedback f JOIN works w ON w.id=f.work_id
       WHERE f.id=$1 AND w.owner_user_id=$2`,
      [feedbackId, actor.userId],
    )).rows[0];
    return row ? feedbackView(row) : null;
  }

  async issueDrafted({ actor, feedbackId, eventId }) {
    return withTransaction(this.pool, async client => {
      const current = await lockFeedback(client, feedbackId, actor.userId);
      if (['archived','resolved'].includes(current.status)) throw new CreatorFeedbackError('FEEDBACK_ARCHIVED', 409, '已归档或解决的反馈需要先重新打开。');
      if (current.status === 'issue_linked') throw new CreatorFeedbackError('ISSUE_ALREADY_LINKED', 409, '这条反馈已经关联 GitHub Issue。');
      const row = (await client.query(
        `UPDATE creator_feedback SET status='issue_drafted',updated_at=now() WHERE id=$1
         RETURNING *, $2::text AS work_title, $3::text AS repository_url`,
        [feedbackId, current.work_title, current.repository_url],
      )).rows[0];
      await appendEvent(client, { eventId, feedbackId, actorUserId: actor.userId, action: 'issue_drafted' });
      return feedbackView(row);
    });
  }

  async update({ actor, feedbackId, action, issueUrl, eventId }) {
    return withTransaction(this.pool, async client => {
      const current = await lockFeedback(client, feedbackId, actor.userId);
      const transitions = {
        review: { from: ['new','issue_drafted'], status: 'reviewed', event: 'reviewed' },
        archive: { from: ['new','reviewed','issue_drafted','issue_linked','resolved'], status: 'archived', event: 'archived' },
        reopen: { from: ['archived','resolved'], status: 'reviewed', event: 'reopened' },
        link_issue: { from: ['new','reviewed','issue_drafted'], status: 'issue_linked', event: 'issue_linked' },
      };
      const transition = transitions[action];
      if (!transition.from.includes(current.status)) throw new CreatorFeedbackError('FEEDBACK_STATE_CONFLICT', 409, '反馈当前状态不允许执行这个操作。');
      if (action === 'link_issue' && !issueUrlMatches(issueUrl, githubRepository(current.repository_url))) throw new CreatorFeedbackError('ISSUE_URL_INVALID', 400, 'Issue 地址必须属于该作品关联的 GitHub 仓库。');
      const nextStatus = action === 'reopen' && current.issue_url ? 'issue_linked' : transition.status;
      const row = (await client.query(
        `UPDATE creator_feedback SET status=$2,issue_url=CASE WHEN $3::text IS NULL THEN issue_url ELSE $3 END,updated_at=now()
         WHERE id=$1 RETURNING *, $4::text AS work_title, $5::text AS repository_url`,
        [feedbackId, nextStatus, issueUrl, current.work_title, current.repository_url],
      )).rows[0];
      await appendEvent(client, { eventId, feedbackId, actorUserId: actor.userId, action: transition.event, details: issueUrl ? { issueUrl } : {} });
      return feedbackView(row);
    });
  }
}

const githubRepository = repositoryUrl => {
  if (!repositoryUrl) return null;
  try {
    const url = new URL(repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const name = parts[1].replace(/\.git$/i, '');
    if (!name) return null;
    return { owner: parts[0], name, repositoryUrl: `https://github.com/${parts[0]}/${name}` };
  } catch { return null; }
};

const issueUrlMatches = (issueUrl, repository) => {
  if (!repository) return false;
  try {
    const url = new URL(issueUrl);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash && parts.length === 4
      && parts[0].toLowerCase() === repository.owner.toLowerCase()
      && parts[1].toLowerCase() === repository.name.toLowerCase()
      && parts[2] === 'issues' && /^[1-9][0-9]*$/.test(parts[3]);
  } catch { return false; }
};

export function createCreatorFeedbackService({ repository, ids = () => crypto.randomUUID() }) {
  const requireUser = actor => { if (!actor?.userId) throw new CreatorFeedbackError('UNAUTHORIZED', 401, '请先登录。'); };
  const requireCreator = actor => {
    requireUser(actor);
    if (!actor.profile?.canPublish || !actor.scopes?.includes('works:read')) throw new CreatorFeedbackError('CREATOR_REQUIRED', 403, '需要创作者权限。');
  };
  const clean = (value, max) => String(value ?? '').trim().slice(0, max + 1);
  return Object.freeze({
    async submit(actor, workId, body = {}) {
      requireUser(actor);
      if (!uuidPattern.test(workId)) throw new CreatorFeedbackError('FEEDBACK_UNAVAILABLE', 409, '官方内置作品暂不支持作者反馈。');
      if (!categories.has(body.category)) throw new CreatorFeedbackError('CATEGORY_INVALID', 400, '请选择有效的反馈类型。');
      const summary = clean(body.summary, 160); const details = clean(body.details, 2000);
      const reproductionSteps = clean(body.reproductionSteps, 2000); const environment = clean(body.environment, 500);
      if (summary.length < 5 || summary.length > 160) throw new CreatorFeedbackError('SUMMARY_INVALID', 400, '反馈标题需要 5 到 160 个字符。');
      if (details.length < 10 || details.length > 2000) throw new CreatorFeedbackError('DETAILS_INVALID', 400, '详细说明需要 10 到 2000 个字符。');
      if (reproductionSteps.length > 2000 || environment.length > 500) throw new CreatorFeedbackError('FEEDBACK_TOO_LONG', 400, '反馈内容超过长度限制。');
      return repository.create({ actor, workId, category: body.category, summary, details, reproductionSteps, environment, feedbackId: ids(), eventId: ids() });
    },
    list(actor, query = {}) {
      requireCreator(actor);
      const status = query.status || 'all';
      if (status !== 'all' && !statuses.has(status)) throw new CreatorFeedbackError('STATUS_INVALID', 400, '无效的反馈状态。');
      return repository.listForCreator({ actor, status: status === 'all' ? null : status, limit: Math.min(100, Math.max(1, Number(query.limit) || 50)) });
    },
    async issueDraft(actor, feedbackId) {
      requireCreator(actor);
      if (!uuidPattern.test(feedbackId)) throw new CreatorFeedbackError('FEEDBACK_NOT_FOUND', 404, '反馈不存在。');
      const feedback = await repository.issueDrafted({ actor, feedbackId, eventId: ids() });
      const categoryLabels = { bug: '问题', idea: '建议', compatibility: '兼容性', other: '反馈' };
      const title = `[玩家${categoryLabels[feedback.category]}] ${feedback.summary}`;
      const body = [`## 玩家反馈`, '', `- 类型：${categoryLabels[feedback.category]}`, `- GameHub 作品：${feedback.workTitle}`, '', '### 详细说明', feedback.details];
      if (feedback.reproductionSteps) body.push('', '### 复现步骤', feedback.reproductionSteps);
      if (feedback.environment) body.push('', '### 运行环境', feedback.environment);
      body.push('', '---', '由作品作者从 GameHub 反馈收件箱确认后生成；提交前请检查并移除不应公开的信息。');
      const repositoryInfo = githubRepository(feedback.repositoryUrl);
      const issueBody = body.join('\n');
      return {
        feedbackId: feedback.id, title, body: issueBody, markdown: `# ${title}\n\n${issueBody}`,
        repositoryUrl: repositoryInfo?.repositoryUrl ?? null,
        createUrl: repositoryInfo ? `${repositoryInfo.repositoryUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}` : null,
      };
    },
    async update(actor, feedbackId, body = {}) {
      requireCreator(actor);
      if (!uuidPattern.test(feedbackId)) throw new CreatorFeedbackError('FEEDBACK_NOT_FOUND', 404, '反馈不存在。');
      if (!actions.has(body.action)) throw new CreatorFeedbackError('ACTION_INVALID', 400, '无效的反馈操作。');
      let issueUrl = null;
      if (body.action === 'link_issue') {
        issueUrl = clean(body.issueUrl, 2048);
        if (!issueUrl) throw new CreatorFeedbackError('ISSUE_URL_REQUIRED', 400, '请填写 GitHub Issue 地址。');
        const current = await repository.getForCreator({ actor, feedbackId });
        if (!current) throw new CreatorFeedbackError('FEEDBACK_NOT_FOUND', 404, '反馈不存在，或不属于你的作品。');
        if (!issueUrlMatches(issueUrl, githubRepository(current.repositoryUrl))) throw new CreatorFeedbackError('ISSUE_URL_INVALID', 400, 'Issue 地址必须属于该作品关联的 GitHub 仓库。');
      }
      return repository.update({ actor, feedbackId, action: body.action, issueUrl, eventId: ids() });
    },
  });
}
