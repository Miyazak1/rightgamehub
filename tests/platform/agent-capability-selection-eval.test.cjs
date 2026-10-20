const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const fixturePath = path.join(__dirname, 'fixtures/agent-capability-selection-evals.v1.json');
const advertisedTools = new Set([
  'search_capabilities',
  'get_capability',
  'launch_capability',
  'search_games',
  'get_game',
  'open_gamehub',
  'open_knowledge_map',
  'open_pdf_reader',
  'open_change_radar',
  'open_privacy_redactor',
  'open_document_compare',
  'open_spreadsheet_audit',
]);
const prohibitedGenericTools = ['invoke_capability', 'call_internal_api', 'run_game_action', 'publish_work', 'purchase'];

test('agent capability golden prompts are complete, bilingual, and reference only advertised bounded tools', async () => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(fixture.description.includes('deterministic release contract'));
  assert.ok(Array.isArray(fixture.cases));
  assert.ok(fixture.cases.length >= 15);

  const ids = new Set();
  const categories = new Set();
  const locales = new Set();
  for (const entry of fixture.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/u);
    assert.equal(ids.has(entry.id), false, `duplicate evaluation ID: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(['zh-CN', 'en'].includes(entry.locale), `${entry.id} has an unsupported locale`);
    assert.ok(['direct', 'indirect', 'follow-up', 'write', 'unsupported', 'boundary'].includes(entry.category), `${entry.id} has an unsupported category`);
    assert.equal(typeof entry.prompt, 'string');
    assert.ok(entry.prompt.length > 5 && entry.prompt.length <= 500, `${entry.id} prompt must stay bounded`);
    assert.ok(Array.isArray(entry.allowedAlternatives));
    assert.ok(Array.isArray(entry.forbiddenTools));
    assert.ok(Array.isArray(entry.argumentAssertions));
    if (entry.expectedTool !== null) assert.ok(advertisedTools.has(entry.expectedTool), `${entry.id} expects an unknown tool`);
    for (const tool of [...entry.allowedAlternatives, ...entry.forbiddenTools]) assert.ok(advertisedTools.has(tool), `${entry.id} references an unknown tool: ${tool}`);
    assert.equal(entry.forbiddenTools.includes(entry.expectedTool), false, `${entry.id} both expects and forbids ${entry.expectedTool}`);
    categories.add(entry.category);
    locales.add(entry.locale);
  }

  assert.deepEqual([...locales].sort(), ['en', 'zh-CN']);
  assert.deepEqual([...categories].sort(), ['boundary', 'direct', 'follow-up', 'indirect', 'unsupported', 'write']);
  assert.ok(fixture.cases.some(entry => entry.expectedTool === null), 'at least one prompt must intentionally select no tool');
  assert.ok(fixture.cases.some(entry => entry.confirmation === 'ui-review-required'), 'at least one staged write must require UI review');
});

test('golden prompt tool inventory remains synchronized with the MCP server contract', async () => {
  const serverSource = await fs.readFile(path.join(root, 'apps/api/src/gamehub-mcp-server.mjs'), 'utf8');
  for (const tool of advertisedTools) {
    if (tool.startsWith('open_') && tool !== 'open_gamehub') continue;
    assert.match(serverSource, new RegExp(`['\"]${tool}['\"]`, 'u'), `${tool} must remain registered by the MCP server`);
  }
  const officialManifest = await fs.readFile(path.join(root, 'packages/agent-capabilities/src/manifests/official-tools.mjs'), 'utf8');
  for (const tool of [...advertisedTools].filter(name => name.startsWith('open_') && name !== 'open_gamehub')) {
    assert.match(officialManifest, new RegExp(`toolName:\\s*['\"]${tool}['\"]`, 'u'), `${tool} must remain in the strict official registry`);
  }
  for (const tool of prohibitedGenericTools) {
    assert.doesNotMatch(serverSource, new RegExp(`register(?:App)?Tool\\(server,\\s*['\"]${tool}['\"]`, 'u'));
  }
});
