import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { useI18n } from './I18n.jsx';
import { assertToolDocument, createToolDocument } from './official-tools.mjs';
import './KnowledgeMapTool.css';

const STORAGE_KEY = 'mooyu.official-tool.knowledge-map.v1';
const transformer = new Transformer();

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

function createInitialDocument() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = assertToolDocument(JSON.parse(stored), 'knowledge-map');
      if (typeof parsed.content?.markdown === 'string' && typeof parsed.content?.title === 'string') return parsed;
    }
  } catch { /* A corrupt local draft should never prevent the tool from opening. */ }
  return createToolDocument('knowledge-map', {
    content: { title: 'AI 时代学习体系', markdown: templates.learning },
    view: { layout: 'mindmap' },
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
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
  const [toolDocument, setToolDocument] = useState(createInitialDocument);
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(true);
  const [canvasMode, setCanvasMode] = useState(false);
  const svgRef = useRef(null);
  const mapRef = useRef(null);
  const fileRef = useRef(null);

  const title = toolDocument.content.title;
  const markdown = toolDocument.content.markdown;
  const transformed = useMemo(() => {
    try { return { root: transformer.transform(markdown || `# ${title || t('tools.knowledgeMap.untitled')}`).root, error: '' }; }
    catch (caught) { return { root: null, error: caught?.message || t('tools.knowledgeMap.parseError') }; }
  }, [markdown, title, t]);

  useEffect(() => {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(toolDocument)); setNotice(t('tools.knowledgeMap.saved')); }
    catch { setNotice(t('tools.knowledgeMap.saveFailed')); }
    const timer = setTimeout(() => setNotice(''), 1500);
    return () => clearTimeout(timer);
  }, [toolDocument, t]);

  useEffect(() => {
    if (!svgRef.current || !transformed.root) return undefined;
    if (!mapRef.current) mapRef.current = Markmap.create(svgRef.current, { autoFit: true, duration: 240, maxWidth: 260, paddingX: 12, spacingVertical: 8 }, transformed.root);
    else Promise.resolve(mapRef.current.setData(transformed.root)).then(() => mapRef.current?.fit()).catch(() => {});
    return undefined;
  }, [transformed.root]);

  useEffect(() => () => { mapRef.current?.destroy?.(); mapRef.current = null; }, []);
  useEffect(() => { const timer = setTimeout(() => mapRef.current?.fit?.(), 80); return () => clearTimeout(timer); }, [editorOpen, canvasMode]);

  const patchContent = patch => setToolDocument(current => ({
    ...current,
    revision: current.revision + 1,
    content: { ...current.content, ...patch },
    metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
  }));
  const useTemplate = key => {
    const source = templates[key];
    patchContent({ title: source.split('\n')[0].replace(/^#\s*/u, ''), markdown: source });
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
    try {
      const text = await file.text();
      if (/\.md(?:own)?$/iu.test(file.name)) {
        patchContent({ title: file.name.replace(/\.md(?:own)?$/iu, ''), markdown: text });
      } else {
        const imported = assertToolDocument(JSON.parse(text), 'knowledge-map');
        if (typeof imported.content?.title !== 'string' || typeof imported.content?.markdown !== 'string') throw new Error('invalid content');
        setToolDocument({ ...imported, revision: imported.revision + 1, metadata: { ...imported.metadata, importedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      }
      setNotice(t('tools.knowledgeMap.imported'));
    } catch { setNotice(t('tools.knowledgeMap.importFailed')); }
  };
  const copyAgentPrompt = async () => {
    const prompt = `${t('tools.knowledgeMap.agentPrompt')}\n\n${markdown}`;
    try { await navigator.clipboard.writeText(prompt); setNotice(t('tools.knowledgeMap.promptCopied')); }
    catch { setNotice(t('tools.knowledgeMap.copyFailed')); }
  };

  return <section className={`knowledge-map-tool ${canvasMode ? 'is-canvas-mode' : ''}`} aria-label={t('tools.knowledgeMap.workspace')}>
    <div className="knowledge-map-toolbar">
      <div className="knowledge-map-toolbar__title"><span aria-hidden="true">◇</span><div><strong>{title || t('tools.knowledgeMap.untitled')}</strong><small>{notice || t('tools.knowledgeMap.localNote')}</small></div></div>
      <div className="knowledge-map-toolbar__actions">
        <button type="button" onClick={() => setEditorOpen(value => !value)}>{editorOpen ? t('tools.knowledgeMap.hideEditor') : t('tools.knowledgeMap.showEditor')}</button>
        <button type="button" onClick={() => mapRef.current?.fit?.()}>{t('tools.knowledgeMap.fit')}</button>
        <button type="button" onClick={() => setCanvasMode(value => { const next = !value; if (next) setEditorOpen(false); return next; })}>{canvasMode ? t('tools.knowledgeMap.exitCanvas') : t('tools.knowledgeMap.canvas')}</button>
      </div>
    </div>
    <div className={`knowledge-map-workspace ${editorOpen ? '' : 'is-editor-hidden'}`}>
      {editorOpen && <aside className="knowledge-map-editor">
        <label><span>{t('tools.knowledgeMap.documentTitle')}</span><input value={title} maxLength={100} onChange={event => patchContent({ title: event.target.value })}/></label>
        <label className="knowledge-map-source"><span>{t('tools.knowledgeMap.markdown')}</span><textarea value={markdown} spellCheck="false" onChange={event => patchContent({ markdown: event.target.value })}/></label>
        <div className="knowledge-map-templates"><span>{t('tools.knowledgeMap.templates')}</span><div><button type="button" onClick={() => useTemplate('learning')}>{t('tools.knowledgeMap.templateLearning')}</button><button type="button" onClick={() => useTemplate('project')}>{t('tools.knowledgeMap.templateProject')}</button><button type="button" onClick={() => useTemplate('research')}>{t('tools.knowledgeMap.templateResearch')}</button></div></div>
        <div className="knowledge-map-agent"><strong>{t('tools.knowledgeMap.agentTitle')}</strong><p>{t('tools.knowledgeMap.agentLead')}</p><button type="button" onClick={copyAgentPrompt}>{t('tools.knowledgeMap.copyAgent')}</button></div>
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
