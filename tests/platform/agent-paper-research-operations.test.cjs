const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('R1.9 reuses persisted runtime facts and exposes a bounded operator recovery',()=>{
  const service=read('apps/api/src/agent-paper-research-operations.mjs');
  const repository=read('apps/api/src/agent-runtime-repository.mjs');
  const routes=read('apps/api/src/agent-account-routes.mjs');
  assert.match(service,/agent_runtime_workers/);
  assert.match(service,/agent_budget_reservations/);
  assert.match(service,/recoverExpiredStages\(\{stageId:/);
  assert.match(service,/PAPER_RESEARCH_OPERATIONS_LEASE_ACTIVE/);
  assert.match(repository,/\$2::uuid IS NULL OR id=\$2/);
  assert.match(routes,/paper-research-operations/);
  assert.match(routes,/recover-expired-stage/);
  assert.doesNotMatch(service,/blog_articles|blog\.article\.publish|publishArticle/);
});

test('R1.9 migration scopes and freezes operator actions',()=>{
  const sql=read('apps/api/migrations/0152_agent_runtime_operator_actions.sql');
  assert.match(sql,/CREATE TABLE agent_runtime_operator_actions/);
  assert.match(sql,/UNIQUE\(agent_user_id,request_id\)/);
  assert.match(sql,/operator action stage belongs to another run/);
  assert.match(sql,/agent_runtime_operator_actions_immutable/);
});

test('R1.9 admin panel renders health, metrics and reason-gated recovery',()=>{
  const admin=read('packages/platform-client/src/AgentAdmin.jsx');
  assert.match(admin,/RESEARCH OPERATIONS · R1\.9/);
  assert.match(admin,/getAdminAgentPaperResearchOperations/);
  assert.match(admin,/reason\.trim\(\)\.length<10/);
  assert.match(admin,/recoverAdminAgentPaperResearchExpiredStage/);
});

test('R1.10 persists alert episodes, weekly reports and retention audits without a second scheduler',()=>{
  const service=read('apps/api/src/agent-paper-research-operations.mjs');
  const migration=read('apps/api/migrations/0153_agent_paper_research_operations_lifecycle.sql');
  const worker=read('apps/api/src/agent-paper-research-worker-cli.mjs');
  const compose=read('deploy/compose.prod.yml');
  assert.match(migration,/CREATE TABLE agent_research_operation_alerts/);
  assert.match(migration,/CREATE TABLE agent_research_weekly_reports/);
  assert.match(migration,/CREATE TABLE agent_research_retention_runs/);
  assert.match(migration,/agent_research_operation_alert_events_immutable/);
  assert.match(service,/agent_research_metric_snapshots/);
  assert.match(service,/agent_research_operation_deliveries/);
  assert.match(service,/protectedRecords/);
  assert.match(worker,/operationsRunning/);
  assert.match(worker,/paperResearchOperations\.evaluate/);
  assert.doesNotMatch(worker,/createServer|listen\(/);
  assert.match(compose,/AGENT_PAPER_RESEARCH_OPERATIONS_INTERVAL_SECONDS/);
  assert.match(compose,/MAIL_PROVIDER: resend/);
  assert.match(compose,/RESEND_API_KEY/);
});

test('R1.10 exposes policy, retention and lifecycle controls through API and admin UI',()=>{
  const routes=read('apps/api/src/agent-account-routes.mjs');
  const client=read('packages/platform-api-client/src/index.mjs');
  const admin=read('packages/platform-client/src/AgentAdmin.jsx');
  assert.match(routes,/paper-research-operations\/policy/);
  assert.match(routes,/paper-research-operations\/retention-preview/);
  assert.match(routes,/paper-research-operations\/retention-runs/);
  assert.match(client,/setAdminAgentPaperResearchOperationsPolicy/);
  assert.match(client,/previewAdminAgentPaperResearchRetention/);
  assert.match(client,/applyAdminAgentPaperResearchRetention/);
  assert.match(admin,/RESEARCH RELIABILITY · R1\.10/);
  assert.match(admin,/持久告警/);
  assert.match(admin,/运营周报/);
  assert.match(admin,/永久保留/);
});
