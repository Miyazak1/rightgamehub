const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const load = name => import(pathToFileURL(path.join(root, 'apps/api/src', name)).href);
const id = () => crypto.randomUUID();
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const stableSha = value => sha(JSON.stringify(value));

function followUpContext() {
  const quote1 = '实验在三个公开数据集上比较了新方法与基线，报告了准确率提升，同时说明不同数据集上的提升幅度并不一致。';
  const quote2 = '作者指出样本覆盖范围有限，尚不能据此推断方法在所有真实场景中都会保持相同效果。';
  const evidence = [quote1, quote2].map((quoteText, offset) => ({
    index: offset + 1, id: id(), quoteText, quoteHash: stableSha(quoteText), evidenceKind: 'paper-text',
    locator: { kind: 'paper.layout', pages: [offset + 3], sectionPath: ['实验'], blockIds: [`p${offset + 3}-b1`], objectLabel: null },
    allowedUses: ['analysis', 'citation', 'comparison'],
  }));
  return { schemaVersion: 'paper-follow-up-context-v1', analysisId: id(), analysisSha256: sha('analysis'),
    paperVersionId: id(), paper: { title: 'A Carefully Evaluated Method', authors: ['甲作者', '乙作者'],
      sourceUrl: 'https://arxiv.org/pdf/2601.12345v1.pdf' }, question: 'unused',
    findings: [{ key: 'main-result', text: '新方法在受测数据集上优于基线，但提升幅度依数据集而异。',
      relations: [{ evidenceId: evidence[0].id, evidenceIndex: 1, relation: 'supports' }] },
    { key: 'scope-limit', text: '论文证据不能外推到所有真实场景。',
      relations: [{ evidenceId: evidence[1].id, evidenceIndex: 2, relation: 'supports' }] }],
    limitations: [{ text: '样本和数据集覆盖有限。' }], evidence,
    followUpQuestions: ['实验基线是否足够强？', '结果能否在更多数据上复现？', '真实场景还缺少哪些验证？'] };
}

test('paper analysis becomes a bounded article evidence pack with page evidence', async () => {
  const { createPaperArticleEvidencePack } = await load('agent-paper-article-generation.mjs');
  const pack = createPaperArticleEvidencePack(followUpContext(), { accessedAt: '2026-10-29T02:00:00.000Z' });
  assert.equal(pack.schemaVersion, 'paper-article-evidence-v1');
  assert.deepEqual(pack.evidence.map(item => item.locator.pages), [[3], [4]]);
  assert.equal(pack.findings[0].relations[0].evidenceId, pack.evidence[0].id);
  assert.equal(pack.paper.sourceUrl, 'https://arxiv.org/pdf/2601.12345v1.pdf');
});

test('paper article composition reuses blog package and deterministic verification contracts', async () => {
  const { createPaperArticleEvidencePack, createAgentPaperArticleGenerationHandlers } =
    await load('agent-paper-article-generation.mjs');
  const runId = id(), toolArtifactId = id();
  const pack = createPaperArticleEvidencePack(followUpContext(), { accessedAt: '2026-10-29T02:00:00.000Z' });
  const stored = new Map();
  const artifactRepository = {
    readToolArtifact: async ({ artifactId }) => {
      assert.equal(artifactId, toolArtifactId); return { id: artifactId, content: pack };
    },
    save: async input => {
      const artifactId = id();
      const item = { id: artifactId, artifactKey: input.artifactKey, content: structuredClone(input.content),
        contentSha256: sha(JSON.stringify(input.content)) };
      stored.set(artifactId, item); return item;
    },
    read: async ({ artifactId }) => structuredClone(stored.get(artifactId)),
  };
  const paragraph = '这项研究真正回答的是一个有边界的问题。作者在明确的数据集和对照条件下观察到方法表现更好，但不同数据集的提升并不相同。因此，读者可以把它理解为受控实验中的积极证据，而不能直接理解为所有真实场景中的普遍结论。'.repeat(4);
  let providerRequest;
  const providerGateway = { invoke: async request => {
    providerRequest = request;
    return { actionId: id(), output: { title: '一项新方法究竟证明了什么',
      summary: '依据论文逐页证据解释研究问题、实验结果和适用边界，帮助普通读者区分论文真正证明的内容与仍需验证的推论。',
      blocks: [{ type: 'heading', level: 2, text: '研究想解决什么问题' },
        { type: 'paragraph', text: paragraph, citationIndexes: [1] },
        { type: 'heading', level: 2, text: '实验结果意味着什么' },
        { type: 'paragraph', text: paragraph, citationIndexes: [1] },
        { type: 'heading', level: 2, text: '哪些结论还不能下' },
        { type: 'list', ordered: false, items: [paragraph], citationIndexes: [1] }],
      followUpQuestions: ['实验基线是否足够强？', '结果能否在更多数据上复现？', '真实场景还缺少哪些验证？'] } };
  } };
  const handlers = createAgentPaperArticleGenerationHandlers({ providerGateway, artifactRepository });
  const execution = { workerId: 'paper-worker', leaseToken: id() };
  const baseRun = { id: runId, agentUserId: id(), input: {}, configSnapshot: {} };
  const composed = await handlers['paper.article.draft-shadow:compose']({ run: baseRun,
    stage: { id: id() }, prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded',
      outputRef: { artifactIds: [toolArtifactId] } }] }, execution);
  const packageContent = stored.get(composed.outputRef.artifactId).content;
  assert.equal(packageContent.schemaVersion, 'blog-article-composition-v1');
  assert.equal(packageContent.content.citations.length, 1);
  assert.equal(packageContent.content.citations[0].locator, '第 3、4 页');
  assert.deepEqual(packageContent.sourceToolArtifactIds, [toolArtifactId]);
  assert.equal(providerRequest.promptTemplate.key, 'paper.article.compose');
  assert.equal(providerRequest.action.capabilityKey, 'provider.text.generate');
  const verified = await handlers['paper.article.draft-shadow:verify']({ run: baseRun,
    stage: { id: id() }, prerequisites: [{ stageKey: 'compose', status: 'succeeded',
      outputRef: composed.outputRef }] }, execution);
  const proof = stored.get(verified.outputRef.artifactId).content;
  assert.equal(proof.schemaVersion, 'blog-article-verification-v1');
  assert.equal(proof.approved, true);
  assert.equal(proof.checks.pageEvidencePresent, true);
});

test('paper article bridge rejects missing page evidence and uncited factual blocks', async () => {
  const { createPaperArticleEvidencePack, validatePaperArticleEvidencePack } =
    await load('agent-paper-article-generation.mjs');
  const pack = createPaperArticleEvidencePack(followUpContext());
  pack.evidence[0].locator.pages = [];
  assert.throws(() => validatePaperArticleEvidencePack(pack),
    error => error.code === 'AGENT_PAPER_ARTICLE_EVIDENCE_INVALID');
});
