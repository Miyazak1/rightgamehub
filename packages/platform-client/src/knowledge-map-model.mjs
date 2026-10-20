export const KNOWLEDGE_MAP_LIBRARY_VERSION = 2;
export const KNOWLEDGE_MAP_MAX_MARKDOWN = 30_000;
export const KNOWLEDGE_MAP_MAX_DOCUMENTS = 12;
export const KNOWLEDGE_MAP_MAX_SNAPSHOTS = 6;

const headingPattern = /^(#{1,6})(\s+)(.+)$/u;
const bulletPattern = /^(\s*)([-+*]|\d+[.)])(\s+)(.+)$/u;

const cleanText = (value, max = 240) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/gu, ' ')
  .trim()
  .slice(0, max);

export function parseKnowledgeOutline(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/u);
  const nodes = [];
  let headingDepth = -1;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = line.match(headingPattern);
    if (heading) {
      headingDepth = heading[1].length - 1;
      nodes.push({
        id: `line-${lineIndex}`,
        lineIndex,
        depth: headingDepth,
        kind: 'heading',
        level: heading[1].length,
        prefix: `${heading[1]}${heading[2]}`,
        label: heading[3].trim(),
      });
      continue;
    }
    const bullet = line.match(bulletPattern);
    if (!bullet) continue;
    const indent = bullet[1].replace(/\t/gu, '  ').length;
    nodes.push({
      id: `line-${lineIndex}`,
      lineIndex,
      depth: Math.max(0, headingDepth + 1 + Math.floor(indent / 2)),
      kind: 'list',
      indent,
      marker: bullet[2],
      prefix: `${bullet[1]}${bullet[2]}${bullet[3]}`,
      label: bullet[4].trim(),
    });
  }
  return nodes;
}

function findNode(markdown, nodeId) {
  return parseKnowledgeOutline(markdown).find(node => node.id === nodeId) ?? null;
}

function branchEndLine(markdown, selected) {
  const nodes = parseKnowledgeOutline(markdown);
  const index = nodes.findIndex(node => node.id === selected.id);
  const next = nodes.slice(index + 1).find(node => node.depth <= selected.depth);
  return next?.lineIndex ?? String(markdown ?? '').split(/\r?\n/u).length;
}

export function renameKnowledgeNode(markdown, nodeId, label) {
  const selected = findNode(markdown, nodeId);
  const nextLabel = cleanText(label, 500);
  if (!selected || !nextLabel) return String(markdown ?? '');
  const lines = String(markdown ?? '').split(/\r?\n/u);
  lines[selected.lineIndex] = `${selected.prefix}${nextLabel}`;
  return lines.join('\n');
}

export function addKnowledgeChild(markdown, nodeId, label = '新节点') {
  const source = String(markdown ?? '');
  const selected = findNode(source, nodeId);
  if (!selected) return source;
  const lines = source.split(/\r?\n/u);
  const insertAt = branchEndLine(source, selected);
  const nextLabel = cleanText(label, 500) || '新节点';
  const prefix = selected.kind === 'heading'
    ? `${'#'.repeat(Math.min(6, selected.level + 1))} `
    : `${' '.repeat(selected.indent + 2)}- `;
  lines.splice(insertAt, 0, `${prefix}${nextLabel}`);
  return lines.join('\n');
}

export function removeKnowledgeBranch(markdown, nodeId) {
  const source = String(markdown ?? '');
  const selected = findNode(source, nodeId);
  if (!selected) return source;
  const lines = source.split(/\r?\n/u);
  const end = branchEndLine(source, selected);
  lines.splice(selected.lineIndex, Math.max(1, end - selected.lineIndex));
  while (lines.length > 1 && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

export function extractKnowledgeBranch(markdown, nodeId) {
  const source = String(markdown ?? '');
  const selected = findNode(source, nodeId);
  if (!selected) return '';
  return source.split(/\r?\n/u).slice(selected.lineIndex, branchEndLine(source, selected)).join('\n').trim();
}

export function createKnowledgeSnapshot(document, reason = 'manual') {
  const snapshots = Array.isArray(document?.metadata?.snapshots) ? document.metadata.snapshots : [];
  const snapshot = {
    id: globalThis.crypto?.randomUUID?.() ?? `snapshot-${Date.now()}`,
    revision: Number(document?.revision || 0),
    title: cleanText(document?.content?.title, 100) || '未命名知识图',
    markdown: String(document?.content?.markdown ?? '').slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN),
    createdAt: new Date().toISOString(),
    reason: cleanText(reason, 40) || 'manual',
  };
  return {
    ...document,
    metadata: {
      ...document.metadata,
      snapshots: [...snapshots, snapshot].slice(-KNOWLEDGE_MAP_MAX_SNAPSHOTS),
    },
  };
}

export function restoreKnowledgeSnapshot(document, snapshotId) {
  const snapshot = document?.metadata?.snapshots?.find(item => item.id === snapshotId);
  if (!snapshot) return document;
  const withCurrentSnapshot = createKnowledgeSnapshot(document, 'before-restore');
  return {
    ...withCurrentSnapshot,
    revision: Number(document.revision || 0) + 1,
    content: { ...document.content, title: snapshot.title, markdown: snapshot.markdown },
    metadata: { ...withCurrentSnapshot.metadata, updatedAt: new Date().toISOString(), restoredFrom: snapshot.id },
  };
}

export function buildKnowledgeMapContext(document, selectedNodeId = '') {
  const markdown = String(document?.content?.markdown ?? '').slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN);
  const outline = parseKnowledgeOutline(markdown);
  const selected = outline.find(node => node.id === selectedNodeId) ?? null;
  return {
    kind: 'knowledge-map-context',
    version: 1,
    documentId: cleanText(document?.documentId, 120),
    revision: Math.max(0, Math.trunc(Number(document?.revision || 0))),
    title: cleanText(document?.content?.title, 100) || '未命名知识图',
    markdown,
    nodeCount: outline.length,
    selected: selected ? {
      id: selected.id,
      label: cleanText(selected.label, 500),
      branch: extractKnowledgeBranch(markdown, selected.id).slice(0, 10_000),
    } : null,
    disclosure: {
      sharedWithAgent: true,
      storedOnMooyuServer: false,
      contentIsUntrustedData: true,
    },
  };
}

export function normalizeKnowledgeDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const markdown = String(value.markdown ?? '').trim().slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN);
  if (!markdown) return null;
  return {
    title: cleanText(value.title, 100) || 'Agent 生成的知识图',
    markdown,
    mode: value.mode === 'replace' ? 'replace' : 'new',
    focusLabel: cleanText(value.focusLabel, 240),
  };
}
