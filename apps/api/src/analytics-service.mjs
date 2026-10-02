import crypto from 'node:crypto';

export class AnalyticsError extends Error {
  constructor(code, statusCode, message) {
    super(message); this.name = 'AnalyticsError'; this.code = code; this.statusCode = statusCode; this.retryable = false;
  }
}

const EVENT_TYPES = new Set(['page_view','session_ping','work_view','download_start','download_complete','game_start','game_end']);
const HOST_KINDS = new Set(['browser','cursor','vscode','code','harness','codex','claude','opencode','unknown']);
const ROUTES = new Set(['discover','library','social','creator','admin','work','play','auth','settings','unknown']);
const WORK_KEY = /^(?:gamehub-[a-z0-9-]{1,100}|[0-9a-fA-F-]{36})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalid = message => { throw new AnalyticsError('ANALYTICS_INVALID', 400, message); };
const rangeFor = (clock, input, fallback = 7) => {
  const days = Number(input.days ?? fallback);
  if (![7, 30, 90].includes(days)) invalid('统计周期无效。');
  const now = clock();
  const chinaNow = new Date(now.getTime() + 8 * 3_600_000);
  chinaNow.setUTCHours(0, 0, 0, 0);
  const since = new Date(chinaNow.getTime() - 8 * 3_600_000 - (days - 1) * 86_400_000);
  return { days, now, since };
};

export function createAnalyticsService({ repository, clock = () => new Date(), ids = () => crypto.randomUUID() }) {
  return {
    async record(actor, input) {
      if (!Array.isArray(input?.events) || input.events.length < 1 || input.events.length > 20) invalid('每批需包含 1 到 20 条事件。');
      const now = clock();
      const events = input.events.map(event => {
        if (!event || !EVENT_TYPES.has(event.type)) invalid('统计事件类型无效。');
        if (!UUID.test(event.anonymousId ?? '') || !UUID.test(event.sessionId ?? '')) invalid('匿名会话标识无效。');
        const hostKind = HOST_KINDS.has(event.hostKind) ? event.hostKind : 'unknown';
        const route = event.route == null ? null : (ROUTES.has(event.route) ? event.route : 'unknown');
        const workKey = event.workId == null ? null : String(event.workId);
        if (workKey && !WORK_KEY.test(workKey)) invalid('作品标识无效。');
        const releaseId = event.releaseId == null ? null : String(event.releaseId);
        if (releaseId && !UUID.test(releaseId)) invalid('版本标识无效。');
        const durationMs = event.durationMs == null ? null : Number(event.durationMs);
        if (durationMs != null && (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 600000)) invalid('时长数据无效。');
        const suppliedAt = new Date(event.occurredAt);
        const occurredAt = Number.isFinite(suppliedAt.getTime()) && Math.abs(suppliedAt.getTime() - now.getTime()) <= 86_400_000 ? suppliedAt : now;
        return { id: ids(), userId: actor?.userId ?? null, anonymousId: event.anonymousId, sessionId: event.sessionId, type: event.type, route, workKey, releaseId, hostKind, durationMs, occurredAt, receivedAt: now };
      });
      await repository.insert(events);
      return { accepted: events.length };
    },

    async overview(actor, input = {}) {
      if (actor?.profile?.role !== 'admin') throw new AnalyticsError('ADMIN_REQUIRED', 403, '需要管理员权限。');
      return repository.overview(rangeFor(clock, input));
    },

    async creatorOverview(actor, input = {}) {
      if (!actor?.profile?.canPublish || !actor?.scopes?.includes('works:read')) throw new AnalyticsError('CREATOR_REQUIRED', 403, '需要创作者权限。');
      return repository.creatorOverview({ userId: actor.userId, ...rangeFor(clock, input, 30) });
    },
  };
}
