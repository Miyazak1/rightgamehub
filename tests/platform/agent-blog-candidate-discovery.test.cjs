const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const uuid = () => crypto.randomUUID();

const input = {
  schemaVersion: 'blog-project-discovery-input-v1',
  topicScope: '发现有趣、有用且证据完整的开源工具',
  queries: ['agent tool', 'open source utility'], sort: 'stars', minStars: 10,
  pushedAfter: '2026-01-01', maxCandidates: 3,
  previousRepositoryUrls: ['https://github.com/old/repeated'],
};

function searchOutput(query, candidates) {
  return { schemaVersion: 'github-repository-search-v1',
    query: { text: query, sort: 'stars', minStars: 10, pushedAfter: '2026-01-01' },
    source: { canonicalUri: `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`,
      fetchedAt: '2026-10-26T02:00:00.000Z', contentSha256: 'a'.repeat(64) }, candidates };
}

function candidate(key, stars) {
  const [owner, name] = key.split('/');
  return { key, canonicalUrl: `https://github.com/${owner}/${name}`, owner, name,
    description: 'A useful project', stars, forks: 2, language: 'TypeScript', topics: ['agent'],
    licenseSpdx: 'MIT', pushedAt: '2026-10-25T00:00:00.000Z' };
}

test('candidate discovery freezes plain queries and produces a bounded non-evidence candidate set', async () => {
  const { createAgentBlogCandidateDiscoveryHandlers } = await load('agent-blog-candidate-discovery.mjs');
  const { stableHash } = await load('researcher-qa-protocol/stable-json.mjs');
  const runId = uuid();
  const calls = [];
  const toolOutputs = new Map();
  const toolGateway = { invoke: async call => {
    calls.push(call);
    const id = uuid();
    const query = call.request.query;
    toolOutputs.set(id, { id, content: searchOutput(query, query === 'agent tool'
      ? [candidate('old/repeated', 1000), candidate('new/useful', 200)]
      : [candidate('new/useful', 200), candidate('another/project', 80)]) });
    return { status: 'succeeded', artifactId: id };
  } };
  let saved = null;
  const artifactRepository = {
    readToolArtifact: async ({ artifactId }) => structuredClone(toolOutputs.get(artifactId)),
    save: async value => {
      saved = structuredClone(value);
      return { id: uuid(), artifactKey: value.artifactKey, contentSha256: 'b'.repeat(64) };
    },
  };
  const handlers = createAgentBlogCandidateDiscoveryHandlers({ toolGateway, artifactRepository });
  const execution = { workerId: 'worker', leaseToken: uuid() };
  const run = { id: runId, agentUserId: uuid(), input: structuredClone(input), inputSha256: stableHash(input) };
  const frozen = await handlers['blog.project.discovery-shadow:freeze-brief']({ run, stage: { id: uuid() }, prerequisites: [] });
  const searched = await handlers['blog.project.discovery-shadow:search-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'freeze-brief', status: 'succeeded', outputRef: frozen.outputRef }] }, execution);
  const finalized = await handlers['blog.project.discovery-shadow:finalize-candidates']({ run, stage: { id: uuid() },
    prerequisites: [{ stageKey: 'search-candidates', status: 'succeeded', outputRef: searched.outputRef }] }, execution);
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.tool.toolKey === 'research.github.repository.search'
    && call.action.capabilityKey === 'research.github.discover'));
  assert.equal(finalized.runOutput.type, 'blog.candidate-set');
  assert.equal(saved.artifactKey, 'blog.candidate-set');
  assert.deepEqual(saved.sourceToolArtifactIds, searched.outputRef.artifactIds);
  assert.deepEqual(saved.content.candidates.map(item => item.key),
    ['new/useful', 'another/project', 'old/repeated']);
  assert.equal(saved.content.candidates[0].matchedQueries.length, 2);
  assert.equal(saved.content.candidates[2].previouslyPublished, true);
  assert.equal(saved.content.candidates.some(item => Object.hasOwn(item, 'readme')), false);
});

test('candidate discovery is disabled by default and has no provider, draft, or publish authority', async () => {
  const { createAgentBlogCandidateDiscoveryCanary, normalizeBlogCandidateDiscoveryInput } =
    await load('agent-blog-candidate-discovery.mjs');
  const { BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW } = await load('agent-blog-foundation-workflows.mjs');
  const canary = createAgentBlogCandidateDiscoveryCanary({ runtimeRepository: {} });
  await assert.rejects(canary.register(uuid()), error => error.code === 'AGENT_BLOG_DISCOVERY_CANARY_DISABLED');
  assert.deepEqual(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.requiredCapabilities,
    [{ key: 'research.github.discover', version: 1 }]);
  assert.equal(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.defaultBudget.providerCalls, 0);
  assert.equal(BLOG_PROJECT_DISCOVERY_SHADOW_WORKFLOW.stages.some(stage => stage.kind === 'provider'
    || stage.kind === 'domain-write' || stage.key.includes('publish')), false);
  assert.throws(() => normalizeBlogCandidateDiscoveryInput({ ...input, queries: ['stars:>100'] }),
    error => error.code === 'AGENT_BLOG_DISCOVERY_INPUT_INVALID');
  assert.throws(() => normalizeBlogCandidateDiscoveryInput({ ...input,
    queries: ['agent tool', 'agent   tool'] }), error => error.code === 'AGENT_BLOG_DISCOVERY_INPUT_INVALID');
});
