import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { validateGitHubRepositoryReadOutput } from './agent-github-repository-tool.mjs';
import { validateGitHubRepositoryMaterialsOutput } from './agent-github-repository-materials-tool.mjs';
import { validateArxivPaperReadOutput } from './agent-arxiv-paper-tool.mjs';
import { validatePaperAnalysisReadOutput } from './agent-paper-analysis-tool.mjs';
import { validateSourceArchiveV1 } from './agent-source-adapter-contracts.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';

export class AgentResearchEvidenceRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AgentResearchEvidenceRepositoryError';
    this.code = code;
    this.retryable = false;
  }
}

const fail = code => { throw new AgentResearchEvidenceRepositoryError(code); };
const json = value => JSON.stringify(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
  return value;
}

function compact(value, max) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

export function buildGitHubRepositoryEvidenceSpans(value, { chunkChars = 1600, maxChunks = 8 } = {}) {
  const output = validateGitHubRepositoryReadOutput(value);
  if (!Number.isSafeInteger(chunkChars) || chunkChars < 200 || chunkChars > 1900
    || !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > 16) {
    fail('AGENT_RESEARCH_EVIDENCE_CONFIG_INVALID');
  }
  const metadata = output.metadata;
  const metadataText = compact([
    `仓库：${metadata.fullName}`,
    metadata.description ? `简介：${metadata.description}` : '',
    `Stars：${metadata.stars}`,
    `Forks：${metadata.forks}`,
    metadata.licenseSpdx ? `许可证：${metadata.licenseSpdx}` : '',
    metadata.pushedAt ? `最近推送：${metadata.pushedAt}` : '',
  ].filter(Boolean).join('\n'), 2000);
  const spans = [{
    role: 'metadata', evidenceKind: 'metadata', quoteText: metadataText,
    locator: {
      kind: 'github.repository.metadata', repository: output.repository.canonicalUrl,
      revision: output.sourceVersion.revision, canonicalUri: output.sourceVersion.canonicalUri,
    },
  }];
  const readme = output.readme;
  if (!readme?.text) return spans;
  const text = readme.text.replace(/\r\n?/gu, '\n').trim();
  let offset = 0;
  for (let index = 0; offset < text.length && index < maxChunks; index += 1) {
    let end = Math.min(text.length, offset + chunkChars);
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n\n', end);
      const line = text.lastIndexOf('\n', end);
      const boundary = Math.max(paragraph, line);
      if (boundary > offset + Math.floor(chunkChars * 0.55)) end = boundary;
    }
    const quoteText = text.slice(offset, end).trim();
    if (quoteText) spans.push({
      role: index === 0 ? 'primary-text' : 'supporting-text',
      evidenceKind: 'direct-quote', quoteText,
      locator: {
        kind: 'github.readme', repository: output.repository.canonicalUrl,
        revision: output.sourceVersion.revision, path: readme.path,
        canonicalUri: readme.canonicalUri, startChar: offset, endChar: end,
        truncated: readme.truncated === true,
      },
    });
    offset = end;
    while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
  }
  return spans;
}

export function buildGitHubRepositoryMaterialsEvidenceSpans(value, { chunkChars = 1600,
  maxChunksPerMaterial = 4 } = {}) {
  const output = validateGitHubRepositoryMaterialsOutput(value);
  if (!Number.isSafeInteger(chunkChars) || chunkChars < 200 || chunkChars > 1900
    || !Number.isSafeInteger(maxChunksPerMaterial) || maxChunksPerMaterial < 1 || maxChunksPerMaterial > 8) {
    fail('AGENT_RESEARCH_EVIDENCE_CONFIG_INVALID');
  }
  const metadata = output.metadata;
  const spans = [{
    role: 'metadata', evidenceKind: 'metadata',
    quoteText: compact([
      `仓库：${metadata.fullName}`, metadata.description ? `简介：${metadata.description}` : '',
      `Stars：${metadata.stars}`, `Forks：${metadata.forks}`,
      metadata.licenseSpdx ? `许可证：${metadata.licenseSpdx}` : '',
      metadata.pushedAt ? `最近推送：${metadata.pushedAt}` : '',
    ].filter(Boolean).join('\n'), 2000),
    locator: { kind: 'github.repository.metadata', repository: output.repository.canonicalUrl,
      revision: output.sourceVersion.revision, canonicalUri: output.sourceVersion.canonicalUri },
  }];
  for (const material of output.materials) {
    const text = material.text.replace(/\r\n?/gu, '\n').trim();
    let offset = 0;
    for (let index = 0; offset < text.length && index < maxChunksPerMaterial; index += 1) {
      let end = Math.min(text.length, offset + chunkChars);
      if (end < text.length) {
        const boundary = Math.max(text.lastIndexOf('\n\n', end), text.lastIndexOf('\n', end));
        if (boundary > offset + Math.floor(chunkChars * 0.55)) end = boundary;
      }
      const quoteText = text.slice(offset, end).trim();
      if (quoteText) spans.push({
        role: material.type === 'readme' && index === 0 ? 'primary-text' : 'supporting-text',
        evidenceKind: 'direct-quote', quoteText,
        locator: { kind: `github.${material.type}`, repository: output.repository.canonicalUrl,
          revision: material.sourceRevision, path: material.path, canonicalUri: material.canonicalUri,
          publishedAt: material.publishedAt, startChar: offset, endChar: end,
          truncated: material.truncated === true },
      });
      offset = end;
      while (offset < text.length && /\s/u.test(text[offset])) offset += 1;
    }
  }
  return spans;
}

function withHashes(spans) {
  return spans.map(span => ({ ...span, quoteHash: stableHash(span.quoteText),
    allowedUses: ['analysis', 'citation', 'comparison'] }));
}

export function buildGitHubRepositorySourceArchive(value, options = {}) {
  const materialsMode = value?.schemaVersion === 'github-repository-materials-v1';
  const output = materialsMode
    ? validateGitHubRepositoryMaterialsOutput(value)
    : validateGitHubRepositoryReadOutput(value);
  const archive = {
    schemaVersion: 'research-source-archive-v1', artifactKind: 'github.repository',
    source: { canonicalUrl: output.repository.canonicalUrl, sourceType: 'github',
      publisher: output.repository.owner ?? output.repository.key?.split('/')[0] ?? null,
      authorityTier: 'official-implementation' },
    version: { fetchedAt: output.sourceVersion.fetchedAt,
      publishedAt: output.metadata.pushedAt ?? null,
      contentHash: output.sourceVersion.contentSha256,
      locator: { kind: 'github.repository', repository: output.repository.canonicalUrl,
        revision: output.sourceVersion.revision, canonicalUri: output.sourceVersion.canonicalUri },
      contentType: materialsMode ? 'application/vnd.gamehub.github-repository-materials+json'
        : 'application/vnd.gamehub.github-repository-evidence+json' },
    evidence: withHashes(materialsMode
      ? buildGitHubRepositoryMaterialsEvidenceSpans(output, options)
      : buildGitHubRepositoryEvidenceSpans(output, options)),
    extension: { kind: 'github.repository', repository: output.repository,
      revision: output.sourceVersion.revision },
  };
  return validateSourceArchiveV1(archive);
}

export function buildArxivPaperSourceArchive(value) {
  const output = validateArxivPaperReadOutput(value);
  const qualityAssessment = output.qualityAssessment ?? null;
  const allowedUses = qualityAssessment?.permittedUses
    ?? ['analysis', 'citation', 'comparison'];
  const metadataText = compact([
    `论文：${output.identity.title}`,
    `作者：${output.identity.authors.join('、')}`,
    `年份：${output.identity.year}`,
    output.identity.identifiers.doi ? `DOI：${output.identity.identifiers.doi}` : '',
    `arXiv：${output.identity.identifiers.arxiv}`,
    `摘要：${output.metadata.abstract}`,
  ].filter(Boolean).join('\n'), 2000);
  const evidence = [{
    role: 'metadata', evidenceKind: 'metadata', quoteText: metadataText,
    quoteHash: stableHash(metadataText), allowedUses,
    locator: { kind: 'paper.metadata', canonicalId: output.identity.canonicalId,
      arxiv: output.metadata.versionedArxivId, canonicalUri: output.sourceVersion.canonicalUri },
  }, ...output.evidenceSpans.map((span, index) => ({
    role: index === 0 ? 'primary-text' : 'supporting-text', evidenceKind: 'direct-quote',
    quoteText: span.quoteText, quoteHash: span.quoteHash,
    allowedUses, locator: span.locator,
  }))];
  const archive = {
    schemaVersion: 'research-source-archive-v1', artifactKind: 'paper',
    source: { canonicalUrl: output.version.sourceUrl, sourceType: 'pdf', publisher: 'arXiv',
      authorityTier: 'official-primary' },
    version: { fetchedAt: output.version.fetchedAt, publishedAt: output.metadata.updatedAt,
      contentHash: output.version.contentSha256,
      locator: { kind: 'paper.arxiv', canonicalId: output.identity.canonicalId,
        arxiv: output.metadata.versionedArxivId, canonicalUri: output.sourceVersion.canonicalUri },
      contentType: 'application/pdf' },
    evidence, extension: { kind: 'paper', identity: output.identity, version: output.version,
      layoutManifest: output.layoutManifest, ...(qualityAssessment ? { qualityAssessment } : {}) },
  };
  return validateSourceArchiveV1(archive);
}

const bindingView = row => ({
  id: row.id,
  agentUserId: row.agent_user_id,
  runId: row.run_id,
  stageId: row.stage_id,
  actionId: row.action_id,
  toolArtifactId: row.tool_artifact_id,
  researchSourceId: row.research_source_id,
  researchSourceVersionId: row.research_source_version_id,
  artifactKind: row.artifact_kind,
  locator: row.locator,
  contentSha256: row.content_sha256,
  createdAt: row.created_at?.toISOString?.() ?? row.created_at,
});

export class PostgresAgentResearchEvidenceRepository {
  constructor(pool, { readmeChunkChars = 1600, maxReadmeChunks = 8 } = {}) {
    if (!pool) fail('AGENT_RESEARCH_EVIDENCE_CONFIG_INVALID');
    this.pool = pool;
    this.readmeChunkChars = readmeChunkChars;
    this.maxReadmeChunks = maxReadmeChunks;
  }

  async archiveSourceArtifact(args) {
    uuid(args?.toolArtifactId);
    const row = (await this.pool.query(`SELECT call.tool_key
      FROM agent_tool_artifacts artifact
      JOIN agent_tool_calls call ON call.id=artifact.tool_call_id
      WHERE artifact.id=$1`, [args.toolArtifactId])).rows[0];
    if (!row) fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
    if (row.tool_key === 'research.paper.arxiv.read') return this.archiveArxivPaperArtifact(args);
    if (row.tool_key === 'research.paper.analysis.read') return this.archivePaperAnalysisArtifact(args);
    if (['research.github.repository.read', 'research.github.repository.materials.read']
      .includes(row.tool_key)) return this.archiveGitHubRepositoryArtifact(args);
    fail('AGENT_RESEARCH_EVIDENCE_TOOL_UNSUPPORTED');
  }

  async archivePaperAnalysisArtifact({ runId, stageId, actionId, toolArtifactId, workerId, leaseToken }) {
    [runId, stageId, actionId, toolArtifactId, leaseToken].forEach(uuid);
    if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 160) {
      fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`SELECT artifact.*,run.agent_user_id,action.stage_id,
          call.tool_key,call.contract_version,stage.leased_by,stage.lease_token,
          stage.lease_until>now() AS lease_valid
        FROM agent_tool_artifacts artifact
        JOIN agent_tool_calls call ON call.id=artifact.tool_call_id AND call.status='succeeded'
        JOIN agent_run_actions action ON action.id=artifact.action_id AND action.status='succeeded'
        JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=run.id
        WHERE artifact.id=$1 AND action.id=$2 AND run.id=$3 AND stage.id=$4
        FOR UPDATE OF stage`, [toolArtifactId, actionId, runId, stageId])).rows[0];
      if (!row || row.leased_by !== workerId || row.lease_token !== leaseToken || row.lease_valid !== true) {
        fail('AGENT_RUNTIME_LEASE_LOST');
      }
      if (row.tool_key !== 'research.paper.analysis.read' || Number(row.contract_version) !== 1) {
        fail('AGENT_RESEARCH_EVIDENCE_TOOL_UNSUPPORTED');
      }
      const existing = (await client.query(`SELECT binding.*,
          (SELECT count(*)::int FROM agent_research_evidence_bindings link
            WHERE link.artifact_binding_id=binding.id) AS evidence_count
        FROM agent_research_artifact_bindings binding WHERE binding.tool_artifact_id=$1`,
      [toolArtifactId])).rows[0];
      if (existing) {
        if (existing.run_id !== runId || existing.action_id !== actionId
          || existing.content_sha256 !== row.content_sha256) fail('AGENT_RESEARCH_EVIDENCE_BINDING_CONFLICT');
        return { ...bindingView(existing), evidenceCount: Number(existing.evidence_count), existing: true };
      }
      const output = validatePaperAnalysisReadOutput(row.content_json);
      if (stableHash(output) !== row.content_sha256) fail('AGENT_RESEARCH_EVIDENCE_ARTIFACT_HASH_MISMATCH');
      const analysis = (await client.query(`SELECT analysis.id,analysis.analysis_sha256,
          analysis.paper_version_id,analysis.section_manifest,version.research_source_version_id,source_version.source_id
        FROM agent_paper_semantic_analyses analysis
        JOIN agent_paper_versions version ON version.id=analysis.paper_version_id
        JOIN tool_research_source_versions source_version ON source_version.id=version.research_source_version_id
        WHERE analysis.id=$1 AND analysis.agent_user_id=$2`,
      [output.analysisId, row.agent_user_id])).rows[0];
      if (!analysis || analysis.analysis_sha256 !== output.analysisSha256
        || analysis.paper_version_id !== output.paperVersionId) fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
      if (stableHash(analysis.section_manifest?.readingScope ?? null) !== stableHash(output.readingScope ?? null)) {
        fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
      }
      const evidenceIds = [...new Set(output.evidence.map(item => item.id))];
      const validEvidence = (await client.query(`SELECT id FROM tool_research_evidence
        WHERE source_version_id=$1 AND id=ANY($2::uuid[])
          AND allowed_uses @> $3::text[] ORDER BY id`,
      [analysis.research_source_version_id, evidenceIds, output.readingScope ? ['analysis'] : ['citation']])).rows;
      if (validEvidence.length !== evidenceIds.length) fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
      const binding = (await client.query(`INSERT INTO agent_research_artifact_bindings(
          id,agent_user_id,run_id,stage_id,action_id,tool_artifact_id,research_source_id,
          research_source_version_id,artifact_kind,locator,content_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'paper',$9,$10) RETURNING *`, [
        crypto.randomUUID(), row.agent_user_id, runId, stageId, actionId, toolArtifactId,
        analysis.source_id, analysis.research_source_version_id,
        json({ analysisId: output.analysisId, paperVersionId: output.paperVersionId,
          sourceUrl: output.paper.sourceUrl }), row.content_sha256,
      ])).rows[0];
      for (const evidence of validEvidence) await client.query(`INSERT INTO agent_research_evidence_bindings(
          artifact_binding_id,evidence_id,evidence_role
        ) VALUES($1,$2,'primary-text') ON CONFLICT DO NOTHING`, [binding.id, evidence.id]);
      await client.query(`INSERT INTO agent_run_events(
          run_id,stage_id,action_id,event_type,actor_kind,actor_ref,payload_json
        ) VALUES($1,$2,$3,'research.evidence-archived','worker',$4,$5)`, [
        runId, stageId, actionId, workerId,
        json({ bindingId: binding.id, analysisId: output.analysisId,
          paperVersionId: output.paperVersionId, toolArtifactId, evidenceCount: validEvidence.length }),
      ]);
      return { ...bindingView(binding), evidenceCount: validEvidence.length, existing: false,
        analysisId: output.analysisId, paperVersionId: output.paperVersionId };
    });
  }

  async archiveArxivPaperArtifact({ runId, stageId, actionId, toolArtifactId, workerId, leaseToken }) {
    [runId, stageId, actionId, toolArtifactId, leaseToken].forEach(uuid);
    if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 160) {
      fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`SELECT artifact.*,run.agent_user_id,action.stage_id,
          call.tool_key,call.contract_version,stage.leased_by,stage.lease_token,
          stage.lease_until>now() AS lease_valid
        FROM agent_tool_artifacts artifact
        JOIN agent_tool_calls call ON call.id=artifact.tool_call_id AND call.status='succeeded'
        JOIN agent_run_actions action ON action.id=artifact.action_id AND action.status='succeeded'
        JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=run.id
        WHERE artifact.id=$1 AND action.id=$2 AND run.id=$3 AND stage.id=$4
        FOR UPDATE OF stage`, [toolArtifactId, actionId, runId, stageId])).rows[0];
      if (!row || row.leased_by !== workerId || row.lease_token !== leaseToken || row.lease_valid !== true) {
        fail('AGENT_RUNTIME_LEASE_LOST');
      }
      if (row.tool_key !== 'research.paper.arxiv.read'
        || ![1, 2].includes(Number(row.contract_version))) {
        fail('AGENT_RESEARCH_EVIDENCE_TOOL_UNSUPPORTED');
      }
      const existing = (await client.query(`SELECT binding.*,
          (SELECT count(*)::int FROM agent_research_evidence_bindings link
            WHERE link.artifact_binding_id=binding.id) AS evidence_count
        FROM agent_research_artifact_bindings binding WHERE binding.tool_artifact_id=$1`,
      [toolArtifactId])).rows[0];
      if (existing) {
        if (existing.run_id !== runId || existing.action_id !== actionId
          || existing.content_sha256 !== row.content_sha256) fail('AGENT_RESEARCH_EVIDENCE_BINDING_CONFLICT');
        const paper = (await client.query(`SELECT version.id,version.paper_identity_id,
            assessment.reliability_grade,assessment.reason_codes,assessment.assessment_sha256
          FROM agent_paper_versions version
          LEFT JOIN agent_paper_parse_assessments assessment ON assessment.paper_version_id=version.id
          WHERE version.research_source_version_id=$1`, [existing.research_source_version_id])).rows[0];
        if (!paper) fail('AGENT_RESEARCH_EVIDENCE_BINDING_CONFLICT');
        return { ...bindingView(existing), evidenceCount: Number(existing.evidence_count), existing: true,
          paperIdentityId: paper.paper_identity_id, paperVersionId: paper.id,
          parseQuality: paper.assessment_sha256 ? {
            grade: paper.reliability_grade, reasonCodes: paper.reason_codes,
            assessmentSha256: paper.assessment_sha256,
          } : null };
      }
      const output = validateArxivPaperReadOutput(row.content_json);
      if (stableHash(output) !== row.content_sha256) fail('AGENT_RESEARCH_EVIDENCE_ARTIFACT_HASH_MISMATCH');
      const archive = buildArxivPaperSourceArchive(output);
      const source = (await client.query(`INSERT INTO tool_research_sources(
          id,user_id,canonical_url,source_type,publisher,authority_tier,status
        ) VALUES($1,$2,$3,$4,$5,$6,'tracked')
        ON CONFLICT(user_id,canonical_url,source_type) DO UPDATE SET
          publisher=COALESCE(tool_research_sources.publisher,EXCLUDED.publisher),
          status=CASE WHEN tool_research_sources.status='candidate' THEN 'tracked'
            ELSE tool_research_sources.status END,last_seen_at=now(),updated_at=now()
        RETURNING *`, [crypto.randomUUID(), row.agent_user_id, archive.source.canonicalUrl,
        archive.source.sourceType, archive.source.publisher, archive.source.authorityTier])).rows[0];
      let sourceVersion = (await client.query(`SELECT * FROM tool_research_source_versions
        WHERE source_id=$1 AND content_hash=$2 ORDER BY fetched_at DESC,id DESC LIMIT 1`,
      [source.id, archive.version.contentHash])).rows[0];
      if (!sourceVersion) {
        const previous = (await client.query(`SELECT id FROM tool_research_source_versions
          WHERE source_id=$1 ORDER BY fetched_at DESC,id DESC LIMIT 1`, [source.id])).rows[0];
        sourceVersion = (await client.query(`INSERT INTO tool_research_source_versions(
            id,source_id,fetched_at,published_at,content_hash,normalized_hash,locator,content_type,
            storage_ref,previous_version_id,fetch_receipt
          ) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING *`, [
          crypto.randomUUID(), source.id, archive.version.fetchedAt, archive.version.publishedAt,
          archive.version.contentHash, json(archive.version.locator), archive.version.contentType,
          `agent-tool-artifact:${toolArtifactId}`, previous?.id ?? null,
          json({ protocol: 'agent-tool-gateway-v1', toolKey: row.tool_key,
            contractVersion: Number(row.contract_version), toolArtifactId,
            artifactSha256: row.content_sha256 }),
        ])).rows[0];
      }
      let identity = (await client.query(`SELECT * FROM agent_paper_identities
        WHERE agent_user_id=$1 AND canonical_id=$2`,
      [row.agent_user_id, archive.extension.identity.canonicalId])).rows[0];
      if (!identity) identity = (await client.query(`INSERT INTO agent_paper_identities(
          id,agent_user_id,canonical_id,doi,arxiv_id,title,authors,publication_year,venue,
          identity_confidence
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
        crypto.randomUUID(), row.agent_user_id, archive.extension.identity.canonicalId,
        archive.extension.identity.identifiers.doi, archive.extension.identity.identifiers.arxiv,
        archive.extension.identity.title, json(archive.extension.identity.authors),
        archive.extension.identity.year, archive.extension.identity.venue,
        archive.extension.identity.identityConfidence,
      ])).rows[0];
      let paperVersion = (await client.query(`SELECT * FROM agent_paper_versions
        WHERE research_source_version_id=$1`, [sourceVersion.id])).rows[0];
      if (!paperVersion) paperVersion = (await client.query(`INSERT INTO agent_paper_versions(
          id,paper_identity_id,research_source_version_id,external_artifact_version_id,version_kind,
          source_url,access_level,parent_version_id,version_relation,content_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
        crypto.randomUUID(), identity.id, sourceVersion.id, archive.extension.version.artifactVersionId,
        archive.extension.version.versionKind, archive.extension.version.sourceUrl,
        archive.extension.version.accessLevel, null, 'initial', archive.extension.version.contentSha256,
      ])).rows[0];
      await client.query(`INSERT INTO agent_paper_layout_manifests(
          paper_version_id,parser_version,page_count,manifest_json,content_sha256
        ) VALUES($1,$2,$3,$4,$5) ON CONFLICT(paper_version_id) DO NOTHING`, [
        paperVersion.id, archive.extension.layoutManifest.parserVersion,
        archive.extension.layoutManifest.pageCount, json(archive.extension.layoutManifest),
        archive.extension.version.contentSha256,
      ]);
      let qualityAssessment = null;
      if (archive.extension.qualityAssessment) {
        const assessment = archive.extension.qualityAssessment;
        const assessmentSha256 = stableHash(assessment);
        qualityAssessment = (await client.query(`INSERT INTO agent_paper_parse_assessments(
            paper_version_id,schema_version,policy_version,parser_version,reliability_grade,
            permitted_uses,reason_codes,metrics_json,assessment_sha256
          ) VALUES($1,1,$2,$3,$4,$5::text[],$6::text[],$7,$8)
          ON CONFLICT(paper_version_id) DO NOTHING RETURNING *`, [
          paperVersion.id, assessment.policyVersion, assessment.parserVersion, assessment.grade,
          assessment.permittedUses, assessment.reasonCodes, json(assessment.metrics), assessmentSha256,
        ])).rows[0];
        if (!qualityAssessment) qualityAssessment = (await client.query(
          'SELECT * FROM agent_paper_parse_assessments WHERE paper_version_id=$1',
          [paperVersion.id])).rows[0];
        if (!qualityAssessment || qualityAssessment.assessment_sha256 !== assessmentSha256) {
          fail('AGENT_PAPER_PARSE_ASSESSMENT_CONFLICT');
        }
      }
      const binding = (await client.query(`INSERT INTO agent_research_artifact_bindings(
          id,agent_user_id,run_id,stage_id,action_id,tool_artifact_id,research_source_id,
          research_source_version_id,artifact_kind,locator,content_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'paper',$9,$10) RETURNING *`, [
        crypto.randomUUID(), row.agent_user_id, runId, stageId, actionId, toolArtifactId,
        source.id, sourceVersion.id,
        json({ canonicalId: archive.extension.identity.canonicalId,
          artifactVersionId: archive.extension.version.artifactVersionId,
          canonicalUri: archive.version.locator.canonicalUri }), row.content_sha256,
      ])).rows[0];
      for (const span of archive.evidence) {
        let evidence = (await client.query(`INSERT INTO tool_research_evidence(
            id,source_version_id,locator,quote_text,quote_hash,evidence_kind,allowed_uses
          ) VALUES($1,$2,$3,$4,$5,$6,$7::text[])
          ON CONFLICT(source_version_id,quote_hash,evidence_kind) DO NOTHING RETURNING *`, [
          crypto.randomUUID(), sourceVersion.id, json(span.locator), span.quoteText, span.quoteHash,
          span.evidenceKind, span.allowedUses,
        ])).rows[0];
        if (!evidence) evidence = (await client.query(`SELECT * FROM tool_research_evidence
          WHERE source_version_id=$1 AND quote_hash=$2 AND evidence_kind=$3`,
        [sourceVersion.id, span.quoteHash, span.evidenceKind])).rows[0];
        await client.query(`INSERT INTO agent_research_evidence_bindings(
          artifact_binding_id,evidence_id,evidence_role
        ) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [binding.id, evidence.id, span.role]);
      }
      const evidenceCount = Number((await client.query(`SELECT count(*)::int AS n
        FROM agent_research_evidence_bindings WHERE artifact_binding_id=$1`, [binding.id])).rows[0].n);
      await client.query(`INSERT INTO agent_run_events(
          run_id,stage_id,action_id,event_type,actor_kind,actor_ref,payload_json
        ) VALUES($1,$2,$3,'research.evidence-archived','worker',$4,$5)`, [
        runId, stageId, actionId, workerId,
        json({ bindingId: binding.id, sourceId: source.id, sourceVersionId: sourceVersion.id,
          paperIdentityId: identity.id, paperVersionId: paperVersion.id, toolArtifactId, evidenceCount,
          parseQuality: qualityAssessment ? {
            grade: qualityAssessment.reliability_grade,
            reasonCodes: qualityAssessment.reason_codes,
            assessmentSha256: qualityAssessment.assessment_sha256,
          } : null }),
      ]);
      return { ...bindingView(binding), evidenceCount, existing: false,
        paperIdentityId: identity.id, paperVersionId: paperVersion.id,
        parseQuality: qualityAssessment ? {
          grade: qualityAssessment.reliability_grade,
          reasonCodes: qualityAssessment.reason_codes,
          assessmentSha256: qualityAssessment.assessment_sha256,
        } : null };
    });
  }

  async archiveGitHubRepositoryArtifact({ runId, stageId, actionId, toolArtifactId, workerId, leaseToken }) {
    [runId, stageId, actionId, toolArtifactId, leaseToken].forEach(uuid);
    if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 160) {
      fail('AGENT_RESEARCH_EVIDENCE_INPUT_INVALID');
    }
    return withTransaction(this.pool, async client => {
      const row = (await client.query(`SELECT artifact.*,run.agent_user_id,action.stage_id,
          call.tool_key,call.contract_version,stage.leased_by,stage.lease_token,
          stage.lease_until>now() AS lease_valid
        FROM agent_tool_artifacts artifact
        JOIN agent_tool_calls call ON call.id=artifact.tool_call_id AND call.status='succeeded'
        JOIN agent_run_actions action ON action.id=artifact.action_id AND action.status='succeeded'
        JOIN agent_runs run ON run.id=action.run_id
        JOIN agent_run_stages stage ON stage.id=action.stage_id AND stage.run_id=run.id
        WHERE artifact.id=$1 AND action.id=$2 AND run.id=$3 AND stage.id=$4
        FOR UPDATE OF stage`, [toolArtifactId, actionId, runId, stageId])).rows[0];
      if (!row || row.leased_by !== workerId || row.lease_token !== leaseToken || row.lease_valid !== true) {
        fail('AGENT_RUNTIME_LEASE_LOST');
      }
      if (!['research.github.repository.read', 'research.github.repository.materials.read'].includes(row.tool_key)
        || Number(row.contract_version) !== 1) {
        fail('AGENT_RESEARCH_EVIDENCE_TOOL_UNSUPPORTED');
      }
      const existing = (await client.query(`SELECT binding.*,
          (SELECT count(*)::int FROM agent_research_evidence_bindings link
            WHERE link.artifact_binding_id=binding.id) AS evidence_count
        FROM agent_research_artifact_bindings binding WHERE binding.tool_artifact_id=$1`,
      [toolArtifactId])).rows[0];
      if (existing) {
        if (existing.run_id !== runId || existing.action_id !== actionId
          || existing.content_sha256 !== row.content_sha256) fail('AGENT_RESEARCH_EVIDENCE_BINDING_CONFLICT');
        return { ...bindingView(existing), evidenceCount: Number(existing.evidence_count), existing: true };
      }
      const materialsMode = row.tool_key === 'research.github.repository.materials.read';
      const output = materialsMode
        ? validateGitHubRepositoryMaterialsOutput(row.content_json)
        : validateGitHubRepositoryReadOutput(row.content_json);
      buildGitHubRepositorySourceArchive(output, materialsMode
        ? { chunkChars: this.readmeChunkChars, maxChunksPerMaterial: Math.min(4, this.maxReadmeChunks) }
        : { chunkChars: this.readmeChunkChars, maxChunks: this.maxReadmeChunks });
      const versionContent = materialsMode
        ? { metadata: output.metadata, materials: output.materials }
        : { metadata: output.metadata, readme: output.readme };
      if (stableHash(output) !== row.content_sha256
        || output.sourceVersion.contentSha256 !== stableHash(versionContent)) {
        fail('AGENT_RESEARCH_EVIDENCE_ARTIFACT_HASH_MISMATCH');
      }
      const source = (await client.query(`INSERT INTO tool_research_sources(
          id,user_id,canonical_url,source_type,publisher,authority_tier,status
        ) VALUES($1,$2,$3,'github',$4,'official-implementation','tracked')
        ON CONFLICT(user_id,canonical_url,source_type) DO UPDATE SET
          publisher=COALESCE(tool_research_sources.publisher,EXCLUDED.publisher),
          status=CASE WHEN tool_research_sources.status='candidate' THEN 'tracked'
            ELSE tool_research_sources.status END,last_seen_at=now(),updated_at=now()
        RETURNING *`, [crypto.randomUUID(), row.agent_user_id, output.repository.canonicalUrl,
        output.repository.owner])).rows[0];
      let version = (await client.query(`SELECT * FROM tool_research_source_versions
        WHERE source_id=$1 AND content_hash=$2 ORDER BY fetched_at DESC,id DESC LIMIT 1`,
      [source.id, output.sourceVersion.contentSha256])).rows[0];
      if (!version) {
        const previous = (await client.query(`SELECT id FROM tool_research_source_versions
          WHERE source_id=$1 ORDER BY fetched_at DESC,id DESC LIMIT 1`, [source.id])).rows[0];
        version = (await client.query(`INSERT INTO tool_research_source_versions(
            id,source_id,fetched_at,published_at,content_hash,normalized_hash,locator,content_type,
            storage_ref,previous_version_id,fetch_receipt
          ) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) RETURNING *`, [
          crypto.randomUUID(), source.id, output.sourceVersion.fetchedAt, output.metadata.pushedAt,
          output.sourceVersion.contentSha256,
          json({ kind: 'github.repository', repository: output.repository.canonicalUrl,
            revision: output.sourceVersion.revision, canonicalUri: output.sourceVersion.canonicalUri }),
          materialsMode ? 'application/vnd.gamehub.github-repository-materials+json'
            : 'application/vnd.gamehub.github-repository-evidence+json',
          `agent-tool-artifact:${toolArtifactId}`, previous?.id ?? null,
          json({ protocol: 'agent-tool-gateway-v1', toolKey: row.tool_key,
            contractVersion: Number(row.contract_version), toolArtifactId,
            artifactSha256: row.content_sha256 }),
        ])).rows[0];
      }
      const binding = (await client.query(`INSERT INTO agent_research_artifact_bindings(
          id,agent_user_id,run_id,stage_id,action_id,tool_artifact_id,research_source_id,
          research_source_version_id,artifact_kind,locator,content_sha256
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'github.repository',$9,$10) RETURNING *`, [
        crypto.randomUUID(), row.agent_user_id, runId, stageId, actionId, toolArtifactId,
        source.id, version.id,
        json({ repository: output.repository.canonicalUrl, revision: output.sourceVersion.revision }),
        row.content_sha256,
      ])).rows[0];
      const spans = materialsMode
        ? buildGitHubRepositoryMaterialsEvidenceSpans(output, {
          chunkChars: this.readmeChunkChars,
          maxChunksPerMaterial: Math.min(4, this.maxReadmeChunks),
        })
        : buildGitHubRepositoryEvidenceSpans(output, {
          chunkChars: this.readmeChunkChars, maxChunks: this.maxReadmeChunks,
        });
      for (const span of spans) {
        const quoteHash = stableHash(span.quoteText);
        let evidence = (await client.query(`INSERT INTO tool_research_evidence(
            id,source_version_id,locator,quote_text,quote_hash,evidence_kind,allowed_uses
          ) VALUES($1,$2,$3,$4,$5,$6,ARRAY['analysis','citation','comparison']::text[])
          ON CONFLICT(source_version_id,quote_hash,evidence_kind) DO NOTHING RETURNING *`, [
          crypto.randomUUID(), version.id, json(span.locator), span.quoteText, quoteHash, span.evidenceKind,
        ])).rows[0];
        if (!evidence) evidence = (await client.query(`SELECT * FROM tool_research_evidence
          WHERE source_version_id=$1 AND quote_hash=$2 AND evidence_kind=$3`,
        [version.id, quoteHash, span.evidenceKind])).rows[0];
        await client.query(`INSERT INTO agent_research_evidence_bindings(
          artifact_binding_id,evidence_id,evidence_role
        ) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [binding.id, evidence.id, span.role]);
      }
      const evidenceCount = Number((await client.query(`SELECT count(*)::int AS n
        FROM agent_research_evidence_bindings WHERE artifact_binding_id=$1`, [binding.id])).rows[0].n);
      await client.query(`INSERT INTO agent_run_events(
          run_id,stage_id,action_id,event_type,actor_kind,actor_ref,payload_json
        ) VALUES($1,$2,$3,'research.evidence-archived','worker',$4,$5)`, [
        runId, stageId, actionId, workerId,
        json({ bindingId: binding.id, sourceId: source.id, sourceVersionId: version.id,
          toolArtifactId, evidenceCount }),
      ]);
      return { ...bindingView(binding), evidenceCount, existing: false };
    });
  }
}
