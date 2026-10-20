import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { useI18n } from './I18n.jsx';
import { assertToolDocument, createToolDocument } from './official-tools.mjs';
import {
  KNOWLEDGE_MAP_LIBRARY_VERSION,
  KNOWLEDGE_MAP_MAX_DOCUMENTS,
  KNOWLEDGE_MAP_MAX_MARKDOWN,
  KNOWLEDGE_MAP_MAX_SNAPSHOTS,
  addKnowledgeChild,
  buildKnowledgeMapContext,
  createKnowledgeSnapshot,
  extractKnowledgeBranch,
  normalizeKnowledgeDraft,
  parseKnowledgeOutline,
  removeKnowledgeBranch,
  renameKnowledgeNode,
  restoreKnowledgeSnapshot,
} from './knowledge-map-model.mjs';
import './KnowledgeMapTool.css';

const STORAGE_KEY = 'mooyu.official-tool.knowledge-map.library.v2';
const LEGACY_STORAGE_KEY = 'mooyu.official-tool.knowledge-map.v1';
const GUIDE_STORAGE_KEY = 'mooyu.official-tool.knowledge-map.guide.v1';
const transformer = new Transformer();
const query = new URLSearchParams(globalThis.location?.search || '');
const agentSurface = query.get('gh_host') === 'mcp-app';
const KNOWLEDGE_DRAFT = 'gamehub/knowledge-map.draft';
const KNOWLEDGE_CONTEXT = 'gamehub/knowledge-map.context';
const KNOWLEDGE_REQUEST = 'gamehub/knowledge-map.request-agent';
const KNOWLEDGE_STATUS = 'gamehub/knowledge-map.status';

const templates = {
  learning: `# AI 时代学习体系

## 明确问题
- 我真正想理解什么
- 已知条件
- 需要验证的假设

## 建立知识结构
- 核心概念
  - 定义
  - 例子
  - 反例
- 概念之间的关系

## 主动练习
- 自己解释
- 解决真实问题
- 记录错误

## 复盘
- 哪些已经掌握
- 哪些仍然模糊
- 下一步行动`,
  project: `# 产品上线计划

## 用户与问题
- 目标用户
- 核心场景
- 成功标准

## 产品方案
- 最小可用版本
- 关键体验
- 风险与边界

## 开发
- 前端
- 后端
- 数据与权限

## 发布
- 验收
- 灰度
- 反馈与迭代`,
  research: `# 研究主题

## 研究问题
- 核心问题
- 子问题
- 适用范围

## 证据
- 一手资料
- 数据
- 反方观点

## 分析
- 已确认
- 有争议
- 尚缺证据

## 结论
- 当前判断
- 置信度
- 后续验证`,
};

function createMapDocument(title = 'AI 时代学习体系', markdown = templates.learning) {
  return createToolDocument('knowledge-map', {
    content: { title: String(title).slice(0, 100), markdown: String(markdown).slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN) },
    view: { layout: 'mindmap' },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), snapshots: [] },
  });
}

function validMapDocument(value) {
  const document = assertToolDocument(value, 'knowledge-map');
  if (typeof document.content?.markdown !== 'string' || typeof document.content?.title !== 'string') throw new Error('invalid content');
  const snapshots = Array.isArray(document.metadata?.snapshots) ? document.metadata.snapshots.slice(-KNOWLEDGE_MAP_MAX_SNAPSHOTS).map(snapshot => ({
    id: String(snapshot?.id || `snapshot-${Date.now()}`).slice(0, 120),
    revision: Math.max(0, Math.trunc(Number(snapshot?.revision || 0))),
    title: String(snapshot?.title || '未命名知识图').slice(0, 100),
    markdown: String(snapshot?.markdown || '').slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN),
    createdAt: String(snapshot?.createdAt || new Date().toISOString()).slice(0, 40),
    reason: String(snapshot?.reason || 'imported').slice(0, 40),
  })) : [];
  return { ...document, content: { ...document.content, title: document.content.title.slice(0, 100), markdown: document.content.markdown.slice(0, KNOWLEDGE_MAP_MAX_MARKDOWN) }, metadata: { ...document.metadata, snapshots } };
}

function createInitialLibrary() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) {
      const value = JSON.parse(stored);
      const documents = Array.isArray(value.documents) ? value.documents.map(validMapDocument).slice(0, KNOWLEDGE_MAP_MAX_DOCUMENTS) : [];
      if (value.version === KNOWLEDGE_MAP_LIBRARY_VERSION && documents.length) {
        const activeId = documents.some(item => item.documentId === value.activeId) ? value.activeId : documents[0].documentId;
        return { version: KNOWLEDGE_MAP_LIBRARY_VERSION, activeId, documents };
      }
    }
    const legacy = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const document = validMapDocument(JSON.parse(legacy));
      return { version: KNOWLEDGE_MAP_LIBRARY_VERSION, activeId: document.documentId, documents: [document] };
    }
  } catch { /* Corrupt local data should never prevent the tool from opening. */ }
  const document = createMapDocument();
  return { version: KNOWLEDGE_MAP_LIBRARY_VERSION, activeId: document.documentId, documents: [document] };
}

function safeFileName(value, extension) {
  const stem = String(value || '墨鱼知识图').trim().replace(/[\\/:*?"<>|]+/gu, '-').slice(0, 80) || '墨鱼知识图';
  return `${stem}.${extension}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serialiseSvg(svg) {
  const clone = svg.cloneNode(true);
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(960, Math.round(bounds.width || 0));
  const height = Math.max(640, Math.round(bounds.height || 0));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#fbfaf6');
  clone.insertBefore(background, clone.firstChild);
  return { source: new XMLSerializer().serializeToString(clone), width, height };
}

export default function KnowledgeMapTool() {
  const { t } = useI18n();
  const [library, setLibrary] = useState(createInitialLibrary);
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(true);
  const [canvasMode, setCanvasMode] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => globalThis.localStorage?.getItem(GUIDE_STORAGE_KEY) !== 'hidden');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const svgRef = useRef(null);
  const mapRef = useRef(null);
  const fileRef = useRef(null);

  const toolDocument = library.documents.find(item => item.documentId === library.activeId) ?? library.documents[0];
  const title = toolDocument.content.title;
  const markdown = toolDocument.content.markdown;
  const outline = useMemo(() => parseKnowledgeOutline(markdown), [markdown]);
  const selectedNode = outline.find(item => item.id === selectedNodeId) ?? null;
  const transformed = useMemo(() => {
    try { return { root: transformer.transform(markdown || `# ${title || t('tools.knowledgeMap.untitled')}`).root, error: '' }; }
    catch (caught) { return { root: null, error: caught?.message || t('tools.knowledgeMap.parseError') }; }
  }, [markdown, title, t]);

  const updateActive = useCallback(updater => setLibrary(current => ({
    ...current,
    documents: current.documents.map(document => document.documentId === current.activeId ? updater(document) : document),
  })), []);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(library)); }
    catch { setNotice(t('tools.knowledgeMap.saveFailed')); }
  }, [library, t]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!selectedNodeId || selectedNode) return;
    setSelectedNodeId('');
  }, [selectedNode, selectedNodeId]);

  useEffect(() => {
    if (!svgRef.current || !transformed.root) return undefined;
    if (!mapRef.current) mapRef.current = Markmap.create(svgRef.current, { autoFit: true, duration: 240, maxWidth: 260, paddingX: 12, spacingVertical: 8 }, transformed.root);
    else Promise.resolve(mapRef.current.setData(transformed.root)).then(() => mapRef.current?.fit()).catch(() => {});
    return undefined;
  }, [transformed.root]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const selectRenderedNode = event => {
      const group = event.target?.closest?.('g.markmap-node');
      const data = group?.__data__?.data ?? group?.__data__;
      const startLine = Number.parseInt(String(data?.payload?.lines ?? '').split(',')[0], 10);
      if (Number.isInteger(startLine)) setSelectedNodeId(`line-${startLine}`);
    };
    svg.addEventListener('click', selectRenderedNode);
    return () => svg.removeEventListener('click', selectRenderedNode);
  }, [transformed.root]);

  useEffect(() => () => { mapRef.current?.destroy?.(); mapRef.current = null; }, []);
  useEffect(() => { const timer = setTimeout(() => mapRef.current?.fit?.(), 80); return () => clearTimeout(timer); }, [editorOpen, canvasMode]);

  useEffect(() => {
    if (!agentSurface) return undefined;
    const timer = setTimeout(() => {
      globalThis.parent?.postMessage({ type: KNOWLEDGE_CONTEXT, payload: buildKnowledgeMapContext(toolDocument, selectedNodeId) }, '*');
    }, 650);
    return () => clearTimeout(timer);
  }, [selectedNodeId, toolDocument]);

  useEffect(() => {
    if (!agentSurface) return undefined;
    const onMessage = event => {
      if (event.source !== globalThis.parent) return;
      const message = event.data;
      if (message?.type === KNOWLEDGE_STATUS) {
        if (message.status === 'synced') setNotice(t('tools.knowledgeMap.agentSynced'));
        if (message.status === 'sent') setNotice(t('tools.knowledgeMap.agentRequested'));
        if (message.status === 'failed') setNotice(t('tools.knowledgeMap.agentFailed'));
        return;
      }
      if (message?.type !== KNOWLEDGE_DRAFT) return;
      const draft = normalizeKnowledgeDraft(message.payload);
      if (!draft) return;
      if (draft.mode === 'replace') {
        updateActive(current => {
          const snapshotted = createKnowledgeSnapshot(current, 'before-agent-update');
          return { ...snapshotted, revision: current.revision + 1, content: { ...current.content, title: draft.title, markdown: draft.markdown }, metadata: { ...snapshotted.metadata, updatedAt: new Date().toISOString() } };
        });
      } else {
        if (library.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS) { setNotice(t('tools.knowledgeMap.libraryFull')); return; }
        const document = createMapDocument(draft.title, draft.markdown);
        setLibrary(current => current.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS
          ? current
          : { ...current, activeId: document.documentId, documents: [...current.documents, document] });
      }
      setSelectedNodeId('');
      setNotice(t('tools.knowledgeMap.agentApplied'));
    };
    globalThis.addEventListener('message', onMessage, { passive: true });
    return () => globalThis.removeEventListener('message', onMessage);
  }, [library.documents.length, t, updateActive]);

  const patchContent = patch => updateActive(current => ({
    ...current,
    revision: current.revision + 1,
    content: { ...current.content, ...patch },
    metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
  }));
  const patchMarkdown = nextMarkdown => patchContent({ markdown: nextMarkdown });
  const useTemplate = key => {
    const source = templates[key];
    updateActive(current => {
      const snapshotted = createKnowledgeSnapshot(current, 'before-template');
      return { ...snapshotted, revision: current.revision + 1, content: { ...current.content, title: source.split('\n')[0].replace(/^#\s*/u, ''), markdown: source }, metadata: { ...snapshotted.metadata, updatedAt: new Date().toISOString() } };
    });
    setSelectedNodeId('');
  };
  const createDocument = () => {
    if (library.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS) { setNotice(t('tools.knowledgeMap.libraryFull')); return; }
    const document = createMapDocument(t('tools.knowledgeMap.untitled'), `# ${t('tools.knowledgeMap.untitled')}`);
    setLibrary(current => ({ ...current, activeId: document.documentId, documents: [...current.documents, document] }));
    setSelectedNodeId('');
  };
  const deleteDocument = () => {
    if (library.documents.length === 1) { setNotice(t('tools.knowledgeMap.keepOne')); return; }
    if (!globalThis.confirm?.(t('tools.knowledgeMap.deleteConfirm'))) return;
    setLibrary(current => {
      const documents = current.documents.filter(item => item.documentId !== current.activeId);
      return { ...current, activeId: documents[0].documentId, documents };
    });
    setSelectedNodeId('');
  };
  const saveSnapshot = () => { updateActive(current => createKnowledgeSnapshot(current, 'manual')); setNotice(t('tools.knowledgeMap.snapshotSaved')); };
  const restoreSnapshot = () => {
    if (!snapshotId) return;
    updateActive(current => restoreKnowledgeSnapshot(current, snapshotId));
    setSnapshotId('');
    setSelectedNodeId('');
    setNotice(t('tools.knowledgeMap.snapshotRestored'));
  };
  const exportDocument = () => downloadBlob(new Blob([JSON.stringify(toolDocument, null, 2)], { type: 'application/json;charset=utf-8' }), safeFileName(title, 'mooyu-map.json'));
  const exportSvg = () => {
    if (!svgRef.current) return;
    const { source } = serialiseSvg(svgRef.current);
    downloadBlob(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), safeFileName(title, 'svg'));
  };
  const exportPng = () => {
    if (!svgRef.current) return;
    const { source, width, height } = serialiseSvg(svgRef.current);
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(2, 3000 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fbfaf6'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => { if (blob) downloadBlob(blob, safeFileName(title, 'png')); else setNotice(t('tools.knowledgeMap.exportFailed')); }, 'image/png');
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setNotice(t('tools.knowledgeMap.exportFailed')); };
    image.src = url;
  };
  const importFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (library.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS) { setNotice(t('tools.knowledgeMap.libraryFull')); return; }
    try {
      if (/\.md(?:own)?$/iu.test(file.name)) {
        const text = await file.text();
        const document = createMapDocument(file.name.replace(/\.md(?:own)?$/iu, ''), text);
        setLibrary(current => current.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS ? current : { ...current, activeId: document.documentId, documents: [...current.documents, document] });
      } else {
        const imported = validMapDocument(JSON.parse(await file.text()));
        const document = { ...imported, documentId: globalThis.crypto?.randomUUID?.() ?? `knowledge-map-${Date.now()}`, revision: imported.revision + 1, metadata: { ...imported.metadata, importedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
        setLibrary(current => current.documents.length >= KNOWLEDGE_MAP_MAX_DOCUMENTS ? current : { ...current, activeId: document.documentId, documents: [...current.documents, document] });
      }
      setSelectedNodeId('');
      setNotice(t('tools.knowledgeMap.imported'));
    } catch { setNotice(t('tools.knowledgeMap.importFailed')); }
  };
  const requestAgent = async wholeMap => {
    const branch = wholeMap ? markdown : extractKnowledgeBranch(markdown, selectedNodeId);
    if (!branch) { setNotice(t('tools.knowledgeMap.selectNodeFirst')); return; }
    const instruction = wholeMap ? t('tools.knowledgeMap.agentWholePrompt') : t('tools.knowledgeMap.agentBranchPrompt');
    if (agentSurface) {
      globalThis.parent?.postMessage({
        type: KNOWLEDGE_REQUEST,
        requestId: globalThis.crypto?.randomUUID?.() ?? `knowledge-${Date.now()}`,
        payload: { ...buildKnowledgeMapContext(toolDocument, selectedNodeId), request: { scope: wholeMap ? 'whole' : 'branch', instruction, branch } },
      }, '*');
      setNotice(t('tools.knowledgeMap.agentSending'));
      return;
    }
    try { await navigator.clipboard.writeText(`${instruction}\n\n${branch}`); setNotice(t('tools.knowledgeMap.promptCopied')); }
    catch { setNotice(t('tools.knowledgeMap.copyFailed')); }
  };
  const closeGuide = () => {
    setGuideOpen(false);
    try { globalThis.localStorage?.setItem(GUIDE_STORAGE_KEY, 'hidden'); }
    catch { /* The guide still closes when storage is unavailable. */ }
  };

  return <section className={`knowledge-map-tool ${canvasMode ? 'is-canvas-mode' : ''}`} aria-label={t('tools.knowledgeMap.workspace')}>
    <div className="knowledge-map-toolbar">
      <div className="knowledge-map-toolbar__title"><span aria-hidden="true">◇</span><div><strong>{title || t('tools.knowledgeMap.untitled')}</strong><small>{notice || (agentSurface ? t('tools.knowledgeMap.agentAutoNote') : t('tools.knowledgeMap.localNote'))}</small></div></div>
      <div className="knowledge-map-toolbar__actions">
        <button type="button" aria-expanded={guideOpen && !canvasMode} onClick={() => setGuideOpen(value => !value)}>{t('tools.knowledgeMap.guideOpen')}</button>
        <button type="button" onClick={() => setEditorOpen(value => !value)}>{editorOpen ? t('tools.knowledgeMap.hideEditor') : t('tools.knowledgeMap.showEditor')}</button>
        <button type="button" onClick={() => mapRef.current?.fit?.()}>{t('tools.knowledgeMap.fit')}</button>
        <button type="button" onClick={() => setCanvasMode(value => { const next = !value; if (next) setEditorOpen(false); return next; })}>{canvasMode ? t('tools.knowledgeMap.exitCanvas') : t('tools.knowledgeMap.canvas')}</button>
      </div>
    </div>
    {guideOpen && !canvasMode && <section className="knowledge-map-guide" aria-labelledby="knowledge-map-guide-title">
      <header>
        <div><span>{t('tools.knowledgeMap.guideEyebrow')}</span><h2 id="knowledge-map-guide-title">{t('tools.knowledgeMap.guideTitle')}</h2></div>
        <button type="button" onClick={closeGuide}>{t('tools.knowledgeMap.guideClose')}</button>
      </header>
      <ol>
        <li><span>1</span><div><strong>{t('tools.knowledgeMap.guideStep1Title')}</strong><p>{agentSurface ? t('tools.knowledgeMap.guideStep1Agent') : t('tools.knowledgeMap.guideStep1Browser')}</p></div></li>
        <li><span>2</span><div><strong>{t('tools.knowledgeMap.guideStep2Title')}</strong><p>{t('tools.knowledgeMap.guideStep2Body')}</p></div></li>
        <li><span>3</span><div><strong>{t('tools.knowledgeMap.guideStep3Title')}</strong><p>{agentSurface ? t('tools.knowledgeMap.guideStep3Agent') : t('tools.knowledgeMap.guideStep3Browser')}</p></div></li>
      </ol>
      {agentSurface && <p className="knowledge-map-guide__example"><strong>{t('tools.knowledgeMap.guideExampleTitle')}</strong><span>{t('tools.knowledgeMap.guideExample')}</span></p>}
      <p className="knowledge-map-guide__note">{t('tools.knowledgeMap.guideNote')}</p>
    </section>}
    <div className={`knowledge-map-workspace ${editorOpen ? '' : 'is-editor-hidden'}`}>
      {editorOpen && <aside className="knowledge-map-editor">
        {agentSurface && <div className="knowledge-map-agent-disclosure"><strong>{t('tools.knowledgeMap.agentConnected')}</strong><span>{t('tools.knowledgeMap.agentDisclosure')}</span></div>}
        <div className="knowledge-map-library">
          <label><span>{t('tools.knowledgeMap.documents')}</span><select value={library.activeId} onChange={event => { setLibrary(current => ({ ...current, activeId: event.target.value })); setSelectedNodeId(''); }}>
            {library.documents.map(document => <option key={document.documentId} value={document.documentId}>{document.content.title || t('tools.knowledgeMap.untitled')}</option>)}
          </select></label>
          <div><button type="button" onClick={createDocument}>{t('tools.knowledgeMap.newDocument')}</button><button type="button" onClick={deleteDocument}>{t('tools.knowledgeMap.deleteDocument')}</button></div>
        </div>
        <label><span>{t('tools.knowledgeMap.documentTitle')}</span><input value={title} maxLength={100} onChange={event => patchContent({ title: event.target.value })}/></label>
        <label className="knowledge-map-source"><span>{t('tools.knowledgeMap.markdown')}</span><textarea value={markdown} maxLength={KNOWLEDGE_MAP_MAX_MARKDOWN} spellCheck="false" onChange={event => patchContent({ markdown: event.target.value })}/></label>
        <div className="knowledge-map-outline"><span>{t('tools.knowledgeMap.nodes')}</span><div>{outline.map(node => <button className={node.id === selectedNodeId ? 'is-selected' : ''} style={{ '--node-depth': Math.min(node.depth, 6) }} type="button" key={node.id} onClick={() => setSelectedNodeId(node.id)}>{node.label}</button>)}</div></div>
        {selectedNode && <div className="knowledge-map-node-editor"><strong>{t('tools.knowledgeMap.selectedNode')}</strong><input aria-label={t('tools.knowledgeMap.selectedNode')} value={selectedNode.label} onChange={event => patchMarkdown(renameKnowledgeNode(markdown, selectedNode.id, event.target.value))}/><div><button type="button" onClick={() => patchMarkdown(addKnowledgeChild(markdown, selectedNode.id))}>{t('tools.knowledgeMap.addChild')}</button><button type="button" onClick={() => { patchMarkdown(removeKnowledgeBranch(markdown, selectedNode.id)); setSelectedNodeId(''); }}>{t('tools.knowledgeMap.deleteBranch')}</button></div><button className="is-agent-action" type="button" onClick={() => requestAgent(false)}>{agentSurface ? t('tools.knowledgeMap.askAgentBranch') : t('tools.knowledgeMap.copyBranch')}</button></div>}
        <div className="knowledge-map-templates"><span>{t('tools.knowledgeMap.templates')}</span><div><button type="button" onClick={() => useTemplate('learning')}>{t('tools.knowledgeMap.templateLearning')}</button><button type="button" onClick={() => useTemplate('project')}>{t('tools.knowledgeMap.templateProject')}</button><button type="button" onClick={() => useTemplate('research')}>{t('tools.knowledgeMap.templateResearch')}</button></div></div>
        <div className="knowledge-map-history"><span>{t('tools.knowledgeMap.history')}</span><div><button type="button" onClick={saveSnapshot}>{t('tools.knowledgeMap.saveSnapshot')}</button><select value={snapshotId} onChange={event => setSnapshotId(event.target.value)}><option value="">{t('tools.knowledgeMap.chooseSnapshot')}</option>{[...(toolDocument.metadata.snapshots || [])].reverse().map(snapshot => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.title}</option>)}</select><button type="button" disabled={!snapshotId} onClick={restoreSnapshot}>{t('tools.knowledgeMap.restoreSnapshot')}</button></div></div>
        <div className="knowledge-map-agent"><strong>{t('tools.knowledgeMap.agentTitle')}</strong><p>{agentSurface ? t('tools.knowledgeMap.agentLiveLead') : t('tools.knowledgeMap.agentLead')}</p><button type="button" onClick={() => requestAgent(true)}>{agentSurface ? t('tools.knowledgeMap.askAgentWhole') : t('tools.knowledgeMap.copyAgent')}</button></div>
      </aside>}
      <div className="knowledge-map-canvas">
        <div className="knowledge-map-canvas__actions">
          <input ref={fileRef} hidden type="file" accept=".json,.md,.markdown,application/json,text/markdown" onChange={importFile}/>
          <button type="button" onClick={() => fileRef.current?.click()}>{t('tools.knowledgeMap.import')}</button>
          <button type="button" onClick={exportDocument}>{t('tools.knowledgeMap.exportDocument')}</button>
          <button type="button" onClick={exportSvg}>SVG</button>
          <button type="button" onClick={exportPng}>PNG</button>
        </div>
        {transformed.error ? <div className="knowledge-map-error" role="alert"><strong>{t('tools.knowledgeMap.parseError')}</strong><p>{transformed.error}</p></div> : <svg ref={svgRef} className="knowledge-map-svg" aria-label={t('tools.knowledgeMap.canvasLabel')}/>}
        <small className="knowledge-map-hint">{t('tools.knowledgeMap.hint')}</small>
      </div>
    </div>
  </section>;
}
