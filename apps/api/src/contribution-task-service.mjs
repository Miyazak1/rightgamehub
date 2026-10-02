import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const difficulties = new Set(['starter', 'intermediate', 'advanced']);
const creatorActions = new Set(['publish', 'close', 'reopen', 'complete', 'request_changes', 'link_issue']);

export class ContributionTaskError extends Error {
  constructor(code, statusCode, message) { super(message); this.name = 'ContributionTaskError'; this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500; }
}

const publicUrl = value => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host === '[::1]' || host.endsWith('.local') || host.endsWith('.internal') || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return url.toString();
  } catch { return null; }
};

const githubRepository = repositoryUrl => {
  const normalized = publicUrl(repositoryUrl);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.hostname !== 'github.com' || url.search || url.hash) return null;
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const name = parts[1].replace(/\.git$/i, '');
  return name ? { owner: parts[0], name, url: `https://github.com/${parts[0]}/${name}` } : null;
};

const issueUrlMatches = (issueUrl, repositoryUrl) => {
  const repository = githubRepository(repositoryUrl); const normalized = publicUrl(issueUrl);
  if (!repository || !normalized) return false;
  const url = new URL(normalized); const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  return url.hostname === 'github.com' && !url.search && !url.hash && parts.length === 4
    && parts[0].toLowerCase() === repository.owner.toLowerCase() && parts[1].toLowerCase() === repository.name.toLowerCase()
    && parts[2] === 'issues' && /^[1-9][0-9]*$/.test(parts[3]);
};

const taskView = row => ({
  id: row.id, workId: row.work_id, workTitle: row.work_title, feedbackId: row.feedback_id,
  title: row.title, description: row.description, difficulty: row.difficulty, skills: row.skills ?? [], status: row.status,
  repositoryUrl: row.repository_url, issueUrl: row.issue_url, submissionUrl: row.submission_url, submissionNote: row.submission_note,
  author: { id: row.author_user_id, handle: row.author_handle, displayName: row.author_display_name },
  claimant: row.claimant_user_id ? { id: row.claimant_user_id, handle: row.claimant_handle, displayName: row.claimant_display_name } : null,
  publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
  submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
  completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
});

const taskSelect = `SELECT t.*,w.title AS work_title,a.profile_handle AS author_handle,a.display_name AS author_display_name,
  c.profile_handle AS claimant_handle,c.display_name AS claimant_display_name
  FROM contribution_tasks t JOIN works w ON w.id=t.work_id JOIN users a ON a.id=t.author_user_id
  LEFT JOIN users c ON c.id=t.claimant_user_id`;

const appendEvent = (client, { id, taskId, actorUserId, action, details = {} }) => client.query(
  'INSERT INTO contribution_task_events(id,task_id,actor_user_id,action,details) VALUES ($1,$2,$3,$4,$5)',
  [id, taskId, actorUserId, action, details],
);

const lockTask = async (client, taskId) => {
  const row = (await client.query(`${taskSelect} WHERE t.id=$1 FOR UPDATE OF t,w`, [taskId])).rows[0];
  if (!row) throw new ContributionTaskError('CONTRIBUTION_TASK_NOT_FOUND', 404, '贡献任务不存在。');
  return row;
};

export class PostgresContributionTaskRepository {
  constructor(pool) { this.pool = pool; }

  async createFromFeedback(input) {
    return withTransaction(this.pool, async client => {
      const source = (await client.query(
        `SELECT f.id AS feedback_id,f.status AS feedback_status,f.issue_url,w.id AS work_id,w.title AS work_title,w.repository_url,w.owner_user_id,w.state,w.visibility,
          u.profile_handle AS author_handle,u.display_name AS author_display_name
         FROM creator_feedback f JOIN works w ON w.id=f.work_id JOIN users u ON u.id=w.owner_user_id
         WHERE f.id=$1 AND w.owner_user_id=$2 FOR UPDATE OF f,w`,
        [input.feedbackId, input.actor.userId],
      )).rows[0];
      if (!source) throw new ContributionTaskError('FEEDBACK_NOT_FOUND', 404, '反馈不存在，或不属于你的作品。');
      if (!['reviewed','issue_drafted','issue_linked'].includes(source.feedback_status)) throw new ContributionTaskError('FEEDBACK_NOT_CONFIRMED', 409, '请先将反馈标记为已查看，再创建公开贡献任务。');
      if (source.state !== 'published' || source.visibility !== 'public') throw new ContributionTaskError('WORK_NOT_PUBLIC', 409, '只有公开发布的作品可以创建贡献任务。');
      try {
        const row = (await client.query(
          `INSERT INTO contribution_tasks(id,work_id,feedback_id,author_user_id,title,description,difficulty,skills,repository_url,issue_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *, $11::text AS work_title,$12::text AS author_handle,$13::text AS author_display_name,
             NULL::text AS claimant_handle,NULL::text AS claimant_display_name`,
          [input.taskId, source.work_id, source.feedback_id, input.actor.userId, input.title, input.description, input.difficulty, input.skills, source.repository_url, source.issue_url, source.work_title, source.author_handle, source.author_display_name],
        )).rows[0];
        await appendEvent(client, { id: input.eventId, taskId: row.id, actorUserId: input.actor.userId, action: 'draft_created', details: { feedbackId: source.feedback_id } });
        return taskView(row);
      } catch (error) {
        if (error?.code === '23505') throw new ContributionTaskError('CONTRIBUTION_TASK_EXISTS', 409, '这条反馈已经创建过贡献任务。');
        throw error;
      }
    });
  }

  async listForCreator(actor, limit) {
    const rows = (await this.pool.query(`${taskSelect} WHERE t.author_user_id=$1 ORDER BY t.updated_at DESC,t.id DESC LIMIT $2`, [actor.userId, limit])).rows;
    return rows.map(taskView);
  }

  async listPublic(status, limit, viewerId = null) {
    const allowed = status === 'all' ? ['open','claimed','submitted','completed'] : [status];
    const rows = (await this.pool.query(
      `${taskSelect} WHERE t.status=ANY($1::text[]) AND w.state='published' AND w.visibility='public'
       ORDER BY CASE WHEN t.status='open' THEN 0 WHEN t.status='claimed' THEN 1 WHEN t.status='submitted' THEN 2 ELSE 3 END,t.published_at DESC,t.id DESC LIMIT $2`,
      [allowed, limit],
    )).rows;
    return rows.map(row => {
      const task = taskView(row); const completed = task.status === 'completed'; const mine = task.claimant?.id === viewerId;
      return { ...task, feedbackId: null, claimant: completed || mine ? task.claimant : null, submissionUrl: completed || mine ? task.submissionUrl : null, submissionNote: mine ? task.submissionNote : '' };
    });
  }

  async creatorAction(input) {
    return withTransaction(this.pool, async client => {
      const current = await lockTask(client, input.taskId);
      if (current.author_user_id !== input.actor.userId) throw new ContributionTaskError('CONTRIBUTION_TASK_NOT_FOUND', 404, '贡献任务不存在，或不属于你的作品。');
      const transitions = {
        publish: { from: ['draft'], status: 'open', event: 'published' },
        close: { from: ['draft','open','claimed','submitted'], status: 'closed', event: 'closed' },
        reopen: { from: ['closed'], status: 'open', event: 'reopened' },
        complete: { from: ['submitted'], status: 'completed', event: 'completed' },
        request_changes: { from: ['submitted'], status: 'claimed', event: 'changes_requested' },
        link_issue: { from: ['draft','open','claimed','submitted'], status: current.status, event: 'issue_linked' },
      };
      const transition = transitions[input.action];
      if (!transition.from.includes(current.status)) throw new ContributionTaskError('CONTRIBUTION_TASK_STATE_CONFLICT', 409, '任务当前状态不允许执行这个操作。');
      if (input.action === 'link_issue' && !issueUrlMatches(input.issueUrl, current.repository_url)) throw new ContributionTaskError('ISSUE_URL_INVALID', 400, 'Issue 地址必须属于该作品关联的 GitHub 仓库。');
      if (input.action === 'publish' && (!current.repository_url || !githubRepository(current.repository_url))) throw new ContributionTaskError('REPOSITORY_REQUIRED', 409, '公开贡献任务需要作品关联公开 GitHub 仓库。');
      const clearClaim = ['close','reopen'].includes(input.action);
      const row = (await client.query(
        `UPDATE contribution_tasks SET status=$2,
          claimant_user_id=CASE WHEN $3 THEN NULL ELSE claimant_user_id END,
          issue_url=CASE WHEN $4::text IS NULL THEN issue_url ELSE $4 END,
          submission_url=CASE WHEN $3 THEN NULL ELSE submission_url END,
          submission_note=CASE WHEN $3 THEN '' ELSE submission_note END,
          published_at=CASE WHEN $5 THEN COALESCE(published_at,now()) ELSE published_at END,
          claimed_at=CASE WHEN $3 THEN NULL ELSE claimed_at END,
          submitted_at=CASE WHEN $3 OR $6 THEN NULL ELSE submitted_at END,
          completed_at=CASE WHEN $7 THEN now() ELSE completed_at END,
          closed_at=CASE WHEN $8 THEN now() WHEN $2='open' THEN NULL ELSE closed_at END,
          updated_at=now() WHERE id=$1
          RETURNING *,$9::text AS work_title,$10::text AS author_handle,$11::text AS author_display_name,
            NULL::text AS claimant_handle,NULL::text AS claimant_display_name`,
        [input.taskId, transition.status, clearClaim, input.issueUrl, ['publish','reopen'].includes(input.action), input.action === 'request_changes', input.action === 'complete', input.action === 'close', current.work_title, current.author_handle, current.author_display_name],
      )).rows[0];
      if (!clearClaim && current.claimant_user_id) { row.claimant_handle = current.claimant_handle; row.claimant_display_name = current.claimant_display_name; }
      await appendEvent(client, { id: input.eventId, taskId: row.id, actorUserId: input.actor.userId, action: transition.event, details: input.issueUrl ? { issueUrl: input.issueUrl } : {} });
      return taskView(row);
    });
  }

  async claim(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contribution-claim:${input.actor.userId}`]);
      const current = await lockTask(client, input.taskId);
      if (current.status !== 'open') throw new ContributionTaskError('CONTRIBUTION_TASK_UNAVAILABLE', 409, '这个任务已经不能认领。');
      if (current.author_user_id === input.actor.userId) throw new ContributionTaskError('OWN_TASK_CLAIM', 409, '作者不能认领自己的贡献任务。');
      const active = Number((await client.query("SELECT count(*)::int AS count FROM contribution_tasks WHERE claimant_user_id=$1 AND status IN ('claimed','submitted')", [input.actor.userId])).rows[0].count);
      if (active >= 3) throw new ContributionTaskError('CONTRIBUTION_CLAIM_LIMIT', 429, '你最多同时认领 3 个贡献任务。');
      await client.query(
        "UPDATE contribution_tasks SET status='claimed',claimant_user_id=$2,claimed_at=now(),updated_at=now() WHERE id=$1",
        [input.taskId, input.actor.userId],
      );
      const row = await lockTask(client, input.taskId);
      await appendEvent(client, { id: input.eventId, taskId: row.id, actorUserId: input.actor.userId, action: 'claimed' });
      return taskView(row);
    });
  }

  async contributorAction(input) {
    return withTransaction(this.pool, async client => {
      const current = await lockTask(client, input.taskId);
      if (current.claimant_user_id !== input.actor.userId) throw new ContributionTaskError('CONTRIBUTION_TASK_NOT_CLAIMED', 403, '只有当前认领者可以执行这个操作。');
      if (input.action === 'release' && current.status !== 'claimed') throw new ContributionTaskError('CONTRIBUTION_TASK_STATE_CONFLICT', 409, '只有进行中的任务可以取消认领。');
      if (input.action === 'submit' && current.status !== 'claimed') throw new ContributionTaskError('CONTRIBUTION_TASK_STATE_CONFLICT', 409, '任务当前不能提交成果。');
      const releasing = input.action === 'release';
      await client.query(
        `UPDATE contribution_tasks SET status=$2,claimant_user_id=CASE WHEN $3 THEN NULL ELSE claimant_user_id END,
          submission_url=CASE WHEN $3 THEN NULL ELSE $4 END,submission_note=CASE WHEN $3 THEN '' ELSE $5 END,
          claimed_at=CASE WHEN $3 THEN NULL ELSE claimed_at END,submitted_at=CASE WHEN $3 THEN NULL ELSE now() END,updated_at=now()
          WHERE id=$1`,
        [input.taskId, releasing ? 'open' : 'submitted', releasing, input.submissionUrl, input.submissionNote],
      );
      const row = await lockTask(client, input.taskId);
      await appendEvent(client, { id: input.eventId, taskId: row.id, actorUserId: input.actor.userId, action: releasing ? 'released' : 'submitted', details: input.submissionUrl ? { submissionUrl: input.submissionUrl } : {} });
      return taskView(row);
    });
  }

  async recordIssueDraft(input) {
    return withTransaction(this.pool, async client => {
      const current = await lockTask(client, input.taskId);
      if (current.author_user_id !== input.actor.userId) throw new ContributionTaskError('CONTRIBUTION_TASK_NOT_FOUND', 404, '贡献任务不存在，或不属于你的作品。');
      if (current.status === 'closed') throw new ContributionTaskError('CONTRIBUTION_TASK_STATE_CONFLICT', 409, '已关闭任务不能生成 Issue 草稿。');
      await appendEvent(client, { id: input.eventId, taskId: current.id, actorUserId: input.actor.userId, action: 'issue_drafted' });
      return taskView(current);
    });
  }
}

export function createContributionTaskService({ repository, ids = () => crypto.randomUUID() }) {
  const requireUser = actor => { if (!actor?.userId) throw new ContributionTaskError('UNAUTHORIZED', 401, '请先登录。'); };
  const requireCreator = actor => { requireUser(actor); if (!actor.profile?.canPublish || !actor.scopes?.includes('works:read')) throw new ContributionTaskError('CREATOR_REQUIRED', 403, '需要创作者权限。'); };
  const clean = (value, max) => String(value ?? '').trim().slice(0, max + 1);
  const taskId = value => { if (!uuidPattern.test(value)) throw new ContributionTaskError('CONTRIBUTION_TASK_NOT_FOUND', 404, '贡献任务不存在。'); };
  return Object.freeze({
    createFromFeedback(actor, feedbackId, body = {}) {
      requireCreator(actor); taskId(feedbackId);
      const title = clean(body.title, 160); const description = clean(body.description, 4000);
      const skills = Array.isArray(body.skills) ? [...new Set(body.skills.map(value => clean(value, 30)).filter(Boolean))] : [];
      if (title.length < 5 || title.length > 160 || description.length < 20 || description.length > 4000) throw new ContributionTaskError('CONTRIBUTION_TASK_INVALID', 400, '任务标题至少 5 个字，说明至少 20 个字。');
      if (!difficulties.has(body.difficulty) || skills.length > 8 || skills.some(skill => skill.length > 30)) throw new ContributionTaskError('CONTRIBUTION_TASK_INVALID', 400, '任务难度或技能标签无效。');
      return repository.createFromFeedback({ actor, feedbackId, title, description, difficulty: body.difficulty, skills, taskId: ids(), eventId: ids() });
    },
    listForCreator(actor, query = {}) { requireCreator(actor); return repository.listForCreator(actor, Math.min(100, Math.max(1, Number(query.limit) || 50))); },
    listPublic(actor, query = {}) {
      const status = query.status || 'all';
      if (!['all','open','claimed','submitted','completed'].includes(status)) throw new ContributionTaskError('STATUS_INVALID', 400, '无效的任务状态。');
      return repository.listPublic(status, Math.min(100, Math.max(1, Number(query.limit) || 50)), actor?.userId ?? null);
    },
    creatorAction(actor, id, body = {}) {
      requireCreator(actor); taskId(id);
      if (!creatorActions.has(body.action)) throw new ContributionTaskError('ACTION_INVALID', 400, '无效的任务操作。');
      let issueUrl = null;
      if (body.action === 'link_issue') { issueUrl = clean(body.issueUrl, 2048); if (!issueUrl) throw new ContributionTaskError('ISSUE_URL_REQUIRED', 400, '请填写 GitHub Issue 地址。'); }
      return repository.creatorAction({ actor, taskId: id, action: body.action, issueUrl, eventId: ids() });
    },
    claim(actor, id) { requireUser(actor); taskId(id); return repository.claim({ actor, taskId: id, eventId: ids() }); },
    release(actor, id) { requireUser(actor); taskId(id); return repository.contributorAction({ actor, taskId: id, action: 'release', submissionUrl: null, submissionNote: '', eventId: ids() }); },
    submit(actor, id, body = {}) {
      requireUser(actor); taskId(id);
      const submissionUrl = publicUrl(clean(body.url, 2048)); const submissionNote = clean(body.note, 2000);
      if (!submissionUrl || submissionNote.length < 5 || submissionNote.length > 2000) throw new ContributionTaskError('SUBMISSION_INVALID', 400, '请填写公开 HTTPS 成果地址和至少 5 个字的说明。');
      return repository.contributorAction({ actor, taskId: id, action: 'submit', submissionUrl, submissionNote, eventId: ids() });
    },
    async issueDraft(actor, id) {
      requireCreator(actor); taskId(id);
      const task = await repository.recordIssueDraft({ actor, taskId: id, eventId: ids() });
      const repositoryInfo = githubRepository(task.repositoryUrl);
      const body = [`## 新手贡献任务`, '', task.description, '', `- 难度：${task.difficulty}`, `- 技能：${task.skills.length ? task.skills.join('、') : '不限'}`, `- GameHub 作品：${task.workTitle}`, '', '---', '由作品作者从 GameHub 贡献任务中确认后生成；请在 GitHub 提交前再次检查内容。'].join('\n');
      const title = `[Good first issue] ${task.title}`;
      return { taskId: task.id, title, body, repositoryUrl: repositoryInfo?.url ?? null, createUrl: repositoryInfo ? `${repositoryInfo.url}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('good first issue')}` : null };
    },
  });
}
