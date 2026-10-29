import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractPaperPdf } from './agent-arxiv-paper-tool.mjs';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { AGENT_PAPER_INTAKE_LIMITS, AgentPaperIntakeSecurityError,
  buildPaperLayoutCapabilityReport, normalizeDoi, scanPrivatePaperPdf }
  from './agent-paper-intake-security.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RIGHTS = new Set(['user-owned', 'authorized-use', 'open-license']);
const errors = {
  PAPER_INTAKE_INPUT_INVALID: [400, '论文收件参数无效。'],
  PAPER_INTAKE_OPERATOR_REQUIRED: [403, '需要管理员权限。'],
  PAPER_INTAKE_AGENT_NOT_FOUND: [404, '机器人不存在或不属于当前运营者。'],
  PAPER_DOI_INVALID: [400, 'DOI 格式无效。'],
  PAPER_DOI_NOT_FOUND: [404, '没有找到这个 DOI 的元数据。'],
  PAPER_DOI_UPSTREAM_FAILED: [502, 'DOI 元数据服务暂不可用。'],
  PAPER_DOI_METADATA_INVALID: [422, 'DOI 元数据不完整，未写入研究账本。'],
  PAPER_PDF_BLOCKED: [422, '文件未通过私有论文安全与版面门禁。'],
  PAPER_INTAKE_CONFLICT: [409, '幂等请求与已有收件记录冲突。'],
};

export class AgentPaperIntakeServiceError extends Error {
  constructor(code, details = {}) {
    const entry = errors[code] ?? [409, '论文收件失败。'];
    super(`${code}: ${entry[1]}`); this.name = 'AgentPaperIntakeServiceError';
    this.code = code; this.statusCode = entry[0]; this.retryable = this.statusCode >= 500;
    this.details = details;
  }
}
const fail = (code, details) => { throw new AgentPaperIntakeServiceError(code, details); };
const json = value => JSON.stringify(value);
const iso = value => value?.toISOString?.() ?? value ?? null;
const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('PAPER_INTAKE_INPUT_INVALID'); return value; };
const deterministicUuid = seed => {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const cleanFilename = value => {
  if (typeof value !== 'string') fail('PAPER_INTAKE_INPUT_INVALID');
  const filename = path.basename(value).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  if (filename.length < 1 || filename.length > 240 || !/\.pdf$/iu.test(filename)) fail('PAPER_INTAKE_INPUT_INVALID');
  return filename;
};
const rowView = row => ({
  id: row.id, kind: row.intake_kind, status: row.status, doi: row.canonical_doi,
  filename: row.original_filename, mediaType: row.sniffed_media_type ?? row.declared_media_type,
  bytes: row.byte_length === null ? null : Number(row.byte_length), sha256: row.content_sha256,
  rightsAttestation: row.rights_attestation, security: row.security_report,
  paperIdentityId: row.paper_identity_id, paperVersionId: row.paper_version_id,
  failureCode: row.failure_code, createdAt: iso(row.created_at), private: true,
});

function parseCrossref(message, doi) {
  const title = message?.title?.find?.(item => typeof item === 'string' && item.trim())?.trim();
  const authors = (Array.isArray(message?.author) ? message.author : []).map(author =>
    [author?.given, author?.family].filter(item => typeof item === 'string' && item.trim())
      .join(' ').trim()).filter(Boolean).slice(0, 200);
  const parts = message?.issued?.['date-parts']?.[0] ?? message?.published?.['date-parts']?.[0] ?? [];
  const year = Number(parts[0]);
  const venue = message?.['container-title']?.find?.(item => typeof item === 'string' && item.trim())?.trim()
    ?? null;
  if (!title || title.length > 1000 || authors.length < 1 || !Number.isSafeInteger(year)
    || year < 1600 || year > 3000 || (venue && venue.length > 500)) fail('PAPER_DOI_METADATA_INVALID');
  return { doi, title, authors, year, venue };
}

async function readCrossref(doi, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'User-Agent': 'GameHub-Agent-Paper-Intake/1.0' },
    });
  } catch (error) { fail('PAPER_DOI_UPSTREAM_FAILED', { cause: error?.message ?? 'network' }); }
  if (response.status === 404) fail('PAPER_DOI_NOT_FOUND');
  if (!response.ok) fail('PAPER_DOI_UPSTREAM_FAILED', { status: response.status });
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > AGENT_PAPER_INTAKE_LIMITS.maxDoiMetadataBytes)) {
    fail('PAPER_DOI_METADATA_INVALID');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > AGENT_PAPER_INTAKE_LIMITS.maxDoiMetadataBytes) fail('PAPER_DOI_METADATA_INVALID');
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('PAPER_DOI_METADATA_INVALID'); }
  return parseCrossref(payload?.message, doi);
}

export function createAgentPaperIntakeService({ pool, quarantineStore, siteOrigin = 'https://mooyu.fun',
  fetchImpl = globalThis.fetch, authorizeOperator } = {}) {
  if (!pool || !quarantineStore || typeof fetchImpl !== 'function'
    || typeof authorizeOperator !== 'function') fail('PAPER_INTAKE_CONFIG_INVALID');
  const origin = new URL(siteOrigin).origin;
  const scope = async (actor, agentUserId) => {
    const operatorId = uuid(actor?.userId);
    if (await authorizeOperator(structuredClone(actor)) !== true) fail('PAPER_INTAKE_OPERATOR_REQUIRED');
    const account = (await pool.query(`SELECT user_id FROM agent_accounts
      WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`, [uuid(agentUserId), operatorId])).rows[0];
    if (!account) fail('PAPER_INTAKE_AGENT_NOT_FOUND');
    return { agentUserId: account.user_id, operatorId };
  };
  const existing = async (agentUserId, requestId) => (await pool.query(
    'SELECT * FROM agent_paper_private_intakes WHERE agent_user_id=$1 AND request_id=$2',
    [agentUserId, requestId])).rows[0] ?? null;
  const assertIdempotentMatch = (prior, expected) => {
    const comparisons = [
      ['intake_kind', expected.kind], ['canonical_doi', expected.doi],
      ['original_filename', expected.filename], ['rights_attestation', expected.rights],
      ['content_sha256', expected.sha256],
    ];
    if (comparisons.some(([key, value]) => value !== undefined && (prior[key] ?? null) !== value)) {
      fail('PAPER_INTAKE_CONFLICT');
    }
    return rowView(prior);
  };

  const archiveDoi = async ({ agentUserId, operatorId, requestId, metadata }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = (await client.query(`SELECT * FROM agent_paper_private_intakes
        WHERE agent_user_id=$1 AND request_id=$2 FOR UPDATE`, [agentUserId, requestId])).rows[0];
      if (prior) {
        const view = assertIdempotentMatch(prior, { kind: 'doi-metadata', doi: metadata.doi });
        await client.query('COMMIT'); return view;
      }
      let identity = (await client.query(`SELECT * FROM agent_paper_identities
        WHERE agent_user_id=$1 AND canonical_id=$2`, [agentUserId, `doi:${metadata.doi}`])).rows[0];
      if (!identity) identity = (await client.query(`INSERT INTO agent_paper_identities(
          id,agent_user_id,canonical_id,doi,arxiv_id,local_document_id,title,authors,
          publication_year,venue,identity_confidence
        ) VALUES($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,'confirmed') RETURNING *`, [
        crypto.randomUUID(), agentUserId, `doi:${metadata.doi}`, metadata.doi, metadata.title,
        json(metadata.authors), metadata.year, metadata.venue,
      ])).rows[0];
      const sourceUrl = `https://doi.org/${metadata.doi}`;
      const contentHash = stableHash(metadata);
      const source = (await client.query(`INSERT INTO tool_research_sources(
          id,user_id,canonical_url,source_type,publisher,authority_tier,status
        ) VALUES($1,$2,$3,'api','Crossref','institutional','tracked')
        ON CONFLICT(user_id,canonical_url,source_type) DO UPDATE SET last_seen_at=now(),updated_at=now()
        RETURNING *`, [crypto.randomUUID(), agentUserId, sourceUrl])).rows[0];
      let sourceVersion = (await client.query(`SELECT * FROM tool_research_source_versions
        WHERE source_id=$1 AND content_hash=$2`, [source.id, contentHash])).rows[0];
      if (!sourceVersion) sourceVersion = (await client.query(`INSERT INTO tool_research_source_versions(
          id,source_id,fetched_at,published_at,content_hash,normalized_hash,locator,content_type,
          storage_ref,previous_version_id,fetch_receipt
        ) VALUES($1,$2,now(),NULL,$3,$3,$4,'application/vnd.crossref.metadata+json',$5,NULL,$6)
        RETURNING *`, [crypto.randomUUID(), source.id, contentHash, json({ kind: 'doi', doi: metadata.doi }),
        `crossref:${metadata.doi}`, json({ protocol: 'paper-private-intake-v1', requestId })])).rows[0];
      let version = (await client.query(`SELECT * FROM agent_paper_versions
        WHERE research_source_version_id=$1`, [sourceVersion.id])).rows[0];
      if (!version) version = (await client.query(`INSERT INTO agent_paper_versions(
          id,paper_identity_id,research_source_version_id,external_artifact_version_id,version_kind,
          source_url,access_level,parent_version_id,version_relation,content_sha256
        ) VALUES($1,$2,$3,$4,'unknown',$5,'metadata-only',NULL,'initial',$6) RETURNING *`, [
        crypto.randomUUID(), identity.id, sourceVersion.id,
        deterministicUuid(`doi:${metadata.doi}:${contentHash}`), sourceUrl, contentHash,
      ])).rows[0];
      const report = { schemaVersion: 'paper-doi-metadata-intake-v1', provider: 'crossref',
        networkRequests: 1, fulltextFetched: false, modelCalls: 0, metadata };
      const intake = (await client.query(`INSERT INTO agent_paper_private_intakes(
          id,agent_user_id,operator_user_id,request_id,intake_kind,status,canonical_doi,
          security_report,paper_identity_id,paper_version_id
        ) VALUES($1,$2,$3,$4,'doi-metadata','accepted',$5,$6,$7,$8) RETURNING *`, [
        crypto.randomUUID(), agentUserId, operatorId, requestId, metadata.doi, json(report),
        identity.id, version.id,
      ])).rows[0];
      await client.query('COMMIT'); return rowView(intake);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };

  const recordBlocked = async ({ agentUserId, operatorId, requestId, filename, rights, bytes,
    sha256, failureCode, report }) => {
    const row = (await pool.query(`INSERT INTO agent_paper_private_intakes(
        id,agent_user_id,operator_user_id,request_id,intake_kind,status,original_filename,
        declared_media_type,sniffed_media_type,byte_length,content_sha256,rights_attestation,
        security_report,failure_code
      ) VALUES($1,$2,$3,$4,'user-pdf','blocked',$5,'application/pdf',$6,$7,$8,$9,$10,$11)
      ON CONFLICT(agent_user_id,request_id) DO NOTHING RETURNING *`, [
      crypto.randomUUID(), agentUserId, operatorId, requestId, filename, report.sniffedMediaType ?? null,
      bytes, sha256, rights, json(report), failureCode,
    ])).rows[0];
    if (row) return rowView(row);
    return assertIdempotentMatch(await existing(agentUserId, requestId), {
      kind: 'user-pdf', filename, rights, sha256,
    });
  };

  const archivePdf = async ({ agentUserId, operatorId, requestId, filename, rights, doi, objectKey,
    scan, extracted, layoutCapability, artifactVersionId }) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = (await client.query(`SELECT * FROM agent_paper_private_intakes
        WHERE agent_user_id=$1 AND request_id=$2 FOR UPDATE`, [agentUserId, requestId])).rows[0];
      if (prior) {
        const view = assertIdempotentMatch(prior, {
          kind: 'user-pdf', doi, filename, rights, sha256: scan.sha256,
        });
        await client.query('COMMIT'); return view;
      }
      const canonicalId = doi ? `doi:${doi}` : `local:${scan.sha256}`;
      let identity = (await client.query(`SELECT * FROM agent_paper_identities
        WHERE agent_user_id=$1 AND canonical_id=$2`, [agentUserId, canonicalId])).rows[0];
      if (!identity) identity = (await client.query(`INSERT INTO agent_paper_identities(
          id,agent_user_id,canonical_id,doi,arxiv_id,local_document_id,title,authors,
          publication_year,venue,identity_confidence
        ) VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,NULL,$9) RETURNING *`, [
        crypto.randomUUID(), agentUserId, canonicalId, doi, scan.sha256,
        filename.replace(/\.pdf$/iu, ''), json(['用户提供']), new Date().getUTCFullYear(),
        doi ? 'provisional' : 'unresolved',
      ])).rows[0];
      const intakeId = crypto.randomUUID();
      const sourceUrl = `${origin}/private/paper-intakes/${intakeId}`;
      const source = (await client.query(`INSERT INTO tool_research_sources(
          id,user_id,canonical_url,source_type,publisher,authority_tier,status
        ) VALUES($1,$2,$3,'pdf','User-provided','unknown','tracked') RETURNING *`,
      [crypto.randomUUID(), agentUserId, sourceUrl])).rows[0];
      const sourceVersion = (await client.query(`INSERT INTO tool_research_source_versions(
          id,source_id,fetched_at,published_at,content_hash,normalized_hash,locator,content_type,
          storage_ref,previous_version_id,fetch_receipt
        ) VALUES($1,$2,now(),NULL,$3,$3,$4,'application/pdf',$5,NULL,$6) RETURNING *`, [
        crypto.randomUUID(), source.id, scan.sha256,
        json({ kind: 'private-paper-upload', intakeId, filename }), `private-archive:${objectKey}`,
        json({ protocol: 'paper-private-intake-v1', requestId, rightsAttestation: rights }),
      ])).rows[0];
      const parent = (await client.query(`SELECT id FROM agent_paper_versions
        WHERE paper_identity_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [identity.id])).rows[0];
      const version = (await client.query(`INSERT INTO agent_paper_versions(
          id,paper_identity_id,research_source_version_id,external_artifact_version_id,version_kind,
          source_url,access_level,parent_version_id,version_relation,content_sha256
        ) VALUES($1,$2,$3,$4,'unknown',$5,'fulltext-user-provided',$6,$7,$8) RETURNING *`, [
        crypto.randomUUID(), identity.id, sourceVersion.id, artifactVersionId, sourceUrl,
        parent?.id ?? null, parent ? 'related-unconfirmed' : 'initial', scan.sha256,
      ])).rows[0];
      const manifest = { artifactVersionId, pageCount: extracted.pageCount,
        parserVersion: extracted.qualityAssessment.parserVersion, pages: extracted.pages };
      await client.query(`INSERT INTO agent_paper_layout_manifests(
        paper_version_id,parser_version,page_count,manifest_json,content_sha256
      ) VALUES($1,$2,$3,$4,$5)`, [version.id, manifest.parserVersion, manifest.pageCount,
      json(manifest), scan.sha256]);
      const assessment = extracted.qualityAssessment;
      await client.query(`INSERT INTO agent_paper_parse_assessments(
        paper_version_id,schema_version,policy_version,parser_version,reliability_grade,
        permitted_uses,reason_codes,metrics_json,assessment_sha256
      ) VALUES($1,1,$2,$3,$4,$5::text[],$6::text[],$7,$8)`, [version.id,
      assessment.policyVersion, assessment.parserVersion, assessment.grade, assessment.permittedUses,
      assessment.reasonCodes, json(assessment.metrics), stableHash(assessment)]);
      for (const span of extracted.evidence) await client.query(`INSERT INTO tool_research_evidence(
          id,source_version_id,locator,quote_text,quote_hash,evidence_kind,allowed_uses
        ) VALUES($1,$2,$3,$4,$5,'direct-quote',$6::text[]) ON CONFLICT DO NOTHING`, [
        crypto.randomUUID(), sourceVersion.id, json(span.locator), span.quoteText, span.quoteHash,
        assessment.permittedUses,
      ]);
      const report = { ...scan, layoutCapability, parseQuality: assessment,
        modelCalls: 0, networkRequests: 0, thirdPartyCodeExecuted: false };
      const intake = (await client.query(`INSERT INTO agent_paper_private_intakes(
          id,agent_user_id,operator_user_id,request_id,intake_kind,status,canonical_doi,
          original_filename,declared_media_type,sniffed_media_type,byte_length,content_sha256,
          object_key,rights_attestation,security_report,paper_identity_id,paper_version_id
        ) VALUES($1,$2,$3,$4,'user-pdf','accepted',$5,$6,'application/pdf','application/pdf',$7,$8,
          $9,$10,$11,$12,$13) RETURNING *`, [intakeId, agentUserId, operatorId, requestId, doi,
        filename, scan.bytes, scan.sha256, objectKey, rights, json(report), identity.id, version.id,
      ])).rows[0];
      await client.query('COMMIT'); return rowView(intake);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };

  return Object.freeze({
    async list(actor, agentUserId, limit = 30) {
      ({ agentUserId } = await scope(actor, agentUserId));
      limit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 30;
      const rows = (await pool.query(`SELECT * FROM agent_paper_private_intakes
        WHERE agent_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`, [agentUserId, limit])).rows;
      const versionIds = rows.map(row => row.paper_version_id).filter(Boolean);
      const evidence = versionIds.length ? (await pool.query(`SELECT version.id AS paper_version_id,
          evidence.id,evidence.quote_text,evidence.locator,evidence.allowed_uses
        FROM agent_paper_versions version
        JOIN tool_research_evidence evidence
          ON evidence.source_version_id=version.research_source_version_id
        WHERE version.id=ANY($1::uuid[]) ORDER BY version.id,evidence.id LIMIT 300`, [versionIds])).rows : [];
      const grouped = new Map();
      for (const item of evidence) {
        const items = grouped.get(item.paper_version_id) ?? [];
        if (items.length < 3) items.push({ id: item.id, quoteText: item.quote_text,
          locator: item.locator, allowedUses: item.allowed_uses ?? [] });
        grouped.set(item.paper_version_id, items);
      }
      return rows.map(row => ({ ...rowView(row), evidencePreview: grouped.get(row.paper_version_id) ?? [] }));
    },
    async registerDoi(actor, agentUserId, { doi, requestId }) {
      const scoped = await scope(actor, agentUserId); requestId = uuid(requestId);
      let normalized;
      try { normalized = normalizeDoi(doi); }
      catch (error) { if (error instanceof AgentPaperIntakeSecurityError) fail(error.code); throw error; }
      const prior = await existing(scoped.agentUserId, requestId);
      if (prior) return assertIdempotentMatch(prior, { kind: 'doi-metadata', doi: normalized });
      const metadata = await readCrossref(normalized, fetchImpl);
      return archiveDoi({ ...scoped, requestId, metadata });
    },
    async uploadPdf(actor, agentUserId, { stream, filename, rightsAttestation, doi = null,
      requestId }) {
      const scoped = await scope(actor, agentUserId); requestId = uuid(requestId);
      filename = cleanFilename(filename);
      if (!RIGHTS.has(rightsAttestation) || !stream?.pipe) fail('PAPER_INTAKE_INPUT_INVALID');
      if (doi) {
        try { doi = normalizeDoi(doi); }
        catch (error) { if (error instanceof AgentPaperIntakeSecurityError) fail(error.code); throw error; }
      }
      const prior = await existing(scoped.agentUserId, requestId);
      if (prior) return assertIdempotentMatch(prior, {
        kind: 'user-pdf', doi, filename, rights: rightsAttestation,
      });
      const objectId = crypto.randomUUID();
      const objectKey = `quarantine/${objectId}/${crypto.randomUUID()}.pdf`;
      let stored;
      try { stored = await quarantineStore.putStream(objectKey, stream, AGENT_PAPER_INTAKE_LIMITS.maxPdfBytes); }
      catch (error) {
        if (error?.code === 'UPLOAD_TOO_LARGE') fail('PAPER_PDF_BLOCKED', { reasonCode: 'PDF_TOO_LARGE' });
        throw error;
      }
      const filePath = quarantineStore.pathFor(objectKey);
      const bytes = new Uint8Array(await fs.readFile(filePath));
      let scan;
      try { scan = scanPrivatePaperPdf(bytes); }
      catch (error) {
        await quarantineStore.remove(objectKey).catch(() => {});
        const code = error instanceof AgentPaperIntakeSecurityError ? error.code : 'PDF_SECURITY_SCAN_FAILED';
        const result = await recordBlocked({ ...scoped, requestId, filename,
          rights: rightsAttestation, bytes: stored.bytes, sha256: stored.sha256, failureCode: code,
          report: { schemaVersion: 'paper-pdf-security-v1', verdict: 'blocked', reasonCode: code,
            sniffedMediaType: null, modelCalls: 0, networkRequests: 0 } });
        fail('PAPER_PDF_BLOCKED', { reasonCode: code, intake: result });
      }
      const artifactVersionId = deterministicUuid(`private-pdf:${scan.sha256}`);
      let extracted;
      try { extracted = await extractPaperPdf(bytes, artifactVersionId); }
      catch (error) {
        await quarantineStore.remove(objectKey).catch(() => {});
        const code = error?.code ?? 'PDF_PARSE_FAILED';
        const result = await recordBlocked({ ...scoped, requestId, filename,
          rights: rightsAttestation, bytes: scan.bytes, sha256: scan.sha256, failureCode: code,
          report: { ...scan, verdict: 'blocked', reasonCode: code, modelCalls: 0, networkRequests: 0 } });
        fail('PAPER_PDF_BLOCKED', { reasonCode: code, intake: result });
      }
      const layoutCapability = buildPaperLayoutCapabilityReport({
        qualityAssessment: extracted.qualityAssessment, pageSignals: extracted.pageSignals,
      });
      if (layoutCapability.grade === 'blocked') {
        await quarantineStore.remove(objectKey).catch(() => {});
        const code = 'PDF_LAYOUT_BLOCKED';
        const result = await recordBlocked({ ...scoped, requestId, filename,
          rights: rightsAttestation, bytes: scan.bytes, sha256: scan.sha256, failureCode: code,
          report: { ...scan, verdict: 'blocked', reasonCode: code, layoutCapability,
            parseQuality: extracted.qualityAssessment, modelCalls: 0, networkRequests: 0 } });
        fail('PAPER_PDF_BLOCKED', { reasonCode: code, intake: result });
      }
      let archiveKey;
      try { archiveKey = await quarantineStore.promotePaper(objectKey, scoped.agentUserId, scan.sha256); }
      catch (error) {
        await quarantineStore.remove(objectKey).catch(() => {});
        throw error;
      }
      return archivePdf({ ...scoped, requestId, filename, rights: rightsAttestation,
        doi, objectKey: archiveKey, scan, extracted, layoutCapability, artifactVersionId });
    },
  });
}
