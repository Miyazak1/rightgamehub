const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

test('research capacity gate rejects missing evidence and labels smoke honestly', async () => {
  const { evaluateResearchCapacity } = await import('../../scripts/research-capacity-gate.mjs');
  const metric = { count: 6, p95: 10, p99: 15 };
  const report = {
    smoke: true,
    migrations: { applied: 104, expected: 104 },
    target: { accounts: 2, topics: 6, runs: 30, sourceVersions: 30, events: 120, evidence: 120 },
    actual: { accounts: 2, topics: 6, runs: 30, sourceVersions: 30, events: 120, evidence: 120 },
    thresholds: { listTopicsP95Ms: 150, listRunsP95Ms: 150, listEvidenceP95Ms: 250, operationsSummaryP95Ms: 350, storageAssessmentP95Ms: 500, schedulerClaimP95Ms: 250, maxGrowthBytes: 1024 },
    latency: { listTopics: metric, listRuns: metric, listEvidence: metric, operationsSummary: metric, storageAssessment: metric, schedulerClaim: metric },
    scheduler: { queued: 6, completed: 6, remaining: 0 },
    invariants: { crossAccountVisibleTopics: 0, crossAccountEvidence: 0, orphanContracts: 0, orphanEvents: 0, orphanEvidenceLinks: 0, externalActions: 0 },
    storage: { growthBytes: 100 }, errors: [],
  };
  const passed = evaluateResearchCapacity(report);
  assert.equal(passed.localGatePassed, true);
  assert.equal(passed.productionReady, false);
  assert.equal(passed.qualification, 'smoke-only');
  for (const mutate of [
    value => { value.latency.listEvidence.p95 = 999; },
    value => { value.scheduler.remaining = 1; },
    value => { value.invariants.crossAccountEvidence = 1; },
    value => { value.invariants.orphanEvents = 1; },
    value => { value.invariants.externalActions = 1; },
    value => { value.storage.growthBytes = 2048; },
  ]) {
    const broken = structuredClone(report); mutate(broken);
    assert.equal(evaluateResearchCapacity(broken).localGatePassed, false);
  }
});

test('research capacity runner is local-only and excludes claims it cannot prove', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/run-research-capacity.mjs'), 'utf8');
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]/u);
  assert.match(source, /gamehub_\[a-z0-9_\]\+_test/u);
  assert.match(source, /14-day soak/u);
  assert.match(source, /external Search\/Fetch\/Researcher calls/u);
  assert.match(source, /productionReady: false/u);
  assert.match(source, /crossAccountEvidence/u);
  assert.match(source, /storageAssessment/u);
  assert.match(source, /externalActions/u);
  assert.match(source, /if \(!report\.localGatePassed\) process\.exitCode = 1/u);
});
