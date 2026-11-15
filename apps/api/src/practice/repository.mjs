import { randomUUID } from 'node:crypto';
import { withTransaction } from '../database.mjs';
import { rejectPractice } from './error.mjs';
import { queryLearningInsights } from './insights.mjs';

const map = row => row && ({ id: row.id, userId: row.user_id, config: row.config, status: row.status,
  items: row.items, currentIndex: row.current_index, revision: row.revision, previousId: row.previous_id,
  attempts: row.attempts, leaseToken: row.lease_token, errorCode: row.error_code,
  createdAt: row.created_at, completedAt: row.completed_at });
const ownerLock = (client, userId) => client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`practice:${userId}`]);

export class PostgresPracticeRepository {
  constructor(pool) { this.pool = pool; }
  insights(userId,query) { return queryLearningInsights(this.pool,userId,query); }
  async create(userId, config, key, previousId = null) {
    return withTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('practice:queue-admission'))");
      await ownerLock(client, userId);
      const old = map((await client.query('SELECT * FROM practice_batches WHERE user_id=$1 AND request_key=$2', [userId, key])).rows[0]);
      if (old) {
        if (old.previousId !== previousId || Object.keys(config).some(k => old.config[k] !== config[k])) rejectPractice('PRACTICE_KEY_CONFLICT', 409, '本次请求与已有练习不一致。');
        return old;
      }
      if (previousId) {
        const previous = map((await client.query('SELECT * FROM practice_batches WHERE id=$1 AND user_id=$2', [previousId, userId])).rows[0]);
        if (!previous) rejectPractice('PRACTICE_NOT_FOUND', 404, '练习不存在。');
        if (previous.status !== 'completed') rejectPractice('PRACTICE_NOT_COMPLETED', 409, '请先提交当前练习。');
        const next = map((await client.query('SELECT * FROM practice_batches WHERE previous_id=$1', [previousId])).rows[0]);
        if (next) return next;
        config = previous.config;
      }
      const active = await client.query("SELECT count(*)::int AS n FROM practice_batches WHERE user_id=$1 AND status IN ('queued','preparing')", [userId]);
      if (active.rows[0].n >= 2) rejectPractice('PRACTICE_BUSY', 429, '已有练习正在准备，请稍候。');
      const global = await client.query("SELECT count(*)::int AS n FROM practice_batches WHERE status IN ('queued','preparing')");
      if (global.rows[0].n >= 32) rejectPractice('PRACTICE_BUSY', 429, '当前练习准备较多，请稍后重试。');
      return map((await client.query('INSERT INTO practice_batches(id,user_id,config,request_key,previous_id) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), userId, config, key, previousId])).rows[0]);
    });
  }
  async get(userId, id) { return map((await this.pool.query('SELECT * FROM practice_batches WHERE user_id=$1 AND id=$2', [userId, id])).rows[0]); }
  async retry(userId, id) {
    return withTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('practice:queue-admission'))");
      await ownerLock(client, userId);
      const batch = map((await client.query('SELECT * FROM practice_batches WHERE user_id=$1 AND id=$2 FOR UPDATE', [userId, id])).rows[0]);
      if (!batch) rejectPractice('PRACTICE_NOT_FOUND', 404, '练习不存在。');
      if (batch.status !== 'failed') return batch;
      const counts = (await client.query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE user_id=$1)::int AS own FROM practice_batches WHERE status IN ('queued','preparing')`, [userId])).rows[0];
      if (counts.own >= 2 || counts.total >= 32) rejectPractice('PRACTICE_BUSY', 429, '已有练习正在准备，请稍后重试。');
      return map((await client.query(`UPDATE practice_batches SET status='queued',error_code=null,attempts=0,
        lease_token=null,lease_until=null,updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *`, [id])).rows[0]);
    });
  }
  async history(userId) { return (await this.pool.query('SELECT * FROM practice_batches WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId])).rows.map(map); }
  async stats(userId) {
    const topics = (await this.pool.query(`SELECT b.config->>'topicId' AS "topicId", count(*)::int AS attempted,
      count(*) FILTER(WHERE item->>'answer'=item->'question'->>'correctAnswer')::int AS correct
      FROM practice_batches b CROSS JOIN LATERAL jsonb_array_elements(b.items) item
      WHERE b.user_id=$1 AND b.status='completed' GROUP BY b.config->>'topicId'`, [userId])).rows;
    const wrong = (await this.pool.query(`SELECT b.id AS "batchId", b.config, item
      FROM practice_batches b CROSS JOIN LATERAL jsonb_array_elements(b.items) item
      WHERE b.user_id=$1 AND b.status='completed' AND (item->>'answer' IS DISTINCT FROM item->'question'->>'correctAnswer')
      ORDER BY b.completed_at DESC LIMIT 100`, [userId])).rows;
    return { topics, wrong };
  }
  async mutate(userId, id, change) {
    return withTransaction(this.pool, async client => {
      const batch = map((await client.query('SELECT * FROM practice_batches WHERE user_id=$1 AND id=$2 FOR UPDATE', [userId, id])).rows[0]);
      if (!batch) rejectPractice('PRACTICE_NOT_FOUND', 404, '练习不存在。');
      const changed = change(batch);
      if (changed !== false) {
        const row = await client.query(`UPDATE practice_batches SET items=$3,status=$4,current_index=$5,revision=revision+1,
          error_code=$6,attempts=CASE WHEN $4='queued' THEN 0 ELSE attempts END,updated_at=now(),completed_at=CASE WHEN $4='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END
          WHERE user_id=$1 AND id=$2 RETURNING *`, [userId, id, JSON.stringify(batch.items), batch.status, batch.currentIndex, batch.errorCode]);
        return map(row.rows[0]);
      }
      return batch;
    });
  }
  async claim() {
    return withTransaction(this.pool, async client => {
      const candidate = (await client.query(`SELECT * FROM practice_batches WHERE status='queued'
        OR (status='preparing' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
      if (!candidate) return null;
      if (candidate.attempts >= 3) {
        await client.query("UPDATE practice_batches SET status='failed',error_code='PRACTICE_PREPARATION_FAILED',lease_token=null,lease_until=null WHERE id=$1", [candidate.id]);
        return null;
      }
      return map((await client.query(`UPDATE practice_batches SET status='preparing',attempts=attempts+1,
        lease_token=$2,lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1 RETURNING *`, [candidate.id, randomUUID()])).rows[0]);
    });
  }
  async renew(batch) { return (await this.pool.query("UPDATE practice_batches SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND status='preparing'", [batch.id, batch.leaseToken])).rowCount === 1; }
  async available(batch) {
    return (await this.pool.query(`SELECT payload FROM practice_questions q WHERE topic_id=$1 AND difficulty_id=$2
      AND NOT EXISTS(SELECT 1 FROM practice_exposures e WHERE e.user_id=$3 AND e.identity_key=q.identity_key)
      ORDER BY q.created_at LIMIT $4`, [batch.config.topicId, batch.config.difficultyId, batch.userId, batch.config.count])).rows.map(r => r.payload);
  }
  async unseen(userId, identityKey) { return !(await this.pool.query('SELECT 1 FROM practice_exposures WHERE user_id=$1 AND identity_key=$2', [userId, identityKey])).rowCount; }
  async publish(batch, questions) {
    return withTransaction(this.pool, async client => {
      await ownerLock(client, batch.userId);
      const current = (await client.query("SELECT 1 FROM practice_batches WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND status='preparing' FOR UPDATE", [batch.id, batch.leaseToken])).rowCount;
      if (!current) return false;
      if (questions.length !== batch.config.count || new Set(questions.map(q => q.identityKey)).size !== questions.length
        || questions.some(q => q.topicId !== batch.config.topicId || q.difficultyId !== batch.config.difficultyId)) throw new Error('PRACTICE_PUBLICATION_REJECTED');
      const items = [];
      for (const q of questions) {
        await client.query('INSERT INTO practice_questions(id,identity_key,topic_id,difficulty_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(identity_key) DO NOTHING', [q.id, q.identityKey, q.topicId, q.difficultyId, q]);
        const stored = (await client.query('SELECT payload FROM practice_questions WHERE identity_key=$1', [q.identityKey])).rows[0].payload;
        const exposed = await client.query('INSERT INTO practice_exposures(user_id,identity_key,batch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING identity_key', [batch.userId, q.identityKey, batch.id]);
        if (!exposed.rowCount) throw new Error('PRACTICE_EXPOSURE_CONFLICT');
        items.push({ question: stored, answer: null, checked: false, elapsedSeconds: 0 });
      }
      await client.query(`UPDATE practice_batches SET status='ready',items=$3,revision=revision+1,lease_token=null,lease_until=null,error_code=null,updated_at=now()
        WHERE id=$1 AND lease_token=$2`, [batch.id, batch.leaseToken, JSON.stringify(items)]);
      return true;
    });
  }
  async fail(batch, code) {
    await this.pool.query("UPDATE practice_batches SET status='failed',error_code=$3,lease_token=null,lease_until=null,updated_at=now() WHERE id=$1 AND lease_token=$2", [batch.id, batch.leaseToken, code]);
  }
}
