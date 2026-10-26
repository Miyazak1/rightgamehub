const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const harness = require('./support/researcher-qa-db.cjs');

const root = path.resolve(__dirname, '../..');
const moduleUrl = pathToFileURL(path.join(root,
  'apps/api/src/agent-blog-publication-ownership.mjs'));
const agentUserId = '11111111-1111-4111-8111-111111111111';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 'agent-blog-publication-cutover-snapshot-v1',
    agentUserId,
    owner: { activePublisher: 'legacy', generation: 1, reason: 'seeded',
      switchedAt: '2026-10-26T00:00:00.000Z' },
    execution: { legacyActiveRuns: 0, foundationActiveRuns: 0, foundationUncertainRuns: 0 },
    foundation: { workflowStatus: 'active', publishCapabilityActive: true,
      autoPublishPolicyEnabled: true },
    acceptance: { consecutivePasses: 3 },
    privateSchedule: { consecutivePasses: 3 },
    ...overrides,
  };
}

test('publication ownership migration creates one serialized owner and immutable audit history', () => {
  const sql = fs.readFileSync(path.join(root,
    'apps/api/migrations/0137_agent_blog_publication_ownership.sql'), 'utf8');
  assert.match(sql, /agent_user_id uuid PRIMARY KEY REFERENCES agent_accounts/u);
  assert.match(sql, /active_publisher IN \('legacy','foundation'\)/u);
  assert.match(sql, /NEW\.generation<>OLD\.generation\+1/u);
  assert.match(sql, /AFTER UPDATE ON agent_blog_publication_owners/u);
  assert.match(sql, /Agent blog publication ownership events are immutable/u);
  assert.match(sql, /AFTER INSERT ON agent_accounts/u);
});

test('cutover preflight passes only with quiescent execution and both evidence gates complete', async () => {
  const { evaluateAgentBlogPublicationCutover } = await import(moduleUrl.href);
  const result = evaluateAgentBlogPublicationCutover(snapshot());
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.automaticSwitch, false);
  assert.equal(result.evidence.requiredAcceptancePasses, 3);
  assert.equal(result.evidence.requiredScheduledPasses, 3);
});

test('cutover preflight reports every unsafe condition without changing ownership', async () => {
  const { evaluateAgentBlogPublicationCutover } = await import(moduleUrl.href);
  const result = evaluateAgentBlogPublicationCutover(snapshot({
    execution: { legacyActiveRuns: 1, foundationActiveRuns: 2, foundationUncertainRuns: 1 },
    foundation: { workflowStatus: null, publishCapabilityActive: false,
      autoPublishPolicyEnabled: false },
    acceptance: { consecutivePasses: 1 }, privateSchedule: { consecutivePasses: 0 },
  }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, [
    'LEGACY_RUN_ACTIVE', 'FOUNDATION_RUN_ACTIVE', 'FOUNDATION_RUN_UNCERTAIN',
    'FOUNDATION_PUBLIC_WORKFLOW_NOT_ACTIVE', 'FOUNDATION_PUBLISH_CAPABILITY_MISSING',
    'FOUNDATION_AUTO_PUBLISH_POLICY_DISABLED', 'PRIVATE_ACCEPTANCE_INCOMPLETE',
    'PRIVATE_SCHEDULE_EVIDENCE_INCOMPLETE',
  ]);
  assert.equal(result.owner.activePublisher, 'legacy');
  assert.equal(result.automaticSwitch, false);
});

test('publisher assertion locks the same ownership row and fails closed after cutover', async () => {
  const { PostgresAgentBlogPublicationOwnershipRepository } = await import(moduleUrl.href);
  let sql = '';
  const repository = new PostgresAgentBlogPublicationOwnershipRepository({ query: async statement => {
    sql = statement;
    return { rows: [{ active_publisher: 'foundation', generation: '2', reason: 'cutover',
      switched_at: new Date('2026-10-26T00:00:00.000Z') }] };
  } });
  await assert.rejects(repository.assertPublisher(repository.pool, agentUserId, 'legacy'),
    error => error.code === 'AGENT_BLOG_PUBLICATION_OWNER_MISMATCH');
  assert.match(sql, /FOR UPDATE/u);
});

test('legacy publisher checks ownership inside its publication transaction', () => {
  const source = fs.readFileSync(path.join(root, 'apps/api/src/agent-blog-automation.mjs'), 'utf8');
  const guard = source.indexOf("assertPublisher(client,run.agent_user_id,'legacy')");
  const article = source.indexOf('INSERT INTO blog_articles', guard);
  assert.ok(guard > -1);
  assert.ok(article > guard);
  assert.match(source, /publisher:'legacy'/u);
});

test('admin exposes separate read-only preflight and explicit guarded cutover endpoints', () => {
  const routes = fs.readFileSync(path.join(root, 'apps/api/src/agent-account-routes.mjs'), 'utf8');
  assert.match(routes, /\.get\('\/v1\/admin\/agents\/:agentUserId\/blog-publication-cutover-preflight'/u);
  assert.match(routes, /\.post\('\/v1\/admin\/agents\/:agentUserId\/blog-publication-cutover'/u);
  assert.match(routes, /\.post\('\/v1\/admin\/agents\/:agentUserId\/blog-publication-rollback'/u);
  assert.doesNotMatch(routes, /\.put\([^\n]*blog-publication-cutover/u);
});

test('rollback remains explicit, generation-bound, and never re-enables legacy scheduling', async () => {
  const { createAgentBlogPublicationCutoverService } = await import(moduleUrl.href);
  const calls = [];
  const service = createAgentBlogPublicationCutoverService({
    repository: {
      snapshot: async () => snapshot(), cutover: async () => ({}),
      rollback: async input => (calls.push(input), {
        owner: { activePublisher: 'legacy' }, legacyScheduleEnabled: false,
      }),
    },
    authorizeOperator: async () => true,
  });
  const actorUserId = crypto.randomUUID();
  const result = await service.rollback({ userId: actorUserId }, agentUserId,
    { expectedGeneration: 2, reason: 'incident rollback' });
  assert.equal(result.owner.activePublisher, 'legacy');
  assert.equal(result.legacyScheduleEnabled, false);
  assert.deepEqual(calls[0], { agentUserId, actorUserId, expectedGeneration: 2,
    reason: 'incident rollback' });
  const source = fs.readFileSync(path.join(root,
    'apps/api/src/agent-blog-publication-ownership.mjs'), 'utf8');
  assert.match(source, /AGENT_BLOG_PUBLICATION_ROLLBACK_BLOCKED/u);
  assert.match(source, /legacyScheduleEnabled: false, automaticResume: false/u);
});

test('cutover service requires an administrator and forwards an expected generation', async () => {
  const { createAgentBlogPublicationCutoverService } = await import(moduleUrl.href);
  const calls = [];
  const service = createAgentBlogPublicationCutoverService({
    repository: {
      snapshot: async () => snapshot(),
      cutover: async input => (calls.push(input), { owner: { activePublisher: 'foundation' } }),
    },
    authorizeOperator: async actor => actor.profile?.role === 'admin',
  });
  await assert.rejects(service.cutover({ userId: crypto.randomUUID(), profile: { role: 'member' } },
    agentUserId, { expectedGeneration: 1, reason: 'verified rollout' }),
  error => error.code === 'AGENT_OPERATOR_REQUIRED');
  const actorUserId = crypto.randomUUID();
  const result = await service.cutover({ userId: actorUserId, profile: { role: 'admin' } }, agentUserId,
    { expectedGeneration: 1, reason: 'verified rollout' });
  assert.equal(result.owner.activePublisher, 'foundation');
  assert.deepEqual(calls[0], { agentUserId, actorUserId, expectedGeneration: 1,
    reason: 'verified rollout' });
});

test('legacy scheduling and manual enqueue are guarded by the same ownership row', () => {
  const source = fs.readFileSync(path.join(root, 'apps/api/src/agent-blog-automation.mjs'), 'utf8');
  assert.match(source, /owner\.active_publisher='legacy'/u);
  assert.ok(source.match(/assertPublisher\(client,[^,]+,'legacy'\)/gu).length >= 4);
});

test('PostgreSQL seeds one legacy owner and atomically audits a valid handoff',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const operatorId = crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Publication operator','admin')",
      [operatorId]);
    const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
    const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
    const account = await createAgentAccountService({
      repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
    }).provision({ userId: operatorId }, {
      provisionKey: `publication-${crypto.randomUUID()}`, displayName: 'Publication Agent',
      handle: `publication-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
      operatorLabel: 'Publication test', capabilities: ['blog:auto-publish'], metadata: {},
    });
    const agentUserId = account.agentUserId;
    const seeded = (await admin.query(`SELECT * FROM agent_blog_publication_owners
      WHERE agent_user_id=$1`, [agentUserId])).rows[0];
    assert.equal(seeded.active_publisher, 'legacy');
    assert.equal(Number(seeded.generation), 1);
    await assert.rejects(admin.query(`UPDATE agent_blog_publication_owners
      SET active_publisher='foundation' WHERE agent_user_id=$1`, [agentUserId]),
    /Invalid Agent blog publication ownership transition/u);
    await admin.query(`UPDATE agent_blog_publication_owners SET active_publisher='foundation',
      generation=generation+1,reason='test cutover',updated_by_user_id=$2,
      switched_at=GREATEST(clock_timestamp(),switched_at+interval '1 microsecond'),
      updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
      WHERE agent_user_id=$1`,
    [agentUserId, operatorId]);
    const events = (await admin.query(`SELECT generation,previous_publisher,active_publisher
      FROM agent_blog_publication_owner_events WHERE agent_user_id=$1 ORDER BY generation`,
    [agentUserId])).rows;
    assert.deepEqual(events.map(row => ({ generation: Number(row.generation),
      previous: row.previous_publisher, active: row.active_publisher })), [
      { generation: 1, previous: null, active: 'legacy' },
      { generation: 2, previous: 'legacy', active: 'foundation' },
    ]);
    await assert.rejects(admin.query(`DELETE FROM agent_blog_publication_owner_events
      WHERE agent_user_id=$1`, [agentUserId]), /ownership events are immutable/u);
    await admin.end();
  });
