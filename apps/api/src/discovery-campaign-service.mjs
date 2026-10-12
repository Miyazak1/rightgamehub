import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const slugPattern = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const kinds = new Set(['weekly_open_game', 'improve_together', 'collection']);
const iso = value => value ? new Date(value).toISOString() : null;

export class DiscoveryCampaignError extends Error {
  constructor(code, statusCode, message) {
    super(message); this.name = 'DiscoveryCampaignError'; this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500;
  }
}

const fail = (code, status, message) => { throw new DiscoveryCampaignError(code, status, message); };
const view = row => ({
  id: row.id,
  slug: row.slug,
  eyebrow: row.eyebrow,
  title: row.title,
  summary: row.summary,
  campaignKind: row.campaign_kind,
  publicationState: row.publication_state,
  startsAt: iso(row.starts_at),
  endsAt: iso(row.ends_at),
  version: Number(row.version),
  publishedAt: iso(row.published_at),
  archivedAt: iso(row.archived_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  items: row.items ?? [],
});

async function readCampaign(client, where, values) {
  const row = (await client.query(
    `SELECT c.*,COALESCE(jsonb_agg(jsonb_build_object('workId',i.work_id,'pitch',i.pitch,'position',i.position)
       ORDER BY i.position) FILTER (WHERE i.work_id IS NOT NULL),'[]'::jsonb) AS items
       FROM discovery_campaigns c LEFT JOIN discovery_campaign_items i ON i.campaign_id=c.id
      WHERE ${where} GROUP BY c.id`, values,
  )).rows[0];
  return row ? view(row) : null;
}

async function validateWorks(client, items) {
  if (!items.length) fail('DISCOVERY_CAMPAIGN_EMPTY', 409, '专题至少需要一个当前可玩的公开作品。');
  const ids = items.map(item => item.workId);
  const count = Number((await client.query(
    `SELECT count(DISTINCT w.id)::int AS count FROM works w
      WHERE w.id=ANY($1::uuid[]) AND w.state='published' AND w.visibility='public'
        AND EXISTS(SELECT 1 FROM work_targets t JOIN releases r ON r.id=t.current_release_id
          WHERE t.work_id=w.id AND t.state='published' AND r.validation_state='ready' AND r.serving_state='enabled')`,
    [ids],
  )).rows[0].count);
  if (count !== ids.length) fail('DISCOVERY_CAMPAIGN_WORK_INVALID', 409, '专题只能包含当前公开且可运行的作品。');
}

async function replaceItems(client, campaignId, items) {
  await client.query('DELETE FROM discovery_campaign_items WHERE campaign_id=$1', [campaignId]);
  for (const [position, item] of items.entries()) await client.query(
    'INSERT INTO discovery_campaign_items(campaign_id,work_id,position,pitch) VALUES($1,$2,$3,$4)',
    [campaignId, item.workId, position, item.pitch],
  );
}

async function appendEvent(client, input, action) {
  await client.query(
    'INSERT INTO discovery_campaign_events(id,campaign_id,actor_user_id,action,details) VALUES($1,$2,$3,$4,$5)',
    [input.eventId, input.campaignId, input.actor.userId, action, { version: input.expectedVersion ?? 1 }],
  );
}

export class PostgresDiscoveryCampaignRepository {
  constructor(pool) { this.pool = pool; }

  async listPublic(limit) {
    const ids = (await this.pool.query(
      `SELECT id FROM discovery_campaigns WHERE publication_state='published'
        AND (starts_at IS NULL OR starts_at<=clock_timestamp()) AND (ends_at IS NULL OR ends_at>clock_timestamp())
       ORDER BY starts_at DESC NULLS LAST,published_at DESC,id DESC LIMIT $1`, [limit],
    )).rows;
    return Promise.all(ids.map(row => readCampaign(this.pool, 'c.id=$1', [row.id])));
  }

  getPublic(slug) {
    return readCampaign(this.pool,
      `c.slug=$1 AND c.publication_state='published' AND (c.starts_at IS NULL OR c.starts_at<=clock_timestamp())
       AND (c.ends_at IS NULL OR c.ends_at>clock_timestamp())`, [slug]);
  }

  async listAdmin() {
    const ids = (await this.pool.query('SELECT id FROM discovery_campaigns ORDER BY updated_at DESC,id DESC LIMIT 100')).rows;
    return Promise.all(ids.map(row => readCampaign(this.pool, 'c.id=$1', [row.id])));
  }

  async create(input) {
    return withTransaction(this.pool, async client => {
      await validateWorks(client, input.items);
      try {
        await client.query(
          `INSERT INTO discovery_campaigns(id,slug,eyebrow,title,summary,campaign_kind,starts_at,ends_at,created_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [input.campaignId,input.slug,input.eyebrow,input.title,input.summary,input.campaignKind,input.startsAt,input.endsAt,input.actor.userId],
        );
      } catch (error) {
        if (error.code === '23505') fail('DISCOVERY_CAMPAIGN_SLUG_TAKEN', 409, '这个专题地址已经被使用。');
        throw error;
      }
      await replaceItems(client, input.campaignId, input.items);
      await appendEvent(client, input, 'created');
      return readCampaign(client, 'c.id=$1', [input.campaignId]);
    });
  }

  async update(input) {
    return withTransaction(this.pool, async client => {
      const current = (await client.query('SELECT * FROM discovery_campaigns WHERE id=$1 FOR UPDATE', [input.campaignId])).rows[0];
      if (!current) fail('DISCOVERY_CAMPAIGN_NOT_FOUND', 404, '专题不存在。');
      if (Number(current.version) !== input.expectedVersion) fail('DISCOVERY_CAMPAIGN_STALE', 409, '专题已经变化，请刷新后重试。');
      if (input.action === 'edit') {
        if (current.publication_state !== 'draft') fail('DISCOVERY_CAMPAIGN_STATE_CONFLICT', 409, '只有草稿专题可以编辑。');
        await validateWorks(client, input.items);
        try {
          await client.query(
            `UPDATE discovery_campaigns SET slug=$2,eyebrow=$3,title=$4,summary=$5,campaign_kind=$6,starts_at=$7,ends_at=$8,
             version=version+1,updated_at=now() WHERE id=$1`,
            [input.campaignId,input.slug,input.eyebrow,input.title,input.summary,input.campaignKind,input.startsAt,input.endsAt],
          );
        } catch (error) {
          if (error.code === '23505') fail('DISCOVERY_CAMPAIGN_SLUG_TAKEN', 409, '这个专题地址已经被使用。');
          throw error;
        }
        await replaceItems(client, input.campaignId, input.items);
        await appendEvent(client, input, 'edited');
      } else if (input.action === 'publish') {
        if (current.publication_state !== 'draft') fail('DISCOVERY_CAMPAIGN_STATE_CONFLICT', 409, '只有草稿专题可以发布。');
        const items = (await client.query('SELECT work_id AS "workId",pitch,position FROM discovery_campaign_items WHERE campaign_id=$1 ORDER BY position', [input.campaignId])).rows;
        await validateWorks(client, items);
        await client.query("UPDATE discovery_campaigns SET publication_state='published',published_at=now(),version=version+1,updated_at=now() WHERE id=$1", [input.campaignId]);
        await appendEvent(client, input, 'published');
      } else if (input.action === 'archive') {
        if (current.publication_state !== 'published') fail('DISCOVERY_CAMPAIGN_STATE_CONFLICT', 409, '只有已发布专题可以归档。');
        await client.query("UPDATE discovery_campaigns SET publication_state='archived',archived_at=now(),version=version+1,updated_at=now() WHERE id=$1", [input.campaignId]);
        await appendEvent(client, input, 'archived');
      }
      return readCampaign(client, 'c.id=$1', [input.campaignId]);
    });
  }
}

export function createDiscoveryCampaignService({ repository, catalogService, ids = () => crypto.randomUUID(), siteOrigin = 'https://mooyu.fun' }) {
  const requireAdmin = actor => {
    if (!actor?.userId) fail('UNAUTHORIZED', 401, '请先登录。');
    if (actor.profile?.role !== 'admin') fail('ADMIN_REQUIRED', 403, '仅平台管理员可以管理发现专题。');
  };
  const text = (value, min, max, message) => {
    const cleaned = String(value ?? '').trim();
    if (cleaned.length < min || cleaned.length > max) fail('DISCOVERY_CAMPAIGN_INVALID', 400, message);
    return cleaned;
  };
  const date = value => {
    if (value == null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题时间无效。');
    return parsed.toISOString();
  };
  const fields = body => {
    const slug = String(body?.slug ?? '').trim().toLowerCase();
    if (!slugPattern.test(slug)) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题地址需为 4—64 位小写字母、数字和连字符。');
    if (!kinds.has(body?.campaignKind)) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '请选择有效的专题类型。');
    if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 12) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题需要选择 1—12 款作品。');
    const seen = new Set();
    const items = body.items.map(item => {
      if (!uuidPattern.test(item?.workId) || seen.has(item.workId)) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题作品无效或重复。');
      seen.add(item.workId);
      return { workId: item.workId, pitch: text(item.pitch, 5, 160, '每款作品的推荐语需要 5—160 个字符。') };
    });
    const startsAt = date(body.startsAt), endsAt = date(body.endsAt);
    if (startsAt && endsAt && endsAt <= startsAt) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题结束时间必须晚于开始时间。');
    return {
      slug,
      eyebrow: text(body.eyebrow, 2, 40, '专题眉标题需要 2—40 个字符。'),
      title: text(body.title, 5, 80, '专题标题需要 5—80 个字符。'),
      summary: text(body.summary, 20, 300, '专题摘要需要 20—300 个字符。'),
      campaignKind: body.campaignKind,
      startsAt,
      endsAt,
      items,
    };
  };
  const hydrate = async campaign => {
    if (!campaign) return null;
    const items = (await Promise.all(campaign.items.map(async item => {
      const work = await catalogService.get(item.workId).catch(() => null);
      return work ? { ...item, work } : null;
    }))).filter(Boolean);
    return { ...campaign, items, campaignKey: campaign.slug, publicUrl: `${new URL(siteOrigin).origin}/discover/c/${campaign.slug}` };
  };
  return {
    listPublic: async query => {
      const campaigns = await Promise.all((await repository.listPublic(Math.min(12, Math.max(1, Number(query?.limit) || 3)))).map(hydrate));
      return campaigns.filter(campaign => campaign.items.length);
    },
    getPublic: async slug => {
      if (!slugPattern.test(String(slug))) fail('DISCOVERY_CAMPAIGN_NOT_FOUND', 404, '专题不存在或当前不可访问。');
      const campaign = await hydrate(await repository.getPublic(slug));
      if (!campaign || !campaign.items.length) fail('DISCOVERY_CAMPAIGN_NOT_FOUND', 404, '专题不存在或当前不可访问。');
      return campaign;
    },
    listAdmin: async actor => { requireAdmin(actor); return Promise.all((await repository.listAdmin()).map(hydrate)); },
    create: (actor, body) => { requireAdmin(actor); return repository.create({ actor, campaignId: ids(), eventId: ids(), ...fields(body) }).then(hydrate); },
    update: (actor, campaignId, body) => {
      requireAdmin(actor);
      if (!uuidPattern.test(campaignId)) fail('DISCOVERY_CAMPAIGN_NOT_FOUND', 404, '专题不存在。');
      const expectedVersion = Number(body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '缺少当前专题版本。');
      if (!['edit','publish','archive'].includes(body?.action)) fail('DISCOVERY_CAMPAIGN_INVALID', 400, '专题操作无效。');
      const base = { actor, campaignId, eventId: ids(), action: body.action, expectedVersion };
      return repository.update(body.action === 'edit' ? { ...base, ...fields(body) } : base).then(hydrate);
    },
  };
}
