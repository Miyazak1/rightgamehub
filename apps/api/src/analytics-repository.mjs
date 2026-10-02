const number = value => Number(value ?? 0);
const isoDay = value => String(value).slice(0, 10);

export class PostgresAnalyticsRepository {
  constructor(pool) { this.pool = pool; }

  async insert(events) {
    if (!events.length) return;
    const values = []; const rows = [];
    for (const event of events) {
      const offset = values.length;
      values.push(event.id,event.userId,event.anonymousId,event.sessionId,event.type,event.route,event.workKey,event.releaseId,event.hostKind,event.durationMs,event.occurredAt,event.receivedAt);
      rows.push(`(${Array.from({ length: 12 }, (_, index) => `$${offset + index + 1}`).join(',')})`);
    }
    await this.pool.query(
      `INSERT INTO analytics_events(id,user_id,anonymous_id,session_id,event_type,route,work_key,release_id,host_kind,duration_ms,occurred_at,received_at)
       VALUES ${rows.join(',')} ON CONFLICT (id) DO NOTHING`, values,
    );
  }

  async overview({ days, since, now }) {
    const [totals, eventTotals, dailyEvents, dailyUsers, hosts, topWorks] = await Promise.all([
      this.pool.query(
        `SELECT
          (SELECT count(*) FROM users)::int AS total_users,
          (SELECT count(*) FROM users WHERE created_at >= $1)::int AS new_users,
          (SELECT count(DISTINCT user_id) FROM device_grants WHERE last_seen_at >= $1 AND revoked_at IS NULL)::int AS active_accounts,
          (SELECT count(*) FROM works WHERE state='published' AND visibility='public')::int AS published_works,
          (SELECT COALESCE(sum(play_count),0) FROM user_library)::bigint AS recorded_plays,
          (SELECT count(*) FROM user_library WHERE saved_at IS NOT NULL)::int AS library_saves,
          (SELECT count(*) FROM upload_jobs WHERE created_at >= $1)::int AS uploads,
          (SELECT count(*) FROM upload_jobs WHERE created_at >= $1 AND state='succeeded')::int AS upload_successes,
          (SELECT count(*) FROM upload_jobs WHERE created_at >= $1 AND state='failed')::int AS upload_failures`, [since],
      ),
      this.pool.query(
        `SELECT count(DISTINCT anonymous_id)::int AS visitors,
          count(*) FILTER (WHERE event_type='page_view')::int AS page_views,
          count(*) FILTER (WHERE event_type='work_view')::int AS work_views,
          count(*) FILTER (WHERE event_type='download_start')::int AS download_starts,
          count(*) FILTER (WHERE event_type='download_complete')::int AS download_completes,
          count(*) FILTER (WHERE event_type='game_start')::int AS game_starts,
          COALESCE(sum(duration_ms) FILTER (WHERE event_type='session_ping'),0)::bigint AS site_duration_ms,
          COALESCE(sum(duration_ms) FILTER (WHERE event_type='game_end'),0)::bigint AS game_duration_ms
         FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2`, [since, now],
      ),
      this.pool.query(
        `SELECT (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
          count(DISTINCT anonymous_id)::int AS visitors,
          count(*) FILTER (WHERE event_type='page_view')::int AS page_views,
          count(*) FILTER (WHERE event_type='download_start')::int AS downloads,
          count(*) FILTER (WHERE event_type='game_start')::int AS game_starts
         FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY day ORDER BY day`, [since, now],
      ),
      this.pool.query(`SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,count(*)::int AS new_users FROM users WHERE created_at >= $1 AND created_at < $2 GROUP BY day ORDER BY day`, [since, now]),
      this.pool.query(`SELECT host_kind,count(DISTINCT anonymous_id)::int AS visitors,count(*) FILTER (WHERE event_type='page_view')::int AS page_views FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY host_kind ORDER BY visitors DESC,page_views DESC`, [since, now]),
      this.pool.query(
        `WITH event_stats AS (
           SELECT work_key,count(*) FILTER (WHERE event_type='work_view')::int AS views,
             count(*) FILTER (WHERE event_type='game_start')::int AS starts,
             count(*) FILTER (WHERE event_type='download_start')::int AS downloads
           FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 AND work_key IS NOT NULL GROUP BY work_key
         )
         SELECT e.work_key,COALESCE(w.title,CASE WHEN e.work_key='gamehub-guess-baike' THEN '猜百科' ELSE e.work_key END) AS title,e.views,e.starts,e.downloads
         FROM event_stats e LEFT JOIN works w ON w.id::text=e.work_key ORDER BY (e.views+e.starts*2+e.downloads*2) DESC,e.work_key LIMIT 12`, [since, now],
      ),
    ]);
    const daily = new Map();
    for (let index = 0; index < days; index += 1) {
      const day = new Date(now.getTime() - (days - index - 1) * 86_400_000);
      daily.set(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(day), { day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(day), visitors: 0, pageViews: 0, downloads: 0, gameStarts: 0, newUsers: 0 });
    }
    for (const row of dailyEvents.rows) daily.set(isoDay(row.day), { ...(daily.get(isoDay(row.day)) ?? { day: isoDay(row.day), newUsers: 0 }), visitors: number(row.visitors), pageViews: number(row.page_views), downloads: number(row.downloads), gameStarts: number(row.game_starts) });
    for (const row of dailyUsers.rows) daily.set(isoDay(row.day), { ...(daily.get(isoDay(row.day)) ?? { day: isoDay(row.day), visitors: 0, pageViews: 0, downloads: 0, gameStarts: 0 }), newUsers: number(row.new_users) });
    const base = totals.rows[0]; const events = eventTotals.rows[0];
    return {
      range: { days, since: since.toISOString(), until: now.toISOString() },
      totals: {
        totalUsers: number(base.total_users), newUsers: number(base.new_users), activeAccounts: number(base.active_accounts), publishedWorks: number(base.published_works),
        recordedPlays: number(base.recorded_plays), librarySaves: number(base.library_saves), uploads: number(base.uploads), uploadSuccesses: number(base.upload_successes), uploadFailures: number(base.upload_failures),
        visitors: number(events.visitors), pageViews: number(events.page_views), workViews: number(events.work_views), downloadStarts: number(events.download_starts), downloadCompletes: number(events.download_completes), gameStarts: number(events.game_starts), siteDurationMs: number(events.site_duration_ms), gameDurationMs: number(events.game_duration_ms),
      },
      daily: [...daily.values()],
      hosts: hosts.rows.map(row => ({ hostKind: row.host_kind, visitors: number(row.visitors), pageViews: number(row.page_views) })),
      works: topWorks.rows.map(row => ({ workId: row.work_key, title: row.title, views: number(row.views), starts: number(row.starts), downloads: number(row.downloads) })),
      measurement: { timeZone: 'Asia/Shanghai', siteDuration: 'foreground heartbeat estimate', browserDownloads: 'request only', managedDownloads: 'completion acknowledged by Agent' },
    };
  }

  async creatorOverview({ userId, days, since, now }) {
    const [workStats, dailyEvents] = await Promise.all([
      this.pool.query(
        `WITH owned AS (
           SELECT id,title,state FROM works WHERE owner_user_id=$1
         ), event_stats AS (
           SELECT a.work_key,
             count(*) FILTER (WHERE a.event_type='work_view')::int AS views,
             count(*) FILTER (WHERE a.event_type='game_start')::int AS starts,
             count(*) FILTER (WHERE a.event_type='game_end' AND a.duration_ms >= 30000)::int AS engaged_sessions
           FROM analytics_events a JOIN owned o ON o.id::text=a.work_key
           WHERE a.occurred_at >= $2 AND a.occurred_at < $3 GROUP BY a.work_key
         ), repeaters AS (
           SELECT work_key,count(*)::int AS repeat_players FROM (
             SELECT a.work_key,a.anonymous_id
             FROM analytics_events a JOIN owned o ON o.id::text=a.work_key
             WHERE a.occurred_at >= $2 AND a.occurred_at < $3 AND a.event_type='game_start'
             GROUP BY a.work_key,a.anonymous_id HAVING count(*) >= 2
           ) repeated GROUP BY work_key
         ), saves AS (
           SELECT l.work_key,count(*) FILTER (WHERE l.saved_at IS NOT NULL)::int AS saves
           FROM user_library l JOIN owned o ON o.id::text=l.work_key GROUP BY l.work_key
         ), builds AS (
           SELECT b.work_id,count(*)::int AS builds,
             count(*) FILTER (WHERE b.state='ready')::int AS successful_builds
           FROM build_jobs b JOIN owned o ON o.id=b.work_id
           WHERE b.created_at >= $2 AND b.created_at < $3 GROUP BY b.work_id
         )
         SELECT o.id::text AS work_id,o.title,o.state,
           COALESCE(e.views,0)::int AS views,COALESCE(e.starts,0)::int AS starts,
           COALESCE(e.engaged_sessions,0)::int AS engaged_sessions,COALESCE(r.repeat_players,0)::int AS repeat_players,
           COALESCE(s.saves,0)::int AS saves,COALESCE(b.builds,0)::int AS builds,
           COALESCE(b.successful_builds,0)::int AS successful_builds
         FROM owned o LEFT JOIN event_stats e ON e.work_key=o.id::text
         LEFT JOIN repeaters r ON r.work_key=o.id::text LEFT JOIN saves s ON s.work_key=o.id::text
         LEFT JOIN builds b ON b.work_id=o.id
         ORDER BY (COALESCE(e.views,0)+COALESCE(e.starts,0)*2) DESC,o.title`, [userId, since, now],
      ),
      this.pool.query(
        `SELECT (a.occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
          count(*) FILTER (WHERE a.event_type='work_view')::int AS views,
          count(*) FILTER (WHERE a.event_type='game_start')::int AS starts,
          count(*) FILTER (WHERE a.event_type='game_end' AND a.duration_ms >= 30000)::int AS engaged_sessions
         FROM analytics_events a JOIN works w ON w.id::text=a.work_key
         WHERE w.owner_user_id=$1 AND a.occurred_at >= $2 AND a.occurred_at < $3
         GROUP BY day ORDER BY day`, [userId, since, now],
      ),
    ]);
    const daily = new Map();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(now.getTime() - (days - index - 1) * 86_400_000);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
      daily.set(day, { day, views: 0, starts: 0, engagedSessions: 0 });
    }
    for (const row of dailyEvents.rows) daily.set(isoDay(row.day), { day: isoDay(row.day), views: number(row.views), starts: number(row.starts), engagedSessions: number(row.engaged_sessions) });
    const works = workStats.rows.map(row => ({
      workId: row.work_id, title: row.title, state: row.state, views: number(row.views), starts: number(row.starts), engagedSessions: number(row.engaged_sessions),
      repeatPlayers: number(row.repeat_players), saves: number(row.saves), builds: number(row.builds), successfulBuilds: number(row.successful_builds),
    }));
    const totals = works.reduce((sum, work) => {
      for (const key of ['views','starts','engagedSessions','repeatPlayers','saves','builds','successfulBuilds']) sum[key] += work[key];
      return sum;
    }, { views: 0, starts: 0, engagedSessions: 0, repeatPlayers: 0, saves: 0, builds: 0, successfulBuilds: 0 });
    return {
      range: { days, since: since.toISOString(), until: now.toISOString() },
      totals: { ...totals, engagementRate: totals.starts ? Math.min(100, Math.round(totals.engagedSessions / totals.starts * 100)) : 0, buildSuccessRate: totals.builds ? Math.min(100, Math.round(totals.successfulBuilds / totals.builds * 100)) : 0 },
      daily: [...daily.values()], works,
      measurement: { timeZone: 'Asia/Shanghai', repeatPlayer: '同一匿名设备在周期内至少启动两次', saves: '当前仍收藏该作品的账号数', engagementRate: '停留至少 30 秒的结束会话 / 启动事件' },
    };
  }
}
