import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createAgentPaperArticleGenerationHandlers, validatePaperArticleEvidencePack } from '../../apps/api/src/agent-paper-article-generation.mjs';
import { stableHash } from '../../apps/api/src/researcher-qa-protocol/stable-json.mjs';
import { createPaperStudyModelProcessor } from '../../apps/api/src/paper-study-model-processor.mjs';

const SOURCE = 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697';
export async function createPaperStudyPipelineReplayProcessor() {
  const recorded = JSON.parse(await fs.readFile(new URL('../platform/fixtures/paper-metadata-split-live-addition-success-v1.json', import.meta.url)));
  return createPaperStudyModelProcessor({modelId:'deepseek-flash',articleWorkflowVersion:recorded.workflowVersion,resolvePublicSource:async sourceSha256=>{
    if(sourceSha256!==SOURCE)throw Object.assign(Error(),{code:'PAPER_STUDY_REPLAY_SOURCE_MISMATCH'});
    return {sourceSha256,externalProcessingClass:'public-arxiv-open-fulltext',identity:{canonicalId:'arxiv:1706.03762',...recorded.evidencePack.paper},sourceUrl:recorded.evidencePack.paper.sourceUrl};
  },providerGateway:{async invoke(request){
    const entry=recorded.recordedReceipts.find(r=>r.stage===request.action.actionKey);
    if(!entry)throw Object.assign(Error(),{code:'PAPER_STUDY_REPLAY_RECEIPT_MISSING'});
    return {...structuredClone(entry.receipt),status:'succeeded',actionId:crypto.randomUUID(),provider:'deepseek',modelId:'deepseek-flash'};
  }}});
}
export async function createPaperStudyReplayProcessor() {
  const recorded = JSON.parse(await fs.readFile(new URL('../platform/fixtures/paper-metadata-split-live-addition-success-v1.json', import.meta.url)));
  const pack = validatePaperArticleEvidencePack(recorded.evidencePack);
  const composition = recorded.artifacts.find(a => a.artifactKey === 'blog.composition');
  if (!composition) throw Error('PAPER_STUDY_RECORDING_INCOMPLETE');
  return {
    async analyze({ sourceSha256 }) {
      if (sourceSha256 !== SOURCE) throw Object.assign(Error(), { code: 'PAPER_STUDY_REPLAY_SOURCE_MISMATCH' });
      return { sourceSha256, pack: structuredClone(pack) };
    },
    async compose(input) {
      if (stableHash(input) !== stableHash(pack)) throw Error('PAPER_STUDY_RECORDING_DRIFT');
      return structuredClone(composition.content);
    },
    async verify(content, evidencePack) {
      const rows = new Map(recorded.artifacts.map(a => [a.id, structuredClone(a)]));
      // Rerun the product's full draft verifier, including section plans and
      // per-paragraph claim/evidence bindings. Replay never calls a model.
      rows.get(composition.id).content = content;
      rows.get(composition.id).contentSha256 = stableHash(content);
      const artifacts = {
        async read({ artifactId, expectedArtifactKey }) {
          const row = rows.get(artifactId);
          if (!row || row.artifactKey !== expectedArtifactKey || stableHash(row.content) !== row.contentSha256) throw Error('PAPER_STUDY_ARTIFACT_DRIFT');
          return structuredClone(row);
        },
        async readToolArtifact() { return { content: structuredClone(evidencePack) }; },
        async save(row) { return { ...row, id: crypto.randomUUID(), contentSha256: stableHash(row.content) }; },
      };
      const handlers = createAgentPaperArticleGenerationHandlers({ artifactRepository: artifacts, providerGateway: { invoke() { throw Error('REPLAY_MUST_NOT_CALL_MODEL'); } } });
      return handlers['paper.article.draft-shadow:verify']({ run: { id: composition.runId, workflowVersion: recorded.workflowVersion },
        stage: { id: crypto.randomUUID() }, prerequisites: [{ stageKey: 'compose', status: 'succeeded', outputRef: { artifactId: composition.id, artifactKey: 'blog.composition', contentSha256: stableHash(content) } }] }, {});
    },
  };
}
