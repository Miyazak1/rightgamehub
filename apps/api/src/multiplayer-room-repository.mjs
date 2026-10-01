import { withTransaction } from './database.mjs';
import { MultiplayerRoomError } from './multiplayer-room-service.mjs';

const modeView = row => ({
  id: row.id, workId: row.work_id, key: row.key, name: row.name, authority: row.authority,
  minPlayers: Number(row.min_players), maxPlayers: Number(row.max_players), rulesetVersion: row.ruleset_version,
  config: row.config ?? {}, enabled: Boolean(row.enabled),
});
const memberView = row => ({
  userId: row.user_id, displayName: row.display_name, seat: Number(row.seat), role: row.role,
  ready: Boolean(row.ready), connectionState: row.connection_state, joinedAt: new Date(row.joined_at).toISOString(),
});
const roomView = (row, members) => ({
  id: row.id, modeId: row.mode_id, ownerUserId: row.owner_user_id, visibility: row.visibility, status: row.status,
  capacity: Number(row.capacity), settings: row.settings ?? {}, revision: String(row.revision),
  expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(), members: members.map(memberView),
});

async function hydrate(client, row) {
  if (!row) return null;
  const members = (await client.query(
    `SELECT m.user_id,u.display_name,m.seat,m.role,m.ready,m.connection_state,m.joined_at
       FROM multiplayer_room_members m JOIN users u ON u.id=m.user_id
      WHERE m.room_id=$1 AND m.left_at IS NULL ORDER BY m.seat,m.joined_at,m.user_id`, [row.id],
  )).rows;
  return roomView(row, members);
}

async function replayOrConflict(client, input) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`idempotency:${input.actor.userId}:multiplayer.room.create:${input.idempotencyKey}`]);
  const existing = (await client.query(
    "SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='multiplayer.room.create' AND key=$2",
    [input.actor.userId, input.idempotencyKey],
  )).rows[0];
  if (!existing) return null;
  if (existing.request_hash !== input.requestHash) throw new MultiplayerRoomError('IDEMPOTENCY_CONFLICT', 409, '该幂等键已经用于另一个请求。');
  return existing.result_json;
}

export class PostgresMultiplayerRoomRepository {
  constructor(pool) { this.pool = pool; }

  async listModes(workId) {
    return (await this.pool.query(
      `SELECT m.* FROM multiplayer_game_modes m JOIN works w ON w.id=m.work_id
        WHERE m.work_id=$1 AND m.enabled=true AND w.kind='game' AND w.state='published' AND w.visibility='public'
        ORDER BY m.created_at,m.id`, [workId],
    )).rows.map(modeView);
  }

  async createMode(input) {
    const row = (await this.pool.query(
      `INSERT INTO multiplayer_game_modes(id,work_id,key,name,authority,min_players,max_players,ruleset_version,config,created_at,updated_at)
       SELECT $1,w.id,$3,$4,$5,$6,$7,$8,$9,$10,$10 FROM works w
        WHERE w.id=$2 AND w.kind='game' AND w.state='published'
       ON CONFLICT (work_id,key) DO NOTHING RETURNING *`,
      [input.id,input.workId,input.key,input.name,input.authority,input.minPlayers,input.maxPlayers,input.rulesetVersion,input.config ?? {},input.now],
    )).rows[0];
    return row ? modeView(row) : null;
  }

  async listPublicRooms({ modeId, limit }) {
    const rows = (await this.pool.query(
      `SELECT r.* FROM multiplayer_rooms r JOIN multiplayer_game_modes m ON m.id=r.mode_id
        WHERE r.mode_id=$1 AND r.status='open' AND r.visibility='public' AND r.expires_at>now() AND m.enabled=true
        ORDER BY r.created_at DESC,r.id LIMIT $2`, [modeId, limit],
    )).rows;
    return Promise.all(rows.map(row => hydrate(this.pool, row)));
  }

  async getVisibleRoom(userId, roomId) {
    const row = (await this.pool.query(
      `SELECT r.* FROM multiplayer_rooms r WHERE r.id=$1 AND
       (r.visibility='public' OR EXISTS(SELECT 1 FROM multiplayer_room_members m WHERE m.room_id=r.id AND m.user_id=$2 AND m.left_at IS NULL))`,
      [roomId, userId],
    )).rows[0];
    return hydrate(this.pool, row);
  }

  async createRoomIdempotent(input) {
    return withTransaction(this.pool, async client => {
      const replay = await replayOrConflict(client, input);
      if (replay) {
        const replayRow = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1', [replay.id])).rows[0];
        if (!replayRow) throw new MultiplayerRoomError('IDEMPOTENCY_RESULT_GONE', 409, '之前创建的房间已经不存在。');
        return hydrate(client, replayRow);
      }
      const mode = (await client.query(
        `SELECT m.* FROM multiplayer_game_modes m JOIN works w ON w.id=m.work_id
          WHERE m.id=$1 AND m.enabled=true AND w.kind='game' AND w.state='published' FOR SHARE OF m`, [input.modeId],
      )).rows[0];
      if (!mode) throw new MultiplayerRoomError('MODE_NOT_AVAILABLE', 404, '多人游戏模式不存在或未启用。');
      if (input.capacity < mode.min_players || input.capacity > mode.max_players) throw new MultiplayerRoomError('CAPACITY_INVALID', 400, '房间人数不符合该模式要求。');
      const row = (await client.query(
        `INSERT INTO multiplayer_rooms(id,mode_id,owner_user_id,visibility,join_code_digest,capacity,settings,expires_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [input.roomId,input.modeId,input.actor.userId,input.visibility,input.joinCodeDigest,input.capacity,input.settings,input.expiresAt,input.now],
      )).rows[0];
      await client.query(
        `INSERT INTO multiplayer_room_members(room_id,user_id,seat,role,ready,connection_state,joined_at)
         VALUES ($1,$2,0,'player',false,'offline',$3)`, [input.roomId,input.actor.userId,input.now],
      );
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'multiplayer.room.create',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId,input.idempotencyKey,input.requestHash,{ id: input.roomId }],
      );
      return hydrate(client, row);
    });
  }

  async joinRoom(input) {
    return withTransaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [input.roomId])).rows[0];
      if (!room || new Date(room.expires_at) <= input.now) return { error: 'not_found' };
      if (input.expectedModeId && room.mode_id !== input.expectedModeId) return { error: 'not_found' };
      if (room.status !== 'open') return { error: 'not_open' };
      const existing = (await client.query('SELECT * FROM multiplayer_room_members WHERE room_id=$1 AND user_id=$2', [input.roomId,input.userId])).rows[0];
      if (existing && existing.left_at == null) return hydrate(client, room);
      if (room.visibility === 'private') return { error: 'private' };
      if (room.visibility === 'invite_only' && (!input.joinCodeDigest || !Buffer.from(room.join_code_digest).equals(input.joinCodeDigest))) return { error: 'code_required' };
      const blocked = (await client.query(
        `SELECT 1 FROM multiplayer_room_members m JOIN user_blocks b ON
          ((b.blocker_user_id=$2 AND b.blocked_user_id=m.user_id) OR (b.blocker_user_id=m.user_id AND b.blocked_user_id=$2))
          WHERE m.room_id=$1 AND m.left_at IS NULL LIMIT 1`, [input.roomId,input.userId],
      )).rowCount > 0;
      if (blocked) return { error: 'blocked' };
      const seats = new Set((await client.query(
        "SELECT seat FROM multiplayer_room_members WHERE room_id=$1 AND left_at IS NULL AND role='player' ORDER BY seat", [input.roomId],
      )).rows.map(row => Number(row.seat)));
      let seat = -1;
      for (let candidate = 0; candidate < room.capacity; candidate += 1) if (!seats.has(candidate)) { seat = candidate; break; }
      if (seat < 0) return { error: 'full' };
      await client.query(
        `INSERT INTO multiplayer_room_members(room_id,user_id,seat,role,ready,connection_state,joined_at,left_at)
         VALUES ($1,$2,$3,'player',false,'offline',$4,NULL)
         ON CONFLICT (room_id,user_id) DO UPDATE SET seat=EXCLUDED.seat,role='player',ready=false,connection_state='offline',joined_at=EXCLUDED.joined_at,left_at=NULL`,
        [input.roomId,input.userId,seat,input.now],
      );
      const updated = (await client.query(
        "UPDATE multiplayer_rooms SET revision=revision+1,updated_at=$2::timestamptz,expires_at=$2::timestamptz+interval '30 minutes' WHERE id=$1 RETURNING *", [input.roomId,input.now],
      )).rows[0];
      return hydrate(client, updated);
    });
  }

  async rotateInvite(input) {
    return withTransaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [input.roomId])).rows[0];
      if (!room || new Date(room.expires_at) <= input.now) return { error: 'not_found' };
      if (room.owner_user_id !== input.userId) return { error: 'not_owner' };
      if (room.visibility !== 'invite_only') return { error: 'not_invite_only' };
      if (room.status !== 'open') return { error: 'not_open' };
      const otherMembers = Number((await client.query(
        'SELECT count(*)::int AS count FROM multiplayer_room_members WHERE room_id=$1 AND user_id<>$2 AND left_at IS NULL', [input.roomId,input.userId],
      )).rows[0].count);
      const claimed = (await client.query(
        'SELECT 1 FROM multiplayer_room_invites WHERE room_id=$1 AND claimed_at IS NOT NULL LIMIT 1', [input.roomId],
      )).rowCount > 0;
      if (otherMembers > 0 || claimed) return { error: 'occupied' };
      await client.query(
        'UPDATE multiplayer_room_invites SET revoked_at=$2 WHERE room_id=$1 AND claimed_at IS NULL AND revoked_at IS NULL', [input.roomId,input.now],
      );
      const row = (await client.query(
        `INSERT INTO multiplayer_room_invites(id,room_id,token_digest,created_by,expires_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING expires_at`,
        [input.id,input.roomId,input.tokenDigest,input.userId,room.expires_at,input.now],
      )).rows[0];
      return { expiresAt: new Date(row.expires_at).toISOString() };
    });
  }

  async claimInvite(input) {
    return withTransaction(this.pool, async client => {
      const invite = (await client.query(
        `SELECT i.*,r.mode_id,r.owner_user_id,r.status AS room_status,r.capacity,r.expires_at AS room_expires_at,m.work_id
           FROM multiplayer_room_invites i
           JOIN multiplayer_rooms r ON r.id=i.room_id
           JOIN multiplayer_game_modes m ON m.id=r.mode_id
          WHERE i.token_digest=$1 FOR UPDATE OF i,r`, [input.tokenDigest],
      )).rows[0];
      if (!invite || invite.revoked_at || new Date(invite.expires_at) <= input.now || new Date(invite.room_expires_at) <= input.now) return { error: 'not_found' };
      if (invite.claimed_by && invite.claimed_by !== input.userId) return { error: 'claimed' };
      if (invite.room_status !== 'open') return { error: 'not_open' };
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1', [invite.room_id])).rows[0];
      const existing = (await client.query('SELECT * FROM multiplayer_room_members WHERE room_id=$1 AND user_id=$2', [invite.room_id,input.userId])).rows[0];
      if (input.userId === invite.owner_user_id || (existing && existing.left_at == null)) {
        return { room: await hydrate(client, room),workId: invite.work_id };
      }
      const blocked = (await client.query(
        `SELECT 1 FROM multiplayer_room_members m JOIN user_blocks b ON
          ((b.blocker_user_id=$2 AND b.blocked_user_id=m.user_id) OR (b.blocker_user_id=m.user_id AND b.blocked_user_id=$2))
          WHERE m.room_id=$1 AND m.left_at IS NULL LIMIT 1`, [invite.room_id,input.userId],
      )).rowCount > 0;
      if (blocked) return { error: 'blocked' };
      const seats = new Set((await client.query(
        "SELECT seat FROM multiplayer_room_members WHERE room_id=$1 AND left_at IS NULL AND role='player' ORDER BY seat", [invite.room_id],
      )).rows.map(row => Number(row.seat)));
      let seat = -1;
      for (let candidate = 0; candidate < invite.capacity; candidate += 1) if (!seats.has(candidate)) { seat = candidate; break; }
      if (seat < 0) return { error: 'full' };
      await client.query(
        `INSERT INTO multiplayer_room_members(room_id,user_id,seat,role,ready,connection_state,joined_at,left_at)
         VALUES ($1,$2,$3,'player',false,'offline',$4,NULL)
         ON CONFLICT (room_id,user_id) DO UPDATE SET seat=EXCLUDED.seat,role='player',ready=false,connection_state='offline',joined_at=EXCLUDED.joined_at,left_at=NULL`,
        [invite.room_id,input.userId,seat,input.now],
      );
      await client.query('UPDATE multiplayer_room_invites SET claimed_by=$2,claimed_at=$3 WHERE id=$1', [invite.id,input.userId,input.now]);
      const updated = (await client.query(
        "UPDATE multiplayer_rooms SET revision=revision+1,updated_at=$2::timestamptz,expires_at=$2::timestamptz+interval '30 minutes' WHERE id=$1 RETURNING *", [invite.room_id,input.now],
      )).rows[0];
      return { room: await hydrate(client, updated),workId: invite.work_id };
    });
  }

  async leaveRoom(input) {
    return withTransaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [input.roomId])).rows[0];
      if (!room) return null;
      if (room.status !== 'open') return { error: 'not_open' };
      const leaving = (await client.query(
        'UPDATE multiplayer_room_members SET left_at=$3,ready=false,connection_state=\'offline\' WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING user_id',
        [input.roomId,input.userId,input.now],
      )).rows[0];
      if (!leaving) return null;
      const nextOwner = (await client.query(
        "SELECT user_id FROM multiplayer_room_members WHERE room_id=$1 AND left_at IS NULL AND role='player' ORDER BY joined_at,user_id LIMIT 1", [input.roomId],
      )).rows[0];
      const updated = nextOwner
        ? (await client.query(
          "UPDATE multiplayer_rooms SET owner_user_id=CASE WHEN owner_user_id=$2 THEN $3 ELSE owner_user_id END,revision=revision+1,updated_at=$4::timestamptz,expires_at=$4::timestamptz+interval '30 minutes' WHERE id=$1 RETURNING *",
          [input.roomId,input.userId,nextOwner.user_id,input.now],
        )).rows[0]
        : (await client.query(
          "UPDATE multiplayer_rooms SET status='closed',closed_at=$2,revision=revision+1,updated_at=$2 WHERE id=$1 RETURNING *", [input.roomId,input.now],
        )).rows[0];
      return hydrate(client, updated);
    });
  }

  async setReady(input) {
    return withTransaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [input.roomId])).rows[0];
      if (!room) return null;
      if (room.status !== 'open') return { error: 'not_open' };
      const member = (await client.query(
        "UPDATE multiplayer_room_members SET ready=$3 WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL AND role='player' RETURNING user_id",
        [input.roomId,input.userId,input.ready],
      )).rows[0];
      if (!member) return null;
      const updated = (await client.query(
        "UPDATE multiplayer_rooms SET revision=revision+1,updated_at=$2::timestamptz,expires_at=$2::timestamptz+interval '30 minutes' WHERE id=$1 RETURNING *", [input.roomId,input.now],
      )).rows[0];
      return hydrate(client, updated);
    });
  }
}
