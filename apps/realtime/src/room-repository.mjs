const memberView = row => ({
  userId: row.user_id,
  displayName: row.display_name,
  seat: Number(row.seat),
  role: row.role,
  ready: Boolean(row.ready),
  connectionState: row.connection_state,
  joinedAt: new Date(row.joined_at).toISOString(),
});

const roomView = (row, members) => ({
  id: row.id,
  modeId: row.mode_id,
  ownerUserId: row.owner_user_id,
  visibility: row.visibility,
  status: row.status,
  capacity: Number(row.capacity),
  settings: row.settings ?? {},
  revision: String(row.revision),
  expiresAt: new Date(row.expires_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
  members: members.map(memberView),
});

async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function hydrate(client, room) {
  if (!room) return null;
  const members = (await client.query(
    `SELECT m.user_id,u.display_name,m.seat,m.role,m.ready,m.connection_state,m.joined_at
       FROM multiplayer_room_members m JOIN users u ON u.id=m.user_id
      WHERE m.room_id=$1 AND m.left_at IS NULL ORDER BY m.seat,m.joined_at,m.user_id`,
    [room.id],
  )).rows;
  return roomView(room, members);
}

export class PostgresRealtimeRoomRepository {
  constructor(pool) { this.pool = pool; }

  async ping() { const result = await this.pool.query('SELECT 1 AS ok'); return result.rows[0]?.ok === 1; }

  async connectMember({ roomId, userId, now }) {
    return this.#setConnectionState({ roomId, userId, state: 'online', now, requireOpen: false });
  }

  async setMemberGrace({ roomId, userId, now }) {
    return this.#setConnectionState({ roomId, userId, state: 'grace', now, requireOpen: false });
  }

  async setMemberOffline({ roomId, userId, now }) {
    return this.#setConnectionState({ roomId, userId, state: 'offline', now, requireOpen: false });
  }

  async #setConnectionState({ roomId, userId, state, now, requireOpen }) {
    return transaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      if (!room || room.status === 'closed' || new Date(room.expires_at) <= now || (requireOpen && room.status !== 'open')) return { error: 'room_not_available' };
      const member = (await client.query(
        `UPDATE multiplayer_room_members SET connection_state=$3
          WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL AND connection_state IS DISTINCT FROM $3
          RETURNING user_id`,
        [roomId,userId,state],
      )).rows[0];
      const active = member || (await client.query(
        'SELECT user_id FROM multiplayer_room_members WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL', [roomId,userId],
      )).rows[0];
      if (!active) return { error: 'not_member' };
      const updated = member
        ? (await client.query('UPDATE multiplayer_rooms SET revision=revision+1,updated_at=$2 WHERE id=$1 RETURNING *', [roomId,now])).rows[0]
        : room;
      return { room: await hydrate(client, updated), changed: Boolean(member), userId };
    });
  }

  async setReady({ roomId, userId, ready, expectedRevision, now }) {
    return transaction(this.pool, async client => {
      const room = (await client.query('SELECT * FROM multiplayer_rooms WHERE id=$1 FOR UPDATE', [roomId])).rows[0];
      if (!room || new Date(room.expires_at) <= now) return { error: 'room_not_available' };
      if (room.status !== 'open') return { error: 'room_not_open' };
      if (expectedRevision !== undefined && BigInt(room.revision) !== BigInt(expectedRevision)) {
        return { error: 'revision_conflict', revision: String(room.revision), room: await hydrate(client, room) };
      }
      const member = (await client.query(
        `UPDATE multiplayer_room_members SET ready=$3
          WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL AND role='player' AND ready IS DISTINCT FROM $3
          RETURNING user_id`,
        [roomId,userId,ready],
      )).rows[0];
      const active = member || (await client.query(
        "SELECT user_id FROM multiplayer_room_members WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL AND role='player'", [roomId,userId],
      )).rows[0];
      if (!active) return { error: 'not_member' };
      const updated = member
        ? (await client.query('UPDATE multiplayer_rooms SET revision=revision+1,updated_at=$2 WHERE id=$1 RETURNING *', [roomId,now])).rows[0]
        : room;
      return { room: await hydrate(client, updated), changed: Boolean(member), userId };
    });
  }
}
