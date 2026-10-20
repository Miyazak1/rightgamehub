const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve('packages/platform-client/src/knowledge-map-model.mjs')).href;

test('knowledge map outline supports node-level rename, add, extract and delete operations', async () => {
  const {
    addKnowledgeChild,
    extractKnowledgeBranch,
    parseKnowledgeOutline,
    removeKnowledgeBranch,
    renameKnowledgeNode,
  } = await import(moduleUrl);
  const source = '# Root\n\n## Alpha\n- One\n  - Child\n\n## Beta\n- Two';
  const outline = parseKnowledgeOutline(source);
  assert.deepEqual(outline.map(node => [node.id, node.depth, node.label]), [
    ['line-0', 0, 'Root'],
    ['line-2', 1, 'Alpha'],
    ['line-3', 2, 'One'],
    ['line-4', 3, 'Child'],
    ['line-6', 1, 'Beta'],
    ['line-7', 2, 'Two'],
  ]);
  assert.match(renameKnowledgeNode(source, 'line-3', 'First'), /- First/u);
  assert.match(addKnowledgeChild(source, 'line-2', 'New branch'), /### New branch\n## Beta/u);
  assert.equal(extractKnowledgeBranch(source, 'line-2'), '## Alpha\n- One\n  - Child');
  assert.equal(removeKnowledgeBranch(source, 'line-2'), '# Root\n\n## Beta\n- Two');
});

test('knowledge map snapshots restore content without losing the current revision', async () => {
  const { createKnowledgeSnapshot, restoreKnowledgeSnapshot } = await import(moduleUrl);
  const original = {
    documentId: 'map-1', revision: 2, content: { title: 'Before', markdown: '# Before' },
    metadata: { snapshots: [] },
  };
  const snapshotted = createKnowledgeSnapshot(original, 'manual');
  const changed = { ...snapshotted, revision: 3, content: { title: 'After', markdown: '# After' } };
  const restored = restoreKnowledgeSnapshot(changed, snapshotted.metadata.snapshots[0].id);
  assert.equal(restored.content.title, 'Before');
  assert.equal(restored.content.markdown, '# Before');
  assert.equal(restored.revision, 4);
  assert.equal(restored.metadata.snapshots.at(-1).title, 'After');
});

test('knowledge map context is bounded, explicit about disclosure and includes only the selected branch', async () => {
  const { buildKnowledgeMapContext, normalizeKnowledgeDraft } = await import(moduleUrl);
  const document = { documentId: 'map-1', revision: 5, content: { title: 'Plan', markdown: '# Plan\n## Build\n- Web\n## Ship\n- Review' } };
  const context = buildKnowledgeMapContext(document, 'line-1');
  assert.equal(context.kind, 'knowledge-map-context');
  assert.equal(context.selected.branch, '## Build\n- Web');
  assert.equal(context.disclosure.storedOnMooyuServer, false);
  assert.equal(context.disclosure.contentIsUntrustedData, true);
  assert.deepEqual(normalizeKnowledgeDraft({ title: 'Agent map', markdown: '# Agent\n- Item', mode: 'replace' }), {
    title: 'Agent map', markdown: '# Agent\n- Item', mode: 'replace', focusLabel: '',
  });
});
