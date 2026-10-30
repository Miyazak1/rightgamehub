// Explicit local evaluation: preflight is offline; --live makes at most two
// real provider calls per eligible paper. No database or publication connection.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { extractPaperPdf } from '../apps/api/src/agent-arxiv-paper-tool.mjs';
import { selectTextOnlyDraftEvidence, textOnlyDraftExcerpt } from '../apps/api/src/agent-paper-text-draft.mjs';
import { stableHash } from '../apps/api/src/researcher-qa-protocol/stable-json.mjs';
import { createAgentPaperSemanticHandlers } from '../apps/api/src/agent-paper-semantic-runtime.mjs';
import { createAgentPaperArticleGenerationHandlers } from '../apps/api/src/agent-paper-article-generation.mjs';
import { createAgentDeepSeekProviderAdapter } from '../apps/api/src/agent-deepseek-provider-adapter.mjs';

const { values } = parseArgs({ options: { manifest: { type: 'string' }, output: { type: 'string' },
  live: { type: 'boolean', default: false } } });
if (!values.manifest || !values.output) throw Error('Usage: --manifest JSON --output NEW_DIRECTORY [--live]');
const cases = JSON.parse(await fs.readFile(values.manifest, 'utf8'));
if (!Array.isArray(cases) || cases.length < 1 || cases.length > 12) throw Error('CASE_LIMIT');
if (values.live && (!process.env.DEEPSEEK_API_KEY || !process.env.DEEPSEEK_MODEL)) {
  throw Error('DEEPSEEK_API_KEY_AND_DEEPSEEK_MODEL_REQUIRED');
}
await fs.mkdir(values.output); // Exclusive run directory: preserve earlier results.
const report = { schemaVersion: 'paper-text-draft-batch-eval-v1', liveRequested: values.live,
  databaseAccessed: false, publicationAttempted: false, manualReviewRequired: true,
  modelId: values.live ? process.env.DEEPSEEK_MODEL : null, cases: [] };
const write = (name, value) => fs.writeFile(path.join(values.output, name), JSON.stringify(value, null, 2) + '\n');
const safeCode = error => /^[A-Z][A-Z0-9_]{2,100}$/u.test(error?.code ?? error?.message ?? '')
  ? (error.code ?? error.message) : 'LOCAL_EVALUATION_FAILED';
let liveCases = 0;
for (const [caseIndex, entry] of cases.entries()) {
  const result = { file: entry.file, sourceUrl: entry.url, providerInvoked: false, providerCalls: [] };
  report.cases.push(result);
  try {
    const handle = await fs.open(entry.file, 'r');
    let bytes;
    try {
      if ((await handle.stat()).size > 20 * 1024 * 1024) throw Error('PDF_SIZE_LIMIT');
      bytes = new Uint8Array(await handle.readFile());
      if (bytes.length > 20 * 1024 * 1024) throw Error('PDF_SIZE_LIMIT');
    } finally { await handle.close(); }
    result.sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (entry.sha256 && entry.sha256 !== result.sourceSha256) throw Error('PDF_HASH_MISMATCH');
    const paperVersionId = crypto.randomUUID();
    const parsed = await extractPaperPdf(bytes, paperVersionId), q = parsed.qualityAssessment;
    result.originalQuality = q;
    const layoutSha256 = stableHash({ artifactVersionId: paperVersionId, pageCount: parsed.pageCount,
      parserVersion: q.parserVersion, pages: parsed.pages });
    const ordered = [...parsed.evidence].sort((a, b) => a.locator.pages[0] - b.locator.pages[0]
      || Number(a.locator.blockIds[0].match(/-b(\d+)$/u)?.[1] ?? 0)
        - Number(b.locator.blockIds[0].match(/-b(\d+)$/u)?.[1] ?? 0));
    const selected = selectTextOnlyDraftEvidence(ordered.map((e, i) => ({
      index: i + 1, id: crypto.randomUUID(), quoteText: e.quoteText, quoteHash: e.quoteHash,
      evidenceKind: 'direct-quote', locator: e.locator, allowedUses: q.permittedUses,
    })), { reliability_grade: q.grade, permitted_uses: q.permittedUses, reason_codes: q.reasonCodes,
      metrics_json: q.metrics, assessment_sha256: stableHash(q), layout_sha256: layoutSha256 });
    result.status = 'eligible';
    result.evidence = selected.evidence.map(e => ({ ...e, providerExcerpt: textOnlyDraftExcerpt(e.quoteText) }));
    result.readingScope = selected.readingScope;
    if (values.live && liveCases < 5) {
      if (!entry.title || !Array.isArray(entry.authors) || !entry.authors.length) throw Error('PAPER_METADATA_REQUIRED');
      liveCases++;
      const source = { schemaVersion: 'paper-semantic-source-v1', paperVersionId,
        identity: { canonicalId: entry.arxivId, title: entry.title, authors: entry.authors,
          year: entry.year, venue: 'arXiv' }, sourceUrl: entry.url,
        externalProcessingClass: 'public-arxiv-open-fulltext', accessLevel: 'fulltext-open',
        contentSha256: result.sourceSha256, layoutSha256, parseAssessmentSha256: stableHash(q),
        evidence: selected.evidence, readingScope: selected.readingScope,
        evidenceManifestSha256: stableHash(selected.evidence.map(({ index, id, quoteHash }) => ({ index, id, quoteHash }))) };
      const stored = new Map();
      let pack;
      const artifacts = { save: async input => {
        const row = { id: crypto.randomUUID(), artifactKey: input.artifactKey,
          content: structuredClone(input.content), contentSha256: stableHash(input.content) };
        stored.set(row.id, row); return row;
      }, read: async ({ artifactId, expectedArtifactKey }) => {
        const row = stored.get(artifactId);
        if (!row || row.artifactKey !== expectedArtifactKey) throw Error('LOCAL_ARTIFACT_INVALID');
        return structuredClone(row);
      }, readToolArtifact: async () => ({ content: structuredClone(pack) }) };
      const adapter = createAgentDeepSeekProviderAdapter();
      const providerGateway = { invoke: async request => {
        result.providerInvoked = true;
        const call = { stage: request.action.actionKey, requestSha256: stableHash(request.request) };
        result.providerCalls.push(call);
        await write('report.json', report);
        await write(`case-${caseIndex}-${call.stage}-request.json`, request.request);
        try {
          const receipt = await adapter({ apiKey: process.env.DEEPSEEK_API_KEY,
            modelId: process.env.DEEPSEEK_MODEL, request: request.request,
            tokenCeiling: request.tokenCeiling, timeoutSeconds: 55, idempotencyKey: request.idempotencyKey });
          Object.assign(call, { providerRequestId: receipt.providerRequestId, responseRef: receipt.responseRef,
            usage: receipt.usage, responseSha256: stableHash(receipt.output) });
          await write(`case-${caseIndex}-${call.stage}-response.json`, receipt);
          return { ...receipt, status: 'succeeded', actionId: crypto.randomUUID(),
            provider: 'deepseek', modelId: process.env.DEEPSEEK_MODEL };
        } catch (error) { call.errorCode = safeCode(error); throw error; }
      } };
      const input = { schemaVersion: 'paper-semantic-run-input-v1', paperVersionId, purpose: 'private-research' };
      const run = { id: crypto.randomUUID(), agentUserId: crypto.randomUUID(), input,
        inputSha256: stableHash(input), configSnapshot: { model: { provider: 'deepseek', modelId: process.env.DEEPSEEK_MODEL } } };
      const execution = { workerId: 'local-live-eval', leaseToken: crypto.randomUUID() };
      const semantic = createAgentPaperSemanticHandlers({ repository: { loadTrustedPaper: async () => structuredClone(source) },
        artifactRepository: artifacts, providerGateway, semanticGateway: {} });
      let previous;
      for (const [stage, parent] of [['verify-eligibility', null], ['reconstruct-sections', 'verify-eligibility'],
        ['extract-semantics', 'reconstruct-sections'], ['verify-semantics', 'extract-semantics']]) {
        previous = await semantic[`paper.single.semantic-shadow:${stage}`]({ run, stage: { id: crypto.randomUUID() },
          prerequisites: parent ? [{ stageKey: parent, status: 'succeeded', outputRef: previous.outputRef }] : [] }, execution);
      }
      const proof = stored.get(previous.outputRef.artifactId).content;
      pack = { schemaVersion: 'paper-article-evidence-v2', analysisId: crypto.randomUUID(),
        analysisSha256: proof.analysisSha256, paperVersionId,
        paper: { title: entry.title, authors: entry.authors, year: entry.year, venue: 'arXiv', sourceUrl: entry.url },
        findings: proof.findings.filter(f => f.kind !== 'unknown'), limitations: proof.limitations,
        followUpQuestions: proof.followUpQuestions, evidence: selected.evidence,
        readingScope: selected.readingScope, accessedAt: new Date().toISOString() };
      const article = createAgentPaperArticleGenerationHandlers({ providerGateway, artifactRepository: artifacts });
      const composed = await article['paper.article.draft-shadow:compose']({ run, stage: { id: crypto.randomUUID() },
        prerequisites: [{ stageKey: 'collect-evidence', status: 'succeeded', outputRef: { artifactIds: [crypto.randomUUID()] } }] }, execution);
      await article['paper.article.draft-shadow:verify']({ run, stage: { id: crypto.randomUUID() },
        prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: composed.outputRef }] }, execution);
      await write(`case-${caseIndex}-artifacts.json`, [...stored.values()]);
      result.status = 'generated-awaiting-human-review';
    }
  } catch (error) { result.status = result.providerInvoked ? 'generation-failed' : 'blocked-before-provider'; result.errorCode = safeCode(error); }
  await write('report.json', report);
  console.log(JSON.stringify({ caseIndex, status: result.status, errorCode: result.errorCode,
    selectedChunks: result.evidence?.length ?? 0, providerInvoked: result.providerInvoked }));
}
