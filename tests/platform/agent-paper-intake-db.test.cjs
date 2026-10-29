const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const harness = require('./support/researcher-qa-db.cjs');

function minimalPdf(text) {
  const escaped = text.replace(/([\\()])/gu, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, 'ascii');
}

test('R1.6 private paper intake archives bytes and enforces immutable Agent scope in PostgreSQL',
  { skip: !harness.enabled }, async () => {
    const { admin } = await harness.setup();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-paper-intake-db-'));
    try {
      const { createAgentAccountService } = await harness.load('agent-account-service.mjs');
      const { PostgresAgentAccountRepository } = await harness.load('agent-account-repository.mjs');
      const { LocalQuarantineStore } = await harness.load('local-object-store.mjs');
      const { createAgentPaperIntakeService } = await harness.load('agent-paper-intake-service.mjs');
      const operatorId = crypto.randomUUID();
      await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Paper intake operator','admin')",
        [operatorId]);
      const account = await createAgentAccountService({
        repository: new PostgresAgentAccountRepository(admin), authorizeOperator: async () => true,
      }).provision({ userId: operatorId }, {
        provisionKey: `paper-intake-${crypto.randomUUID()}`, displayName: 'Private paper agent',
        handle: `paper-intake-${crypto.randomBytes(5).toString('hex')}`, badgeLabel: 'AI 助手',
        operatorLabel: 'Paper intake test', capabilities: ['blog:auto-publish'], metadata: {},
      });
      const doiPayload = JSON.stringify({ message: { title: ['Verified Metadata Paper'],
        author: [{ given: 'Ada', family: 'Example' }], issued: { 'date-parts': [[2026]] },
        'container-title': ['Fixture Journal'] } });
      const service = createAgentPaperIntakeService({ pool: admin,
        quarantineStore: new LocalQuarantineStore(directory), authorizeOperator: async () => true,
        fetchImpl: async () => new Response(doiPayload, { status: 200,
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(doiPayload)) } }),
      });
      const actor = { userId: operatorId };
      const doiRequestId = crypto.randomUUID();
      const doi = await service.registerDoi(actor, account.agentUserId,
        { doi: '10.5555/private.fixture', requestId: doiRequestId });
      assert.equal(doi.kind, 'doi-metadata');
      assert.equal(doi.status, 'accepted');
      assert.equal((await service.registerDoi(actor, account.agentUserId,
        { doi: '10.5555/private.fixture', requestId: doiRequestId })).id, doi.id);
      await assert.rejects(service.registerDoi(actor, account.agentUserId,
        { doi: '10.5555/different.fixture', requestId: doiRequestId }),
      error => error.code === 'PAPER_INTAKE_CONFLICT');

      const pdf = minimalPdf('This locally supplied paper contains a stable text layer with enough evidence for deterministic private analysis and citation checks.');
      const pdfRequestId = crypto.randomUUID();
      const upload = await service.uploadPdf(actor, account.agentUserId, {
        stream: Readable.from([pdf]), filename: 'fixture-paper.pdf', rightsAttestation: 'user-owned',
        requestId: pdfRequestId,
      });
      assert.equal(upload.status, 'accepted');
      assert.equal(upload.security.modelCalls, 0);
      assert.equal(upload.security.networkRequests, 0);
      const accepted = (await admin.query('SELECT * FROM agent_paper_private_intakes WHERE id=$1',
        [upload.id])).rows[0];
      assert.match(accepted.object_key, new RegExp(`^paper-archive/${account.agentUserId}/[a-f0-9]{64}\\.pdf$`, 'u'));
      assert.equal((await fs.stat(path.join(directory, ...accepted.object_key.split('/')))).isFile(), true);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM tool_research_evidence evidence JOIN agent_paper_versions version ON version.research_source_version_id=evidence.source_version_id WHERE version.id=$1',
        [upload.paperVersionId])).rows[0].n > 0, true);
      assert.equal((await service.uploadPdf(actor, account.agentUserId, {
        stream: Readable.from([pdf]), filename: 'fixture-paper.pdf', rightsAttestation: 'user-owned',
        requestId: pdfRequestId,
      })).id, upload.id);
      await assert.rejects(service.uploadPdf(actor, account.agentUserId, {
        stream: Readable.from([pdf]), filename: 'different.pdf', rightsAttestation: 'user-owned',
        requestId: pdfRequestId,
      }), error => error.code === 'PAPER_INTAKE_CONFLICT');

      await assert.rejects(service.uploadPdf(actor, account.agentUserId, {
        stream: Readable.from([Buffer.from('%PDF-1.7\n/JavaScript /OpenAction unsafe\n%%EOF')]),
        filename: 'active.pdf', rightsAttestation: 'authorized-use', requestId: crypto.randomUUID(),
      }), error => error.code === 'PAPER_PDF_BLOCKED' && error.details.reasonCode === 'PDF_JAVASCRIPT');
      const blocked = (await admin.query("SELECT * FROM agent_paper_private_intakes WHERE status='blocked' AND agent_user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [account.agentUserId])).rows[0];
      assert.equal(blocked.object_key, null);
      assert.equal(blocked.failure_code, 'PDF_JAVASCRIPT');

      await assert.rejects(admin.query("UPDATE agent_paper_private_intakes SET status='blocked' WHERE id=$1",
        [upload.id]), /immutable/u);
      const otherUserId = crypto.randomUUID();
      await admin.query("INSERT INTO users(id,display_name) VALUES($1,'Other scope')", [otherUserId]);
      await assert.rejects(admin.query(`INSERT INTO agent_paper_private_intakes(
        id,agent_user_id,operator_user_id,request_id,intake_kind,status,canonical_doi,
        security_report,paper_identity_id,paper_version_id
      ) VALUES($1,$2,$3,$4,'doi-metadata','accepted','10.5555/cross-scope','{}',$5,$6)`, [
        crypto.randomUUID(), otherUserId, operatorId, crypto.randomUUID(), upload.paperIdentityId,
        upload.paperVersionId,
      ]), /another agent/u);
      const listed = await service.list(actor, account.agentUserId, 20);
      assert.equal(listed.some(item => item.id === upload.id && item.evidencePreview.length > 0), true);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM blog_articles WHERE author_user_id=$1',
        [account.agentUserId])).rows[0].n, 0);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await admin.end();
    }
  });
