const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);

const fixture = ({ readme = '# Project\n\nA useful project.\n\n## Install\n\nRun the installer.' } = {}) => ({
  schemaVersion: 'github-repository-evidence-v1',
  repository: { key: 'owner/project', canonicalUrl: 'https://github.com/Owner/Project',
    owner: 'Owner', name: 'Project' },
  sourceVersion: { revision: 'a'.repeat(40),
    canonicalUri: `https://github.com/Owner/Project/tree/${'a'.repeat(40)}`,
    fetchedAt: '2026-10-27T10:00:00.000Z', contentSha256: '' },
  metadata: { name: 'Project', fullName: 'Owner/Project', description: 'Useful project',
    homepage: null, defaultBranch: 'main', stars: 10, forks: 2, openIssues: 1,
    topics: ['tool'], licenseSpdx: 'MIT', archived: false,
    pushedAt: '2026-10-27T09:00:00.000Z' },
  readme: { canonicalUri: `https://api.github.com/repos/Owner/Project/readme?ref=${'a'.repeat(40)}`,
    path: 'README.md', text: readme, truncated: false },
});

test('GitHub repository evidence is normalized into metadata and locatable README spans', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { buildGitHubRepositoryEvidenceSpans } = await load('agent-research-evidence-repository.mjs');
  const value = fixture();
  value.sourceVersion.contentSha256 = stableHash({ metadata: value.metadata, readme: value.readme });
  const spans = buildGitHubRepositoryEvidenceSpans(value, { chunkChars: 200, maxChunks: 4 });
  assert.equal(spans[0].role, 'metadata');
  assert.equal(spans[0].evidenceKind, 'metadata');
  assert.match(spans[0].quoteText, /Owner\/Project/u);
  assert.equal(spans[1].role, 'primary-text');
  assert.equal(spans[1].evidenceKind, 'direct-quote');
  assert.equal(spans[1].locator.kind, 'github.readme');
  assert.equal(spans[1].locator.revision, 'a'.repeat(40));
  assert.equal(spans[1].locator.path, 'README.md');
  assert.equal(spans[1].quoteText, value.readme.text);
});

test('evidence span construction is bounded and rejects unversioned repository output', async () => {
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const { buildGitHubRepositoryEvidenceSpans } = await load('agent-research-evidence-repository.mjs');
  const value = fixture({ readme: Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${'x'.repeat(180)}`).join('\n\n') });
  value.sourceVersion.contentSha256 = stableHash({ metadata: value.metadata, readme: value.readme });
  const spans = buildGitHubRepositoryEvidenceSpans(value, { chunkChars: 300, maxChunks: 3 });
  assert.equal(spans.length, 4);
  assert(spans.slice(1).every(item => item.quoteText.length <= 300));
  const invalid = structuredClone(value);
  invalid.sourceVersion.revision = 'not-a-commit';
  assert.throws(() => buildGitHubRepositoryEvidenceSpans(invalid),
    error => error.code === 'AGENT_GITHUB_TOOL_OUTPUT_INVALID');
});
