const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const moduleUrl = relativePath => pathToFileURL(path.join(root, relativePath)).href;

test('official Agent capabilities are strict, immutable and uniquely addressable', async () => {
  const registry = await import(moduleUrl('packages/agent-capabilities/src/index.mjs'));
  const snapshot = registry.getAgentCapabilityRegistrySnapshot();

  assert.equal(snapshot.revision, 'official-tools-v1');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.capabilities.length, 6);
  assert.equal(new Set(snapshot.capabilities.map(item => item.id)).size, 6);
  assert.equal(new Set(snapshot.capabilities.map(item => item.toolId)).size, 6);
  assert.equal(new Set(snapshot.capabilities.map(item => item.mcp.toolName)).size, 6);
  assert.equal(new Set(snapshot.capabilities.map(item => item.launch.route)).size, 6);

  for (const capability of snapshot.capabilities) {
    assert.equal(capability.format, registry.AGENT_CAPABILITY_FORMAT);
    assert.equal(capability.schemaVersion, registry.AGENT_CAPABILITY_SCHEMA_VERSION);
    assert.equal(capability.id, `official-tool:${capability.toolId}`);
    assert.equal(capability.kind, 'official-tool');
    assert.equal(capability.trustTier, 'official-tool');
    assert.equal(capability.status, 'available');
    assert.ok(capability.title['zh-CN']);
    assert.ok(capability.title.en);
    assert.ok(capability.summary['zh-CN']);
    assert.ok(capability.summary.en);
    assert.ok(capability.discovery.tags.length);
    assert.ok(capability.discovery.intents.length);
    assert.equal(capability.launch.adapter, 'hosted-ui');
    assert.equal(capability.launch.webFallback, true);
    assert.equal(capability.mcp.annotations.destructiveHint, false);
    assert.equal(capability.mcp.annotations.openWorldHint, false);
    assert.ok(Object.isFrozen(capability));
    assert.ok(Object.isFrozen(capability.discovery));
    assert.ok(Object.isFrozen(capability.launch));
    assert.ok(Object.isFrozen(capability.mcp.annotations));
    assert.equal(registry.findAgentCapability(capability.id), capability);
    assert.equal(registry.findOfficialToolCapability(capability.toolId), capability);
    assert.equal(registry.findCapabilityByMcpToolName(capability.mcp.toolName), capability);
    assert.equal(registry.findCapabilityByRoute(capability.launch.route), capability);
  }

  const source = snapshot.capabilities[0];
  assert.throws(
    () => registry.defineOfficialToolCapability({ ...source, unexpected: true }),
    /unknown field unexpected/u,
  );
  assert.throws(
    () => registry.defineOfficialToolCapability({ ...source, id: 'official-tool:another-tool' }),
    /id must use the official-tool namespace/u,
  );
  assert.throws(
    () => registry.requireOfficialToolCapability('user-uploaded-tool'),
    /Unknown official tool capability/u,
  );
});

test('frontend and MCP server consume the same official capability metadata', async t => {
  const [registry, frontend, { createGameHubMcpServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import(moduleUrl('packages/agent-capabilities/src/index.mjs')),
    import(moduleUrl('packages/platform-client/src/official-tools.mjs')),
    import(moduleUrl('apps/api/src/gamehub-mcp-server.mjs')),
    import(moduleUrl('apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')),
    import(moduleUrl('apps/api/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js')),
  ]);

  assert.deepEqual(
    frontend.officialTools.map(tool => tool.id),
    registry.officialToolCapabilities.map(capability => capability.toolId),
  );
  for (const capability of registry.officialToolCapabilities) {
    const tool = frontend.findOfficialTool(capability.toolId);
    assert.ok(tool);
    assert.equal(tool.route, capability.launch.route);
    assert.equal(tool.titleKey, capability.titleKey);
    assert.equal(tool.descriptionKey, capability.descriptionKey);
    assert.deepEqual(tool.layouts, capability.launch.layouts);
    assert.deepEqual(tool.capabilities, capability.capabilities);
    assert.equal(typeof tool.load, 'function');
    assert.equal(tool.mcp, undefined);
    assert.equal(tool.dataPolicy, undefined);
  }

  const server = createGameHubMcpServer({
    siteOrigin: 'https://mooyu.fun',
    catalogService: { list: async () => [], get: async () => ({ id: 'unused', kind: 'game' }) },
  });
  const client = new Client({ name: 'agent-capability-registry-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const listed = await client.listTools();
  for (const capability of registry.officialToolCapabilities) {
    const tool = listed.tools.find(item => item.name === capability.mcp.toolName);
    assert.ok(tool, `Missing MCP tool ${capability.mcp.toolName}`);
    assert.equal(tool.title, capability.mcp.title);
    assert.equal(tool.description, capability.mcp.description);
    assert.deepEqual(tool.annotations, capability.mcp.annotations);
    assert.equal(tool._meta['openai/toolInvocation/invoking'], capability.mcp.invoking);
    assert.equal(tool._meta['openai/toolInvocation/invoked'], capability.mcp.invoked);
  }
});

test('production images include the shared Agent capability workspace package', async () => {
  const dockerfiles = await Promise.all(
    ['api', 'builder', 'rule-builder', 'validator', 'web'].map(name =>
      fs.readFile(path.join(root, `deploy/Dockerfile.${name}`), 'utf8').then(source => [name, source]),
    ),
  );
  for (const [name, source] of dockerfiles) {
    assert.match(
      source,
      /COPY packages\/agent-capabilities\/package\.json packages\/agent-capabilities\/package\.json/u,
      `Dockerfile.${name} must expose the workspace manifest before pnpm install`,
    );
  }
  for (const name of ['api', 'web']) {
    const source = dockerfiles.find(([candidate]) => candidate === name)[1];
    assert.match(
      source,
      /COPY(?: --chown=node:node)? packages\/agent-capabilities (?:\.\/)?packages\/agent-capabilities/u,
      `Dockerfile.${name} must copy the Agent capability runtime source`,
    );
  }
});
