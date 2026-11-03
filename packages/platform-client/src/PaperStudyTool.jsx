import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useI18n } from './I18n.jsx';
import './PaperStudyTool.css';

pdfjs.GlobalWorkerOptions.workerSrc = worker;
const busy = value => ['importing', 'analyzing', 'drafting'].includes(value?.status);
const encode = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); };
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export default function PaperStudyTool(props) {
  // Account changes remount the private workspace: pending requests, PDF handles,
  // selected files, excerpts and drafts cannot carry over to another session.
  return <PaperStudyWorkspace key={props.accountProfile?.id ?? 'anonymous'} {...props}/>;
}
function PaperStudyWorkspace({ api, accountProfile, go }) {
  const { locale } = useI18n(), en = locale === 'en', tr = (zh, english) => en ? english : zh;
  const [library, setLibrary] = useState([]), [paper, setPaper] = useState(null), [tab, setTab] = useState('original');
  const [page, setPage] = useState(1), [evidenceId, setEvidenceId] = useState(null), [pdf, setPdf] = useState(null);
  const [file, setFile] = useState(null), [title, setTitle] = useState(''), [rights, setRights] = useState(false), [arxivId, setArxivId] = useState(''), [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const canvas = useRef(), generation = useRef(0), request = useRef(null);
  const labels = { importing: tr('正在解析 PDF', 'Parsing PDF'), imported: tr('可开始分析', 'Ready to analyze'), analyzing: tr('分析与证据校验中', 'Checking analysis and evidence'), analyzed: tr('分析已完成', 'Analysis ready'), drafting: tr('生成并核验草稿', 'Generating and verifying draft'), 'draft-ready': tr('私有待审稿已保存', 'Private draft saved'), failed: tr('处理失败，未绕过门禁', 'Stopped at quality gate') };
  const friendly = caught => caught.status === 401 ? tr('请先登录后使用论文研读。', 'Sign in to use paper study.')
    : caught.code === 'PAPER_STUDY_REPLAY_SOURCE_MISMATCH' ? tr('隔离回放只接受已验证的样本 PDF，未对其他文件伪造分析。', 'Replay only accepts the verified sample PDF.')
    : tr('操作未完成。请检查文件或服务状态后重试。', 'Operation failed. Check the file or service and retry.');
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    generation.current++; request.current?.abort(); setPaper(null); setLibrary([]); setError(''); setLoading(true);
    if (!accountProfile) { setLoading(false); return () => { live = false; controller.abort(); }; }
    api.listPaperStudies({ signal: controller.signal }).then(r => { if (live) setLibrary(r.data); }).catch(e => { if (live && e.name !== 'AbortError') setError(friendly(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; generation.current++; controller.abort(); request.current?.abort(); };
  }, [accountProfile?.id, api]);
  const select = async id => {
    const version = ++generation.current; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setError(''); setPaper(null); setPdf(null); setPage(1); setEvidenceId(null); setTab('original');
    try {
      const result = await api.getPaperStudy(id, { signal: controller.signal });
      if (version !== generation.current) return;
      setPaper(result.data);
      const source = await api.getPaperStudySource(id, { signal: controller.signal });
      const document = await pdfjs.getDocument({ data: decode(source.data.pdfBase64), isEvalSupported: false }).promise;
      if (version !== generation.current) { document.destroy(); return; } setPdf(document);
    } catch (e) { if (version === generation.current && e.name !== 'AbortError') setError(friendly(e)); }
  };
  useEffect(() => () => { pdf?.destroy(); }, [pdf]);
  useEffect(() => {
    if (!pdf || !canvas.current || tab !== 'original') return;
    let live = true, render;
    pdf.getPage(page).then(p => {
      if (!live || !canvas.current) return;
      const viewport = p.getViewport({ scale: Math.min(1.25, (canvas.current.parentElement.clientWidth - 20) / p.getViewport({ scale: 1 }).width) * zoom });
      const element = canvas.current; element.width = viewport.width; element.height = viewport.height;
      render = p.render({ canvasContext: element.getContext('2d'), viewport }); return render.promise;
    }).catch(e => { if (live && e.name !== 'RenderingCancelledException') setError(tr('原文页面渲染失败，可以查看提取文本。', 'Page render failed. Extracted text remains available.')); });
    return () => { live = false; render?.cancel(); };
  }, [pdf, page, tab, zoom]);
  useEffect(() => {
    if (!busy(paper)) return;
    let live = true; const controller = new AbortController();
    const timer = setTimeout(() => api.getPaperStudy(paper.id, { signal: controller.signal }).then(r => {
      if (!live) return; setPaper(r.data); setLibrary(rows => rows.map(x => x.id === r.data.id ? r.data : x));
    }).catch(e => { if (live && e.name !== 'AbortError') setError(friendly(e)); }), 600);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [paper, api]);
  const importPdf = async event => {
    event.preventDefault(); if (!file || pending) return;
    if (file.size > 20 * 1024 * 1024) { setError(tr('PDF 最大 20 MiB。', 'PDF limit: 20 MiB.')); return; }
    const version = generation.current; setPending(true); setError('');
    try {
      const result = await api.importPaperStudy({ filename: file.name, title: title.trim(), rightsConfirmed: rights, ...(arxivId.trim() ? { arxivId: arxivId.trim() } : {}), pdfBase64: encode(new Uint8Array(await file.arrayBuffer())) });
      if (version !== generation.current) return;
      setLibrary(rows => [result.data, ...rows.filter(x => x.id !== result.data.id)]); await select(result.data.id);
    } catch (e) { if (version === generation.current) setError(friendly(e)); } finally { setPending(false); }
  };
  const action = async method => {
    const version = generation.current; setPending(true); setError('');
    try { const result = await api[method](paper.id); if (version === generation.current) { setPaper(result.data); setTab(method === 'analyzePaperStudy' ? 'analysis' : 'draft'); } }
    catch (e) { if (version === generation.current) setError(friendly(e)); } finally { setPending(false); }
  };
  const evidence = paper?.analysis?.evidence ?? [], chosen = evidence.find(e => e.id === evidenceId);
  const inspect = id => { const item = evidence.find(e => e.id === id); if (item) { setEvidenceId(id); setPage(item.locator.pages[0]); setTab('original'); } };
  const citationButtons = ids => ids.map(id => { const e = evidence.find(x => x.id === id); return e && <button type="button" className="paper-study__citation" key={id} onClick={() => inspect(id)}>{tr('原文', 'Source')} · {e.locator.pages.join(', ')}</button>; });
  if (!accountProfile) return <section className="panel paper-study"><h2>{tr('用你的账号管理私有论文', 'Your private paper workspace')}</h2><p>{tr('登录后导入论文、核对证据并生成待审草稿。', 'Sign in to import papers, inspect evidence and prepare drafts.')}</p><button className="button button--primary" onClick={() => go('/account')}>{tr('前往登录', 'Sign in')}</button></section>;
  return <section className="paper-study" aria-label={tr('论文研读工作区', 'Paper study workspace')}>
    <div className="paper-study__notice">{tr('私有研究 · 草稿须人工审阅 · 不自动发布', 'Private research · Human review required · Never auto-published')}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="paper-study__layout">
      <aside className="panel paper-study__library"><h2>{tr('我的论文', 'My papers')}</h2>
        <form onSubmit={importPdf}><label>{tr('论文 PDF', 'Paper PDF')}<input data-paper-file type="file" accept=".pdf,application/pdf" required disabled={pending} onChange={e => { const f = e.target.files?.[0]; setFile(f ?? null); if (f) setTitle(f.name.replace(/\.pdf$/i, '')); }}/></label>
          <label>{tr('标题', 'Title')}<input value={title} maxLength={300} required onChange={e => setTitle(e.target.value)}/></label>
          <label>arXiv ID {tr('（可选）', '(optional)')}<input value={arxivId} maxLength={32} placeholder="1706.03762v7" onChange={e => setArxivId(e.target.value)}/><small>{tr('真实模型分析前，服务会核对该公开来源与 PDF 哈希；其他文件仅供阅读。', 'Before model analysis, the service verifies this public source and PDF hash. Other files remain readable.')}</small></label><label className="paper-study__check"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)}/>{tr('我有权使用该 PDF，并同意将其导入当前私有研究服务。', 'I may use this PDF and agree to import it into this private research service.')}</label>
          <button className="button button--primary" disabled={!file || !rights || pending}>{pending ? tr('处理中…', 'Working…') : tr('导入论文', 'Import paper')}</button><small>20 MiB / 80 {tr('页', 'pages')}</small></form>
        {loading ? <p role="status">{tr('正在加载…', 'Loading…')}</p> : !library.length && <p>{tr('尚未导入论文。', 'No papers yet.')}</p>}
        <nav aria-label={tr('论文列表', 'Paper library')}>{library.map(row => <button key={row.id} type="button" aria-current={paper?.id === row.id ? 'true' : undefined} onClick={() => select(row.id)}><strong>{row.title}</strong><small>{labels[row.status] ?? row.status}</small></button>)}</nav>
      </aside>
      <section className="panel paper-study__work">
        {!paper ? <div className="paper-study__empty"><h2>{tr('从一篇论文开始', 'Start with a paper')}</h2><p>{tr('导入后阅读原文，逐条核对研究结论与证据，再整理私有草稿。', 'Read the original, inspect each finding and its evidence, then prepare a private draft.')}</p></div> : <>
          <header><h2>{paper.title}</h2><p role="status">{labels[paper.status] ?? paper.status}{paper.mode === 'isolated-live' && ` · ${tr('本地隔离模型分析 · 仅发送已核对的公开正文', 'Local model analysis · verified public prose only')}`}{paper.mode === 'isolated-replay' && ` · ${tr('本地隔离回放 · 未调用模型 · 数据仅在测试服务存活期间保留', 'Isolated replay · No model calls · Ephemeral test storage')}`}</p>
            {paper.modelCallsEnabled === false && <p>{tr('模型分析暂未启用，可以先导入并阅读原文。', 'Model analysis is not enabled. Import and read the original first.')}</p>}
            {paper.errorCode && <p className="form-error" role="alert">{paper.errorCode === 'PAPER_STUDY_REPLAY_SOURCE_MISMATCH' ? friendly({code:paper.errorCode}) : `${tr('处理未通过，未保存未验证结果', 'Quality gate stopped processing')}: ${paper.errorCode}`}</p>}
            <div className="paper-study__actions"><button className="button button--secondary" disabled={paper.modelCallsEnabled === false || !paper.pageCount || !!paper.analysis || busy(paper) || pending} onClick={() => action('analyzePaperStudy')}>{tr('分析论文', 'Analyze paper')}</button><button className="button button--primary" disabled={paper.modelCallsEnabled === false || !paper.analysis || !!paper.draft || busy(paper) || pending} onClick={() => action('generatePaperStudyDraft')}>{tr('生成私有待审稿', 'Generate private draft')}</button></div>
          </header>
          <div className="paper-study__tabs" role="tablist" aria-label={tr('阅读视图', 'Reading views')}>{[['original', tr('原文', 'Original')], ['analysis', tr('分析', 'Analysis')], ['draft', tr('待审稿', 'Draft')]].map(([id, label]) => <button key={id} role="tab" id={`paper-tab-${id}`} aria-selected={tab === id} aria-controls="paper-study-panel" onClick={() => setTab(id)}>{label}</button>)}</div>
          <div id="paper-study-panel" role="tabpanel" aria-labelledby={`paper-tab-${tab}`}>
            {tab === 'original' && <><div className="paper-study__pages"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{tr('上一页', 'Previous')}</button><span>{page} / {paper.pageCount || '—'}</span><button aria-label={tr('缩小原文', 'Zoom out')} disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .25))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label={tr('放大原文', 'Zoom in')} disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .25))}>＋</button><button disabled={page >= paper.pageCount} onClick={() => setPage(p => p + 1)}>{tr('下一页', 'Next')}</button></div><div className="paper-study__canvas"><canvas ref={canvas} aria-label={tr(`原文第 ${page} 页`, `Original page ${page}`)}/></div><details><summary>{tr('本页提取文本', 'Extracted page text')}</summary><p className="paper-study__text">{paper.pages.find(p => p.page === page)?.text}</p></details></>}
            {tab === 'analysis' && (paper.analysis ? <>{paper.analysis.findings.map(f => <article className="paper-study__finding" key={f.key}><small>{tr('作者主张 · 仅限所引正文', 'Author claim · cited text only')}</small><p>{f.text}</p>{citationButtons([...new Set((f.relations ?? []).filter(r => r.relation === 'supports').map(r => r.evidenceId))])}</article>)}</> : <p>{tr('尚无通过校验的分析。', 'No validated analysis yet.')}</p>)}
            {tab === 'draft' && (paper.draft ? <article className="paper-study__draft"><h2>{paper.draft.content.title}</h2><p>{paper.draft.content.summary}</p>{paper.draft.content.blocks.map((b, i) => <section key={i}>{b.type === 'heading' ? <h3>{b.text}</h3> : b.type === 'list' ? <ul>{b.items.map((x, n) => <li key={n}>{x}</li>)}</ul> : <p>{b.text}</p>}{citationButtons(paper.draft.paragraphEvidenceBindings.find(x => x.blockIndex === i - 1)?.evidence.map(e => e.id) ?? [])}</section>)}<small>{tr('私有待审稿 · 发布权限关闭', 'Private draft · Publication disabled')}</small></article> : <p>{tr('分析通过后可生成私有待审稿。', 'Generate a private draft after analysis passes.')}</p>)}
          </div>
        </>}
      </section>
      <aside className="panel paper-study__evidence"><span className="kicker">EVIDENCE</span><h2>{tr('原文依据', 'Source evidence')}</h2><p>{paper?.analysis?.notice ?? tr('复杂表格、公式和图示未核验时，研究与草稿仅使用可靠正文，不确认数值、效果比较或推导。', 'When tables, formulas or figures cannot be verified, analysis and drafts use reliable prose only.')}</p>
        {chosen ? <article><h3>{tr('第', 'Page')} {chosen.locator.pages.join(', ')} {tr('页', '')}</h3><blockquote>{chosen.quoteText}</blockquote><button className="button button--secondary" onClick={() => inspect(chosen.id)}>{tr('定位原文', 'View original')}</button></article> : <p>{tr('点击分析或草稿中的原文按钮，在此核对引用并跳转页面。', 'Choose a source link in analysis or draft to inspect its quote and page.')}</p>}
      </aside>
    </div>
  </section>;
}
