const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);

const json = value => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const raw = (value, name) => new Response(value, {
  status: 200, headers: { 'content-type': 'text/plain',
    'content-disposition': `attachment; filename="${name}"` },
});

test('GitHub materials adapter returns revision-pinned official materials in one bounded tool call', async () => {
  const { createGitHubRepositoryMaterialsAdapter,
    validateGitHubRepositoryMaterialsOutput } = await load('agent-github-repository-materials-tool.mjs');
  const revision = 'a'.repeat(40);
  const requests = [];
  const fetchImpl = async url => {
    const parsed = new URL(url);
    requests.push(parsed.pathname + parsed.search);
    if (parsed.pathname === '/repos/owner/project') return json({ name: 'project', full_name: 'owner/project',
      description: 'A useful project', default_branch: 'main', stargazers_count: 50, forks_count: 5,
      open_issues_count: 2, topics: ['agent'], license: { spdx_id: 'MIT' }, archived: false,
      pushed_at: '2026-10-26T00:00:00.000Z' });
    if (parsed.pathname.endsWith('/git/ref/heads/main')) return json({ object: { type: 'commit', sha: revision } });
    if (parsed.pathname.endsWith('/readme')) return raw('README official text '.repeat(20), 'README.md');
    if (parsed.pathname.endsWith('/license')) return raw('MIT license text', 'LICENSE');
    if (parsed.pathname.endsWith('/contents/docs')) return json([
      { type: 'file', name: 'index.md', path: 'docs/index.md' },
      { type: 'file', name: 'getting-started.md', path: 'docs/getting-started.md' },
      { type: 'file', name: 'image.png', path: 'docs/image.png' },
    ]);
    if (parsed.pathname.endsWith('/contents/docs/index.md')) return raw('Installation and architecture details', 'index.md');
    if (parsed.pathname.endsWith('/contents/docs/getting-started.md')) {
      return raw('Getting started and verified usage details', 'getting-started.md');
    }
    if (parsed.pathname.endsWith('/releases/latest')) return json({ name: 'Version one', tag_name: 'v1.0.0',
      body: 'First stable release', published_at: '2026-10-25T00:00:00.000Z',
      html_url: 'https://github.com/owner/project/releases/tag/v1.0.0' });
    return new Response('', { status: 404 });
  };
  const receipt = await createGitHubRepositoryMaterialsAdapter({ fetchImpl })({
    request: { repository: 'owner/project' }, timeoutSeconds: 5,
  });
  const output = validateGitHubRepositoryMaterialsOutput(receipt.output);
  assert.equal(output.sourceVersion.revision, revision);
  assert.deepEqual(output.materials.map(item => item.type),
    ['readme', 'license', 'documentation', 'documentation', 'release']);
  assert.equal(output.materials.every(item => item.contentSha256.length === 64), true);
  assert.equal(receipt.usage.networkRequests, 8);
  assert.equal(requests.length, 8);
});

test('official materials become locatable EvidenceSpans without mixing their paths or revisions', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { buildGitHubRepositoryMaterialsEvidenceSpans } = await load('agent-research-evidence-repository.mjs');
  const revision = 'b'.repeat(40);
  const materials = [
    { type: 'readme', path: 'README.md', canonicalUri: `https://github.com/o/r/blob/${revision}/README.md`,
      sourceRevision: revision, publishedAt: null, text: '甲'.repeat(500), truncated: false },
    { type: 'release', path: 'releases/v2', canonicalUri: 'https://github.com/o/r/releases/tag/v2',
      sourceRevision: 'v2', publishedAt: '2026-10-25T00:00:00.000Z', text: '乙'.repeat(420), truncated: false },
  ].map(item => ({ ...item, contentSha256: stableHash(item.text) }));
  const output = {
    schemaVersion: 'github-repository-materials-v1',
    repository: { key: 'o/r', canonicalUrl: 'https://github.com/o/r', owner: 'o', name: 'r' },
    sourceVersion: { revision, canonicalUri: `https://github.com/o/r/tree/${revision}`,
      fetchedAt: '2026-10-26T00:00:00.000Z', contentSha256: '' },
    metadata: { name: 'r', fullName: 'o/r', description: '材料测试', homepage: null,
      defaultBranch: 'main', stars: 1, forks: 0, openIssues: 0, topics: [], licenseSpdx: 'MIT',
      archived: false, pushedAt: '2026-10-25T00:00:00.000Z' },
    materials,
  };
  output.sourceVersion.contentSha256 = stableHash({ metadata: output.metadata, materials });
  const spans = buildGitHubRepositoryMaterialsEvidenceSpans(output, { chunkChars: 240, maxChunksPerMaterial: 3 });
  assert.equal(spans[0].evidenceKind, 'metadata');
  assert.equal(spans.some(item => item.locator.kind === 'github.readme'
    && item.locator.path === 'README.md' && item.locator.revision === revision), true);
  assert.equal(spans.some(item => item.locator.kind === 'github.release'
    && item.locator.path === 'releases/v2' && item.locator.revision === 'v2'), true);
  assert.equal(spans.every(item => item.quoteText.length > 0), true);
});
