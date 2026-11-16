const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../apps/api/src', file)));

async function fixture(pushedAt, materialsMode = true) {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const revision = 'a'.repeat(40), text = '# Example\n\nOfficial repository documentation.';
  const value = { schemaVersion: materialsMode ? 'github-repository-materials-v1' : 'github-repository-evidence-v1',
    repository: { key: 'owner/project', canonicalUrl: 'https://github.com/owner/project', owner: 'owner', name: 'project' },
    sourceVersion: { revision, canonicalUri: `https://github.com/owner/project/tree/${revision}`,
      fetchedAt: '2026-10-30T02:00:00.000Z', contentSha256: '' },
    metadata: { name: 'project', fullName: 'owner/project', description: 'Example', stars: 10, forks: 1,
      licenseSpdx: 'MIT', pushedAt },
    ...(materialsMode ? { materials: [{ type: 'readme', path: 'README.md',
      canonicalUri: `https://github.com/owner/project/blob/${revision}/README.md`, sourceRevision: revision,
      publishedAt: null, text, truncated: false, contentSha256: stableHash(text) }] }
      : { readme: { canonicalUri: `https://api.github.com/repos/owner/project/readme?ref=${revision}`,
        path: 'README.md', text, truncated: false } }),
  };
  value.sourceVersion.contentSha256 = stableHash({ metadata: value.metadata,
    ...(materialsMode ? { materials: value.materials } : { readme: value.readme }) });
  return value;
}

test('second-precision GitHub dates archive in canonical form without changing source evidence or hashes', async () => {
  const { buildGitHubRepositorySourceArchive } = await load('agent-research-evidence-repository.mjs');
  for (const materialsMode of [true, false]) {
    const output = await fixture('2026-10-29T09:00:00Z', materialsMode), original = structuredClone(output);
    const archive = buildGitHubRepositorySourceArchive(output);
    assert.equal(archive.version.publishedAt, '2026-10-29T09:00:00.000Z');
    assert.equal(archive.version.contentHash, original.sourceVersion.contentSha256);
    assert.ok(archive.evidence[0].quoteText.includes('2026-10-29T09:00:00Z'));
    assert.deepEqual(output, original);
  }
});

test('canonical and missing dates retain their existing archive representation', async () => {
  const { buildGitHubRepositorySourceArchive } = await load('agent-research-evidence-repository.mjs');
  for (const pushedAt of ['2026-10-29T09:00:00.123Z', '2026-10-29T09:00:00.000Z', null]) {
    assert.equal(buildGitHubRepositorySourceArchive(await fixture(pushedAt)).version.publishedAt, pushedAt);
  }
});

test('date adaptation does not repair invalid dates, corrupt hashes or relax the shared archive contract', async () => {
  const { buildGitHubRepositorySourceArchive } = await load('agent-research-evidence-repository.mjs');
  const { validateSourceArchiveV1 } = await load('agent-source-adapter-contracts.mjs');
  for (const pushedAt of ['invalid-date', '', '2026-02-30T09:00:00Z', '2026-10-29', '2026-10-29T25:00:00Z']) {
    const value = await fixture(pushedAt);
    assert.throws(() => buildGitHubRepositorySourceArchive(value), { code: 'AGENT_SOURCE_ARCHIVE_INVALID' });
  }
  const corrupted = await fixture('2026-10-29T09:00:00Z');
  corrupted.sourceVersion.contentSha256 = '0'.repeat(64);
  assert.throws(() => buildGitHubRepositorySourceArchive(corrupted), { code: 'AGENT_GITHUB_MATERIALS_OUTPUT_INVALID' });
  const archive = buildGitHubRepositorySourceArchive(await fixture('2026-10-29T09:00:00.000Z'));
  archive.version.publishedAt = '2026-10-29T09:00:00Z';
  assert.throws(() => validateSourceArchiveV1(archive), { code: 'AGENT_SOURCE_ARCHIVE_INVALID' });
});

test('REST materials adapter output flows into the archive with second-precision repository and release timestamps', async () => {
  const { createGitHubRepositoryMaterialsAdapter } = await load('agent-github-repository-materials-tool.mjs');
  const { buildGitHubRepositorySourceArchive } = await load('agent-research-evidence-repository.mjs');
  const json = data => Response.json(data), revision = 'b'.repeat(40);
  const receipt = await createGitHubRepositoryMaterialsAdapter({ fetchImpl: async url => {
    const pathname = new URL(url).pathname;
    if (pathname === '/repos/owner/project') return json({ name: 'project', full_name: 'owner/project',
      default_branch: 'main', stargazers_count: 10, license: { spdx_id: 'MIT' }, pushed_at: '2026-10-29T09:00:00Z' });
    if (pathname.endsWith('/git/ref/heads/main')) return json({ object: { type: 'commit', sha: revision } });
    if (pathname.endsWith('/readme')) return new Response('# Example\n\nOfficial README material.',
      { headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="README.md"' } });
    if (pathname.endsWith('/releases/latest')) return json({ name: 'Release', tag_name: 'v1', body: 'Release details',
      published_at: '2026-10-28T09:00:00Z', html_url: 'https://github.com/owner/project/releases/tag/v1' });
    return new Response('', { status: 404 });
  } })({ request: { repository: 'owner/project' }, timeoutSeconds: 5 });
  const archive = buildGitHubRepositorySourceArchive(receipt.output);
  assert.equal(archive.version.publishedAt, '2026-10-29T09:00:00.000Z');
  assert.equal(receipt.output.metadata.pushedAt, '2026-10-29T09:00:00Z');
  assert.ok(archive.evidence.some(span => span.locator.publishedAt === '2026-10-28T09:00:00Z'));
  assert.equal(archive.version.contentHash, receipt.output.sourceVersion.contentSha256);
});
