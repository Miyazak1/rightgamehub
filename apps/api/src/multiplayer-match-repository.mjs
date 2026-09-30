import { withTransaction } from './database.mjs';
import { MultiplayerMatchError } from './multiplayer-match-service.mjs';

const playerView = row => ({ userId: row.user_id, displayName: row.display_name, seat: Number(row.seat), team: row.team === null ? null : Number(row.team), result: row.result });
const matchView = (row, players, snapshot) => ({
  id: row.id, roomId: row.room_id, modeId: row.mode_id, rulesetVersion: row.ruleset_version, status: row.status,
  revision: String(row.revision), nextEventSeq: String(row.next_event_seq), turnUserId: row.turn_user_id,
  turnDeadlineAt: row.turn_deadline_at ? new Date(row.turn_deadline_at).toISOString() : null,
  startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  terminationReason: row.termination_reason, result: row.result, players: players.map(playerView), publicState: snapshot?.public_state ?? null,
});

async function hydrate(client, row) {
  if (!row) return null;
  const players = (await client.query(
    `SELECT p.*,u.display_name FROM multiplayer_match_players p JOIN users u ON u.id=p.user_id
      WHERE p.match_id=$1 ORDER BY p.seat,p.user_id`, [row.id],
  )).rows;
  const snapshot = (await client.query(
    'SELECT public_state FROM multiplayer_match_snapshots WHERE match_id=$1 ORDER BY event_seq DESC LIMIT 1', [row.id],
  )).rows[0];
  return matchView(row, players, snapshot);
}

const samePlayers = (actual, expected) => actual.length === expected.length && actual.every((player, index) => player.user_id === expected[index].userId && Number(player.seat) === expected[index].seat);
const eventView = row => ({
  seq: String(row.seq),type: row.event_type,actorUserId: row.actor_user_id,commandId: row.command_id,
  payload: row.payload,stateHash: row.state_hash,createdAt: new Date(row.created_at).toISOString(),
});

export class PostgresMultiplayerMatchRepository {
  constructor(pool) { this.pool = pool; }

  async getStartContext({ roomId, userId }) {
    const room = (await this.pool.query(
      `SELECT r.*,m.work_id,m.key AS mode_key,m.ruleset_version,m.authority,m.min_players,m.max_players
         FROM multiplayer_rooms r JOIN multiplayer_game_modes m ON m.id=r.mode_id
        WHERE r.id=$1 AND r.owner_user_id=$2
          AND ((r.status='open' AND r.expires_at>now()) OR r.status='in_match')
          AND m.enabled=true`, [roomId,userId],
    )).rows[0];
    if (!room) return null;
    const players = (await this.pool.query(
      `SELECT user_id,seat,ready FROM multiplayer_room_members
        WHERE room_id=$1 AND left_at IS NULL AND role='player' ORDER BY seat,user_id`, [roomId],
    )).rows.map(row => ({ userId: row.user_id, seat: Number(row.seat), ready: Boolean(row.ready) }));
    return {
      roomId: room.id, modeId: room.mode_id, ownerUserId: room.owner_user_id, settings: room.settings ?? {},
      workId: room.work_id, modeKey: room.mode_key, rulesetVersion: room.ruleset_version, authority: room.authority,
      minPlayers: Number(room.min_players), maxPlayers: Number(room.max_players), players,
    };
  }

  async startMatchIdempotent(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`idempotency:${input.userId}:multiplayer.room.start:${input.idempotencyKey}`]);
      const replay = (await client.query(
        "SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='multiplayer.room.start' AND key=$2",
        [input.userId,input.idempotencyKey],
      )).rows[0];
      if (replay) {
        if (replay.request_hash !== input.requestHash) throw new MultiplayerMatchError('IDEMPOTENCY_CONFLICT', 409, '该幂等键已经用于另一个请求。');
        return hydrate(client, (await client.query('SELECT * FROM multiplayer_matches WHERE id=$1', [replay.result_json.id])).rows[0]);
      }
      const room = (await client.query(
        `SELECT r.*,m.min_players,m.max_players,m.ruleset_version,m.enabled
           FROM multiplayer_rooms r JOIN multiplayer_game_modes m ON m.id=r.mode_id
          WHERE r.id=$1 FOR UPDATE OF r`, [input.roomId],
      )).rows[0];
      if (!room || room.owner_user_id !== input.userId) throw new MultiplayerMatchError('ROOM_NOT_FOUND', 404, '房间不存在或你不是房主。');
      if (room.status !== 'open' || new Date(room.expires_at) <= input.now || !room.enabled) throw new MultiplayerMatchError('ROOM_NOT_OPEN', 409, '房间当前不能开始对局。');
      const players = (await client.query(
        `SELECT user_id,seat,ready FROM multiplayer_room_members
          WHERE room_id=$1 AND left_at IS NULL AND role='player' ORDER BY seat,user_id FOR UPDATE`, [input.roomId],
      )).rows;
      if (!samePlayers(players, input.players)) throw new MultiplayerMatchError('ROOM_CHANGED', 409, '房间成员已经变化，请重新确认。');
      if (players.length < Number(room.min_players) || players.length > Number(room.max_players) || players.some(player => !player.ready)) {
        throw new MultiplayerMatchError('PLAYERS_NOT_READY', 409, '人数不足或仍有玩家没有准备。');
      }
      const match = (await client.query(
        `INSERT INTO multiplayer_matches(id,room_id,mode_id,ruleset_version,status,revision,next_event_seq,turn_user_id,turn_deadline_at,seed_hash,started_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,'active',1,2,$5,$6,$7,$8,$8,$8) RETURNING *`,
        [input.matchId,input.roomId,input.modeId,input.rulesetVersion,input.turnUserId,input.turnDeadlineAt,input.seedHash,input.now],
      )).rows[0];
      for (const player of input.players) await client.query(
        'INSERT INTO multiplayer_match_players(match_id,user_id,seat,result,connected_at) VALUES ($1,$2,$3,NULL,NULL)',
        [input.matchId,player.userId,player.seat],
      );
      await client.query(
        `INSERT INTO multiplayer_match_events(match_id,seq,event_type,actor_user_id,command_id,payload,state_hash,created_at)
         VALUES ($1,1,'match.started',$2,NULL,$3,$4,$5)`,
        [input.matchId,input.userId,input.startedEvent,input.stateHash,input.now],
      );
      await client.query(
        `INSERT INTO multiplayer_match_snapshots(match_id,event_seq,ruleset_version,state,public_state,state_hash,created_at)
         VALUES ($1,1,$2,$3,$4,$5,$6)`,
        [input.matchId,input.rulesetVersion,input.state,input.publicState,input.stateHash,input.now],
      );
      await client.query("UPDATE multiplayer_rooms SET status='in_match',revision=revision+1,updated_at=$2 WHERE id=$1", [input.roomId,input.now]);
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'multiplayer.room.start',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.userId,input.idempotencyKey,input.requestHash,{ id: input.matchId }],
      );
      return hydrate(client, match);
    });
  }

  async getVisibleMatch({ matchId, userId }) {
    const row = (await this.pool.query(
      `SELECT m.* FROM multiplayer_matches m WHERE m.id=$1 AND EXISTS(
        SELECT 1 FROM multiplayer_match_players p WHERE p.match_id=m.id AND p.user_id=$2)`, [matchId,userId],
    )).rows[0];
    return hydrate(this.pool, row);
  }

  async listEvents({ matchId, userId, afterSeq, limit }) {
    const allowed = (await this.pool.query('SELECT 1 FROM multiplayer_match_players WHERE match_id=$1 AND user_id=$2', [matchId,userId])).rowCount > 0;
    if (!allowed) return null;
    return (await this.pool.query(
      `SELECT seq,event_type,actor_user_id,command_id,payload,state_hash,created_at FROM multiplayer_match_events
        WHERE match_id=$1 AND seq>$2 ORDER BY seq LIMIT $3`, [matchId,afterSeq,limit],
    )).rows.map(eventView);
  }

  async getReplay({ matchId, userId }) {
    const match = await this.getVisibleMatch({ matchId,userId });
    if (!match) return null;
    const events = (await this.pool.query(
      `SELECT seq,event_type,actor_user_id,command_id,payload,state_hash,created_at
         FROM multiplayer_match_events WHERE match_id=$1 ORDER BY seq LIMIT 10000`, [matchId],
    )).rows.map(eventView);
    return { match,events };
  }

  async adminOverview() {
    const [rooms,matches,recent] = await Promise.all([
      this.pool.query('SELECT status,count(*)::int AS count FROM multiplayer_rooms GROUP BY status'),
      this.pool.query(`SELECT status,count(*)::int AS count FROM multiplayer_matches GROUP BY status`),
      this.pool.query(
        `SELECT
          count(*) FILTER (WHERE status='active' AND turn_deadline_at<now())::int AS overdue_matches,
          count(*) FILTER (WHERE created_at>=now()-interval '24 hours')::int AS matches_created_24h,
          count(*) FILTER (WHERE ended_at>=now()-interval '24 hours' AND status='completed')::int AS matches_completed_24h,
          count(*) FILTER (WHERE ended_at>=now()-interval '24 hours' AND status='aborted')::int AS matches_aborted_24h
         FROM multiplayer_matches`,
      ),
    ]);
    return {
      rooms: Object.fromEntries(rooms.rows.map(row => [row.status,Number(row.count)])),
      matches: Object.fromEntries(matches.rows.map(row => [row.status,Number(row.count)])),
      overdueMatches: Number(recent.rows[0].overdue_matches),matchesCreated24h: Number(recent.rows[0].matches_created_24h),
      matchesCompleted24h: Number(recent.rows[0].matches_completed_24h),matchesAborted24h: Number(recent.rows[0].matches_aborted_24h),
    };
  }

  async listAdminMatches({ status, limit }) {
    const rows = (await this.pool.query(
      `SELECT mt.* FROM multiplayer_matches mt WHERE ($1::text IS NULL OR mt.status=$1)
        ORDER BY mt.updated_at DESC,mt.id DESC LIMIT $2`, [status,limit],
    )).rows;
    return Promise.all(rows.map(row => hydrate(this.pool, row)));
  }

  async abortMatch({ matchId, actorUserId, reason, auditId, now }) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT * FROM multiplayer_matches WHERE id=$1 FOR UPDATE', [matchId])).rows[0];
      if (!row) return { error: 'not_found' };
      if (['completed','aborted'].includes(row.status)) return { error: 'terminal',match: await hydrate(client,row) };
      const snapshot = (await client.query(
        'SELECT * FROM multiplayer_match_snapshots WHERE match_id=$1 ORDER BY event_seq DESC LIMIT 1', [matchId],
      )).rows[0];
      if (!snapshot) throw new MultiplayerMatchError('MATCH_STATE_MISSING', 500, '对局缺少可恢复状态。', true);
      const seq = String(row.next_event_seq); const revision = String(BigInt(row.revision) + 1n); const nextEventSeq = String(BigInt(seq) + 1n);
      const result = { abortedBy: actorUserId,reason };
      await client.query(
        `INSERT INTO multiplayer_match_events(match_id,seq,event_type,actor_user_id,command_id,payload,state_hash,created_at)
         VALUES ($1,$2,'match.aborted',$3,NULL,$4,$5,$6)`, [matchId,seq,actorUserId,{ reason },snapshot.state_hash,now],
      );
      await client.query(
        `INSERT INTO multiplayer_match_snapshots(match_id,event_seq,ruleset_version,state,public_state,state_hash,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [matchId,seq,row.ruleset_version,snapshot.state,snapshot.public_state,snapshot.state_hash,now],
      );
      const updated = (await client.query(
        `UPDATE multiplayer_matches SET status='aborted',revision=$2,next_event_seq=$3,turn_user_id=NULL,turn_deadline_at=NULL,
          ended_at=$4,termination_reason='admin_abort',result=$5,updated_at=$4 WHERE id=$1 RETURNING *`,
        [matchId,revision,nextEventSeq,now,result],
      )).rows[0];
      await client.query("UPDATE multiplayer_match_players SET result='none' WHERE match_id=$1 AND result IS NULL", [matchId]);
      if (row.room_id) await client.query(
        "UPDATE multiplayer_rooms SET status='closed',closed_at=$2,revision=revision+1,updated_at=$2 WHERE id=$1 AND status<>'closed'", [row.room_id,now],
      );
      await client.query(
        `INSERT INTO multiplayer_admin_events(id,actor_user_id,match_id,action,reason,before_state,after_state,created_at)
         VALUES ($1,$2,$3,'abort',$4,$5,$6,$7)`,
        [auditId,actorUserId,matchId,reason,{ status: row.status,revision: String(row.revision) },{ status: 'aborted',revision },now],
      );
      return {
        match: await hydrate(client,updated),
        event: { seq,type: 'match.aborted',actorUserId,commandId: null,payload: { reason },stateHash: snapshot.state_hash,createdAt: now.toISOString() },
      };
    });
  }

  async listAdminAudit(limit) {
    return (await this.pool.query(
      `SELECT e.*,u.display_name AS actor_display_name FROM multiplayer_admin_events e JOIN users u ON u.id=e.actor_user_id
        ORDER BY e.created_at DESC,e.id DESC LIMIT $1`, [limit],
    )).rows.map(row => ({
      id: row.id,actorUserId: row.actor_user_id,actorDisplayName: row.actor_display_name,matchId: row.match_id,
      action: row.action,reason: row.reason,beforeState: row.before_state,afterState: row.after_state,createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
