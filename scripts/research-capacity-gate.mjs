export function evaluateResearchCapacity(report) {
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  add('schema version is current', report.migrations?.applied === report.migrations?.expected && report.migrations?.expected === 104);
  add('fixture cardinality matches target', Object.entries(report.actual ?? {}).length > 0
    && Object.entries(report.actual).every(([key, value]) => report.target?.[key] === value));
  for (const [name, metric] of Object.entries(report.latency ?? {})) {
    const limit = report.thresholds?.[name + 'P95Ms'];
    add(name + ' has samples', metric.count >= (report.smoke ? 3 : 50));
    add(name + ' p95 is bounded', Number.isFinite(metric.p95) && Number.isFinite(limit) && metric.p95 <= limit);
  }
  add('scheduler drained all queued fixtures', report.scheduler?.queued === report.scheduler?.completed && report.scheduler?.remaining === 0);
  add('account isolation held', report.invariants?.crossAccountVisibleTopics === 0 && report.invariants?.crossAccountEvidence === 0);
  add('research references are intact', Object.entries(report.invariants ?? {}).filter(([key]) => key.startsWith('orphan')).every(([, value]) => value === 0));
  add('no external actions were created', report.invariants?.externalActions === 0);
  add('database growth stayed within the local fixture budget', report.storage?.growthBytes >= 0 && report.storage?.growthBytes <= report.thresholds?.maxGrowthBytes);
  add('runner reported no errors', Array.isArray(report.errors) && report.errors.length === 0);
  return {
    checks,
    localGatePassed: checks.every(check => check.ok),
    productionReady: false,
    qualification: report.smoke ? 'smoke-only' : 'local-target-scale',
  };
}
