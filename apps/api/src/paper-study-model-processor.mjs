import crypto from 'node:crypto';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { selectTextOnlyDraftEvidence } from './agent-paper-text-draft.mjs';
import { createAgentPaperSemanticHandlers } from './agent-paper-semantic-runtime.mjs';
import { createAgentPaperArticleGenerationHandlers } from './agent-paper-article-generation.mjs';
import { PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW } from './agent-paper-article-workflow.mjs';
import { createArxivPaperReadAdapter, normalizeArxivPaperLocator } from './agent-arxiv-paper-tool.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
export function createPaperStudyPublicSourceResolver({ readArxiv = createArxivPaperReadAdapter() } = {}) {
  return async (sourceSha256, arxivId) => {
    if (!arxivId) fail('PAPER_STUDY_PUBLIC_SOURCE_REQUIRED');
    const locator = normalizeArxivPaperLocator(arxivId);
    const {output} = await readArxiv({request:{paper:locator.abstractUrl}});
    if (output.version.contentSha256 !== sourceSha256) fail('PAPER_STUDY_PUBLIC_SOURCE_HASH_MISMATCH');
    return {sourceSha256,externalProcessingClass:'public-arxiv-open-fulltext',identity:output.identity,sourceUrl:output.version.sourceUrl};
  };
}
// Uses the same semantic, thematic generation and verification handlers as the
// existing research pipeline. Credentials/providers belong to the host, never UI.
// resolvePublicSource must verify this exact PDF hash against a legally obtained
// public arXiv source. A user-supplied title/URL is not proof of public access.
export function createPaperStudyModelProcessor({ providerGateway, resolvePublicSource, modelId, onArtifact = async () => {}, articleWorkflowVersion = PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowVersion }) {
  if (!providerGateway?.invoke || typeof resolvePublicSource !== 'function' || !modelId) fail('PAPER_STUDY_MODEL_CONFIGURATION');
  if (![8, PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowVersion].includes(articleWorkflowVersion)) fail('PAPER_STUDY_WORKFLOW_VERSION_INVALID');
  const sessions = new Map();
  return {
    async analyze({ sourceSha256, arxivId, parsed }) {
      const metadata = await resolvePublicSource(sourceSha256, arxivId);
      if (metadata?.sourceSha256 !== sourceSha256 || metadata.externalProcessingClass !== 'public-arxiv-open-fulltext') fail('PAPER_STUDY_EXTERNAL_PROCESSING_FORBIDDEN');
      const paperVersionId = crypto.randomUUID(), quality = parsed.qualityAssessment;
      const layoutSha256 = stableHash({ artifactVersionId: paperVersionId, pageCount: parsed.pageCount, parserVersion: quality.parserVersion, pages: parsed.pages });
      const ordered = [...parsed.evidence].sort((a,b) => a.locator.pages[0]-b.locator.pages[0] || Number(a.locator.blockIds[0].match(/-b(\d+)$/)?.[1]??0)-Number(b.locator.blockIds[0].match(/-b(\d+)$/)?.[1]??0));
      const selected = selectTextOnlyDraftEvidence(ordered.map((e,i)=>({index:i+1,id:crypto.randomUUID(),quoteText:e.quoteText,quoteHash:e.quoteHash,evidenceKind:'direct-quote',locator:e.locator,allowedUses:quality.permittedUses})),
        {reliability_grade:quality.grade,permitted_uses:quality.permittedUses,reason_codes:quality.reasonCodes,metrics_json:quality.metrics,assessment_sha256:stableHash(quality),layout_sha256:layoutSha256});
      const source = {schemaVersion:'paper-semantic-source-v1',paperVersionId,identity:metadata.identity,sourceUrl:metadata.sourceUrl,
        externalProcessingClass:metadata.externalProcessingClass,accessLevel:'fulltext-open',contentSha256:sourceSha256,layoutSha256,parseAssessmentSha256:stableHash(quality),evidence:selected.evidence,readingScope:selected.readingScope,
        evidenceManifestSha256:stableHash(selected.evidence.map(({index,id,quoteHash})=>({index,id,quoteHash})))};
      let calls = 0, pack;
      const gateway = { async invoke(request) {
        if (++calls > 1 + PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.defaultBudget.providerCalls) fail('PAPER_STUDY_MODEL_BUDGET_EXCEEDED');
        return providerGateway.invoke(request); // no retries after any model/gate failure
      } };
      const rows = new Map();
      const artifacts = {
        async save(input) {const row={...input,id:crypto.randomUUID(),contentSha256:stableHash(input.content)};await onArtifact(structuredClone(row));rows.set(row.id,structuredClone(row));return row;},
        async read({artifactId,expectedArtifactKey}) {const row=rows.get(artifactId);if(!row||row.artifactKey!==expectedArtifactKey||stableHash(row.content)!==row.contentSha256)fail('PAPER_STUDY_ARTIFACT_DRIFT');return structuredClone(row);},
        async readToolArtifact(){return {content:structuredClone(pack)};},
      };
      const input={schemaVersion:'paper-semantic-run-input-v1',paperVersionId,purpose:'private-research'};
      const run={id:crypto.randomUUID(),agentUserId:crypto.randomUUID(),input,inputSha256:stableHash(input),configSnapshot:{model:{provider:'deepseek',modelId}}};
      const execution={workerId:'paper-study-isolated',leaseToken:crypto.randomUUID()};
      const semantic=createAgentPaperSemanticHandlers({repository:{loadTrustedPaper:async()=>structuredClone(source)},artifactRepository:artifacts,providerGateway:gateway,semanticGateway:{}});
      let previous;
      for(const [stage,parent] of [['verify-eligibility',null],['reconstruct-sections','verify-eligibility'],['extract-semantics','reconstruct-sections'],['verify-semantics','extract-semantics']])
        previous=await semantic[`paper.single.semantic-shadow:${stage}`]({run,stage:{id:crypto.randomUUID()},prerequisites:parent?[{stageKey:parent,status:'succeeded',outputRef:previous.outputRef}]:[]},execution);
      const proof=rows.get(previous.outputRef.artifactId).content;
      pack={schemaVersion:'paper-article-evidence-v2',analysisId:crypto.randomUUID(),analysisSha256:proof.analysisSha256,paperVersionId,
        paper:{title:metadata.identity.title,authors:metadata.identity.authors,year:metadata.identity.year,venue:metadata.identity.venue,sourceUrl:metadata.sourceUrl},findings:proof.findings.filter(f=>f.kind!=='unknown'),limitations:proof.limitations,followUpQuestions:proof.followUpQuestions,evidence:selected.evidence,readingScope:selected.readingScope,accessedAt:new Date().toISOString()};
      run.workflowVersion=articleWorkflowVersion;
      sessions.set(pack.analysisId,{run,execution,artifacts,rows,pack,gateway,composed:false,failed:false});
      return {sourceSha256,pack:structuredClone(pack)};
    },
    async compose(pack) {
      const state=sessions.get(pack.analysisId);
      if(!state||state.failed||state.composed||stableHash(state.pack)!==stableHash(pack))fail('PAPER_STUDY_ANALYSIS_DRIFT');
      state.composed=true;
      try {
        const handlers=createAgentPaperArticleGenerationHandlers({providerGateway:state.gateway,artifactRepository:state.artifacts});
        const stage={id:crypto.randomUUID()};
        const result=await handlers['paper.article.draft-shadow:compose']({run:state.run,stage,prerequisites:[{stageKey:'collect-evidence',status:'succeeded',outputRef:{artifactIds:[crypto.randomUUID()]}}]},state.execution);
        state.outputRef=result.outputRef;state.handlers=handlers;
        return structuredClone(state.rows.get(result.outputRef.artifactId).content);
      }catch(e){state.failed=true;throw e;}
    },
    async verify(composition,pack) {
      const state=sessions.get(pack.analysisId);
      if(!state?.outputRef||state.failed||stableHash(state.pack)!==stableHash(pack)||stableHash(composition)!==stableHash(state.rows.get(state.outputRef.artifactId).content))fail('PAPER_STUDY_COMPOSITION_DRIFT');
      try {return await state.handlers['paper.article.draft-shadow:verify']({run:state.run,stage:{id:crypto.randomUUID()},prerequisites:[{stageKey:'compose',status:'succeeded',outputRef:state.outputRef}]},state.execution);}
      finally {sessions.delete(pack.analysisId);}
    },
  };
}
