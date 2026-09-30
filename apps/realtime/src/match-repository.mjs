const eventView = row => ({
  seq: String(row.seq), type: row.event_type, actorUserId: row.actor_user_id, commandId: row.command_id,
  payload: row.payload, stateHash: row.state_hash, createdAt: new Date(row.created_at).toISOString(),
});

const playerView = row => ({
  userId: row.user_id, displayName: row.display_name, seat: Number(row.seat),
  team: row.team === null ? null : Number(row.team), result: row.result,
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
  } finally { client.release(); }
}

async function loadContext(client, { matchId, userId, lock = false }) {
  const membership = userId ? `AND EXISTS(
        SELECT 1 FROM multiplayer_match_players mp WHERE mp.match_id=mt.id AND mp.user_id=$2)` : '';
  const row = (await client.query(
    `SELECT mt.*,gm.work_id,gm.key AS mode_key
       FROM multiplayer_matches mt JOIN multiplayer_game_modes gm ON gm.id=mt.mode_id
      WHERE mt.id=$1 ${membership}
      ${lock ? 'FOR UPDATE OF mt' : ''}`,
    userId ? [matchId,userId] : [matchId],
  )).rows[0];
  if (!row) return null;
  const players = (await client.query(
    `SELECT mp.*,u.display_name FROM multiplayer_match_players mp JOIN users u ON u.id=mp.user_id
      WHERE mp.match_id=$1 ORDER BY mp.seat,mp.user_id`, [matchId],
  )).rows.map(playerView);
  const snapshot = (await client.query(
    'SELECT * FROM multiplayer_match_snapshots WHERE match_id=$1 ORDER BY event_seq DESC LIMIT 1', [matchId],
  )).rows[0];
  return {
    matchId: row.id, roomId: row.room_id, modeId: row.mode_id, workId: row.work_id, modeKey: row.mode_key,
    rulesetVersion: row.ruleset_version, status: row.status, revision: String(row.revision),
    nextEventSeq: String(row.next_event_seq), turnUserId: row.turn_user_id,
    turnDeadlineAt: row.turn_deadline_at ? new Date(row.turn_deadline_at) : null,
    result: row.result, players, state: snapshot?.state ?? null, publicState: snapshot?.public_state ?? null,
    stateHash: snapshot?.state_hash ?? null,
  };
}

async function persistTransition(client, { context,output,actorUserId,commandId,now }) {
  const seq = context.nextEventSeq;
  const nextRevision = String(BigInt(context.revision) + 1n);
  const nextEventSeq = String(BigInt(seq) + 1n);
  await client.query(
    `INSERT INTO multiplayer_match_events(match_id,seq,event_type,actor_user_id,command_id,payload,state_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [context.matchId,seq,output.eventType,actorUserId,commandId,output.eventPayload,output.stateHash,now],
  );
  await client.query(
    `INSERT INTO multiplayer_match_snapshots(match_id,event_seq,ruleset_version,state,public_state,state_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.matchId,seq,context.rulesetVersion,output.state,output.publicState,output.stateHash,now],
  );
  const terminal = Boolean(output.completed);
  await client.query(
    `UPDATE multiplayer_matches SET status=$2,revision=$3,next_event_seq=$4,turn_user_id=$5,turn_deadline_at=$6,
       ended_at=$7,termination_reason=$8,result=$9,updated_at=$10 WHERE id=$1`,
    [context.matchId,terminal ? 'completed' : 'active',nextRevision,nextEventSeq,terminal ? null : output.turnUserId,terminal ? null : output.turnDeadlineAt,
      terminal ? now : null,terminal ? output.terminationReason : null,terminal ? output.result : null,now],
  );
  for (const playerResult of output.playerResults ?? []) await client.query(
    'UPDATE multiplayer_match_players SET result=$3 WHERE match_id=$1 AND user_id=$2',
    [context.matchId,playerResult.userId,playerResult.result],
  );
  if (terminal && context.roomId) await client.query(
    "UPDATE multiplayer_rooms SET status='closed',closed_at=$2,revision=revision+1,updated_at=$2 WHERE id=$1 AND status='in_match'",
    [context.roomId,now],
  );
  const event = {
    seq,type: output.eventType,actorUserId,commandId,payload: output.eventPayload,
    stateHash: output.stateHash,createdAt: now.toISOString(),
  };
  return {
    event,context: { ...context,status: terminal ? 'completed' : 'active',revision: nextRevision,nextEventSeq,
      turnUserId: terminal ? null : output.turnUserId,turnDeadlineAt: terminal ? null : output.turnDeadlineAt,
      result: terminal ? output.result : null,state: output.state,publicState: output.publicState,stateHash: output.stateHash },
  };
}

export class PostgresRealtimeMatchRepository {
  constructor(pool) { this.pool = pool; }

  async ping() { return (await this.pool.query('SELECT 1 AS ok')).rows[0]?.ok === 1; }

  async getSyncState({ matchId, userId, afterSeq = 0, limit = 500 }) {
    const context = await loadContext(this.pool, { matchId,userId });
    if (!context) return { error: 'not_member' };
    const events = (await this.pool.query(
      `SELECT seq,event_type,actor_user_id,command_id,payload,state_hash,created_at
         FROM multiplayer_match_events WHERE match_id=$1 AND seq>$2 ORDER BY seq LIMIT $3`,
      [matchId,afterSeq,limit],
    )).rows.map(eventView);
    return { context,events };
  }

  async applyAction({ matchId, userId, commandId, expectedRevision, now, transition }) {
    return transaction(this.pool, async client => {
      const context = await loadContext(client, { matchId,userId,lock: true });
      if (!context) return { error: 'not_member' };
      const duplicate = (await client.query(
        'SELECT seq,event_type,actor_user_id,command_id,payload,state_hash,created_at FROM multiplayer_match_events WHERE match_id=$1 AND command_id=$2',
        [matchId,commandId],
      )).rows[0];
      if (duplicate) {
        if (duplicate.actor_user_id !== userId) return { error: 'command_conflict' };
        return { replay: true, event: eventView(duplicate), context };
      }
      if (context.status !== 'active') return { error: 'not_active', context };
      if (context.revision !== String(expectedRevision)) return { error: 'revision_conflict', context };
      const output = await transition(context);
      return persistTransition(client, { context,output,actorUserId: userId,commandId,now });
    });
  }

  async listDueMatchIds({ now, limit = 50 }) {
    return (await this.pool.query(
      "SELECT id FROM multiplayer_matches WHERE status='active' AND turn_deadline_at<=$1 ORDER BY turn_deadline_at,id LIMIT $2",
      [now,limit],
    )).rows.map(row => row.id);
  }

  async applyTimeout({ matchId, now, transition }) {
    return transaction(this.pool, async client => {
      const context = await loadContext(client, { matchId,lock: true });
      if (!context || context.status !== 'active' || !context.turnDeadlineAt || context.turnDeadlineAt > now) return { stale: true,context };
      const output = await transition(context);
      return persistTransition(client, { context,output,actorUserId: null,commandId: null,now });
    });
  }
}
