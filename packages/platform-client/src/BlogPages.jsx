import React, { useEffect, useMemo, useState } from 'react';
import AgentDisclosure from './AgentDisclosure.jsx';
import AvatarView from './AvatarView.jsx';

const emptyDraft = () => ({ slug: '', locale: 'zh-CN', title: '', summary: '', blocks: [{ type: 'paragraph', text: '' }], citations: [] });
const formatDate = value => value ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;

function CitationMarks({ ids = [], citations = [] }) {
  const found = ids.map(id => citations.find(item => item.id === id)).filter(Boolean);
  return found.length ? <span className="blog-citation-marks" aria-label="本段引用来源">{found.map(citation => <a key={citation.id} href={`#source-${citation.id}`} title={citation.title}>[{citations.findIndex(item => item.id === citation.id) + 1}]</a>)}</span> : null;
}

function BlogBlock({ block, citations = [], headingId = null }) {
  if (block.type === 'heading') return block.level === 3 ? <h3 id={headingId}>{block.text}</h3> : <h2 id={headingId}>{block.text}</h2>;
  if (block.type === 'quote') return <blockquote><p>{block.text}</p>{block.citationIds?.length > 0 && <cite>{block.citationIds.map(id => { const citation = citations.find(item => item.id === id); return citation ? <a key={id} href={`#source-${id}`}>{citation.label}</a> : null; })}</cite>}</blockquote>;
  if (block.type === 'list') { const Tag = block.ordered ? 'ol' : 'ul'; return <div className="blog-list-block"><Tag>{block.items.map((item, index) => <li key={index}>{item}</li>)}</Tag><CitationMarks ids={block.citationIds} citations={citations}/></div>; }
  if (block.type === 'code') return <pre><code data-language={block.language}>{block.text}</code></pre>;
  return <p>{block.text}<CitationMarks ids={block.citationIds} citations={citations}/></p>;
}

const githubRepository = citation => {
  try {
    const url = new URL(citation.repositoryUrl || citation.url), parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || parts.length < 2) return null;
    return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/iu, '')}`;
  } catch { return null; }
};
const repositoryName = citation => {
  const url = githubRepository(citation);
  return url ? new URL(url).pathname.slice(1) : citation.publisher;
};
const readMinutes = blocks => Math.max(1, Math.ceil(blocks.reduce((sum, block) => sum + (block.text?.length || block.items?.join('').length || 0), 0) / 500));

function FollowUpPanel({ article, questions, api, go }) {
  const items = questions.length ? questions : [`这篇《${article.title}》最值得先验证的结论是什么？`, '这些项目分别适合什么样的使用者？', '如果要亲自尝试，应该从哪一步开始？'];
  const [question, setQuestion] = useState(''), [answers, setAnswers] = useState([]), [busy, setBusy] = useState(false), [busyStage, setBusyStage] = useState(''), [message, setMessage] = useState(''), [retry, setRetry] = useState(null);
  useEffect(() => {
    if (!busy) { setBusyStage(''); return undefined; }
    setBusyStage('正在查阅本文与已验证来源');
    const timer = globalThis.setTimeout(() => setBusyStage('正在整理有依据的回答'), 1800);
    return () => globalThis.clearTimeout(timer);
  }, [busy]);
  const submit = async event => {
    event?.preventDefault?.();
    const value = question.replace(/\s+/gu, ' ').trim();
    if (value.length < 2 || busy) return;
    setBusy(true); setMessage('');
    const parentQuestionId = answers.at(-1)?.id ?? null;
    const signature = `${parentQuestionId ?? 'root'}\0${value}`;
    const requestKey = retry?.signature === signature ? retry.key : randomId();
    setRetry({ signature, key: requestKey });
    try {
      const { data } = await api.askBlogQuestion(article.slug, { question: value, parentQuestionId }, { headers: { 'Idempotency-Key': requestKey } });
      setAnswers(current => [...current, data]); setQuestion(''); setRetry(null);
    } catch (error) {
      if (!['REQUEST_TIMEOUT', 'NETWORK_ERROR', 'BLOG_FOLLOW_UP_RESULT_UNKNOWN'].includes(error.code)) setRetry(null);
      setMessage(error.status === 401 ? '登录后即可直接向文章作者机器人追问。' : error.message || '暂时无法回答，请稍后再试。');
    } finally { setBusy(false); }
  };
  return <aside className="blog-followups" aria-labelledby="blog-followups-title" aria-busy={busy}><span className="kicker">FOLLOW UP</span><h2 id="blog-followups-title">继续追问</h2><p>在这里直接询问文章作者机器人。回答只依据当前文章与下方已验证来源，不会脱离本文猜测。</p>{answers.length > 0 && <div className="blog-followups__thread" aria-live="polite">{answers.map((entry, index) => <article key={entry.id}><header><span>你的问题</span><b>{entry.question}</b></header><p>{entry.answer}</p><footer>{entry.citationIds.length ? <><span>依据：</span>{entry.citationIds.map(id => { const citation = article.citations.find(item => item.id === id); return citation ? <a key={id} href={`#source-${id}`}>[{article.citations.findIndex(item => item.id === id) + 1}] {citation.publisher}</a> : null; })}</> : <span>仅依据本文正文</span>}</footer>{index === answers.length - 1 && <small>你可以在下方继续追问，机器人会参考这一轮回答。</small>}</article>)}</div>}<div className="blog-followups__suggestions" aria-label="推荐问题">{items.slice(0, 3).map(item => <button type="button" key={item} disabled={busy} onClick={() => { setQuestion(item); setRetry(null); }}><span>{item}</span><small>填入问题 ↓</small></button>)}</div><form onSubmit={submit}><label htmlFor="blog-follow-up-question">向作者机器人提问</label><textarea id="blog-follow-up-question" rows="3" maxLength="500" value={question} onChange={event => { setQuestion(event.target.value); if (retry) setRetry(null); }} placeholder="例如：这几个项目最核心的差别是什么？" disabled={busy}/><div><span>{question.length}/500 · 登录用户每天最多 10 次</span><button type="submit" className={`button button--primary${busy ? ' is-loading' : ''}`} disabled={busy || question.trim().length < 2} aria-busy={busy}>{busy && <i className="blog-followups__spinner" aria-hidden="true"/>}<span>{busy ? '回答生成中' : answers.length ? '继续追问' : '发送问题'}</span></button></div></form>{busy && <div className="blog-followups__progress" role="status" aria-live="polite"><span className="blog-followups__activity" aria-hidden="true"><i/><i/><i/></span><span><strong>{busyStage || '正在查阅本文与已验证来源'}</strong><small>完成后会自动显示在这里，请稍候</small></span></div>}{message && <div className="blog-followups__message" role="alert"><span>{message}</span>{message.includes('登录') && <button type="button" onClick={() => go('/account')}>前往登录 →</button>}</div>}{answers.length > 0 && <button className="blog-followups__restart" type="button" onClick={() => { setAnswers([]); setQuestion(''); setMessage(''); setRetry(null); }}>开始新的问题</button>}</aside>;
}

export function BlogIndexPage({ api, go }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: '' });
  useEffect(() => { let live = true; api.listBlogArticles().then(({ data }) => live && setState({ status: 'ready', items: data.items, error: '' })).catch(error => live && setState({ status: 'error', items: [], error: error.message })); return () => { live = false; }; }, [api]);
  return <main className="page blog-page"><header className="blog-hero"><span className="kicker">MOOYU JOURNAL</span><h1>墨鱼日志</h1><p>记录工具、游戏与开放创作背后的研究、设计和版本变化。</p></header>{state.status === 'loading' ? <p className="blog-state">正在读取文章…</p> : state.status === 'error' ? <p className="form-error">{state.error}</p> : state.items.length ? <section className="blog-index">{state.items.map(article => <article key={article.id}><button type="button" onClick={() => go(`/blog/${article.slug}`)}><span>{article.locale === 'en' ? 'ENGLISH' : '简体中文'}</span><h2>{article.title}</h2><p>{article.summary}</p><footer><time>{formatDate(article.publishedAt)}</time><em>{article.author.displayName}</em>{article.author.accountType==='agent'&&<AgentDisclosure profile={article.author}/>}</footer></button></article>)}</section> : <p className="blog-state">第一篇文章正在准备中。</p>}</main>;
}

export function BlogArticlePage({ slug, api, go }) {
  const [state, setState] = useState({ status: 'loading', article: null, error: '' });
  useEffect(() => { let live = true; api.getBlogArticle(slug).then(({ data }) => live && setState({ status: 'ready', article: data, error: '' })).catch(error => live && setState({ status: 'error', article: null, error: error.message })); return () => { live = false; }; }, [api, slug]);
  if (state.status === 'loading') return <main className="page blog-page"><p className="blog-state">正在打开文章…</p></main>;
  if (state.status === 'error') return <main className="page blog-page"><p className="form-error">{state.error}</p><button className="button button--secondary" onClick={() => go('/blog')}>返回文章列表</button></main>;
  const article = state.article;
  const agentAuthored = article.author.accountType === 'agent';
  const headings = article.blocks.map((block, index) => block.type === 'heading' && (block.text !== '继续追问' || !agentAuthored) ? { index, text: block.text, level: block.level, id: `section-${index}` } : null).filter(Boolean);
  const followIndex = agentAuthored ? article.blocks.findIndex(block => block.type === 'heading' && block.text === '继续追问') : -1;
  const followQuestions = followIndex >= 0 && article.blocks[followIndex + 1]?.type === 'list' ? article.blocks[followIndex + 1].items : [];
  const bodyBlocks = followIndex >= 0 ? article.blocks.filter((_, index) => index !== followIndex && index !== followIndex + 1) : article.blocks;
  const repositories = [...new Map(article.citations.map(citation => [githubRepository(citation), citation]).filter(([url]) => url)).values()];
  return <main className="page blog-page blog-page--article"><div className="blog-article-shell">{headings.length > 1 && <aside className="blog-toc"><span>本文目录</span><nav>{headings.map(heading => <a className={heading.level === 3 ? 'is-sub' : ''} key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav></aside>}<article className="blog-article"><header><button type="button" onClick={() => go('/blog')}>← 墨鱼日志</button><span className="kicker">{article.locale === 'en' ? 'MOOYU JOURNAL' : '官方文章'}</span><h1>{article.title}</h1><p>{article.summary}</p><div className="blog-article__meta"><button type="button" className="blog-author-identity" onClick={()=>article.author.handle&&go(`/u/${article.author.handle}`)} disabled={!article.author.handle}><AvatarView avatar={article.author.avatar} api={api} alt={`${article.author.displayName}的头像`}/><span><strong>{article.author.displayName}</strong>{article.author.handle&&<small>@{article.author.handle}</small>}</span></button><AgentDisclosure profile={article.author}/><time>{formatDate(article.publishedAt)}</time><span>{readMinutes(article.blocks)} 分钟阅读</span><span>{article.citations.length} 个来源</span></div></header>{repositories.length > 0 && <section className="blog-repositories" aria-label={repositories.length===1?'本期项目 GitHub 仓库':'本期对比项目 GitHub 仓库'}><header><div><span className="kicker">OPEN SOURCE</span><h2>{repositories.length===1?'本期项目':'本期对比'}</h2></div><p>{repositories.length===1?'本文围绕这个已验证的公开仓库展开，点击卡片可直接访问项目。':'这些仓库均在正文中被实际引用，并围绕同一问题进行比较。'}</p></header><div>{repositories.map(citation => <a key={citation.id} href={githubRepository(citation)} target="_blank" rel="noreferrer" aria-label={`打开 GitHub 仓库 ${repositoryName(citation)}`}><span className="blog-repositories__mark" aria-hidden="true">GH</span><span className="blog-repositories__identity"><small>GITHUB REPOSITORY</small><strong>{repositoryName(citation)}</strong><code>{githubRepository(citation)}</code></span><em>访问仓库 <b aria-hidden="true">↗</b></em></a>)}</div></section>}<section className="blog-article__body">{bodyBlocks.map(block => { const originalIndex = article.blocks.indexOf(block); return <BlogBlock key={`${block.type}-${originalIndex}`} block={block} citations={article.citations} headingId={block.type === 'heading' ? `section-${originalIndex}` : null}/>; })}</section>{article.citations.length > 0 && <footer className="blog-citations"><span className="kicker">SOURCES</span><h2>资料来源与原文片段</h2><p>引用片段来自发布前抓取的公开页面；点击仓库地址可核对最新原文。</p><ol>{article.citations.map((citation, index) => <li id={`source-${citation.id}`} key={citation.id}><header><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{citation.label}</strong><small>{citation.publisher}{citation.locator ? ` · ${citation.locator}` : ''}</small></div><a href={citation.url} target="_blank" rel="noreferrer">查看原文 ↗</a></header><h3>{citation.title}</h3>{citation.excerpt && <details><summary>查看引用的原文片段</summary><blockquote>{citation.excerpt}</blockquote></details>}{githubRepository(citation) && <a className="blog-citation__repo" href={githubRepository(citation)} target="_blank" rel="noreferrer"><span>GitHub 仓库</span><strong>{repositoryName(citation)}</strong><em>访问 ↗</em></a>}<time>访问于 {formatDate(citation.accessedAt)}</time></li>)}</ol></footer>}{agentAuthored && <FollowUpPanel article={article} questions={followQuestions} api={api} go={go}/>}</article></div></main>;
}

const blockLabel = { paragraph: '段落', heading: '标题', quote: '引用', list: '列表', code: '代码' };
const normalizeBlock = type => type === 'heading' ? { type, level: 2, text: '' } : type === 'quote' ? { type, text: '', citationIds: [] } : type === 'list' ? { type, ordered: false, items: [''] } : type === 'code' ? { type, language: 'text', text: '' } : { type: 'paragraph', text: '' };

function BlockEditor({ block, citations, onChange, onRemove }) {
  const field = (key, value) => onChange({ ...block, [key]: value });
  return <article className="blog-editor-block"><header><select value={block.type} onChange={event => onChange(normalizeBlock(event.target.value))}>{Object.entries(blockLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={onRemove}>移除</button></header>{block.type === 'heading' && <select value={block.level} onChange={event => field('level', Number(event.target.value))}><option value="2">二级标题</option><option value="3">三级标题</option></select>}{block.type === 'list' && <label><input type="checkbox" checked={block.ordered} onChange={event => field('ordered', event.target.checked)}/> 有序列表</label>}{block.type === 'code' && <input value={block.language} maxLength="32" onChange={event => field('language', event.target.value)} placeholder="语言，如 javascript"/>}<textarea value={block.type === 'list' ? block.items.join('\n') : block.text} onChange={event => block.type === 'list' ? field('items', event.target.value.split('\n')) : field('text', event.target.value)} placeholder={block.type === 'list' ? '每行一项' : '正文'} rows={block.type === 'code' ? 8 : 4}/>{['quote','paragraph','list'].includes(block.type) && citations.length > 0 && <fieldset><legend>引用来源</legend>{citations.map(citation => { const selected = block.citationIds ?? []; return <label key={citation.id}><input type="checkbox" checked={selected.includes(citation.id)} onChange={event => field('citationIds', event.target.checked ? [...selected, citation.id] : selected.filter(id => id !== citation.id))}/>{citation.label}</label>; })}</fieldset>}</article>;
}

function CitationEditor({ citation, onChange, onRemove }) {
  const field = (key, value) => onChange({ ...citation, [key]: value });
  return <article className="blog-editor-citation"><header><strong>来源</strong><button type="button" onClick={onRemove}>移除</button></header><input value={citation.label} onChange={event => field('label', event.target.value)} placeholder="短标签"/><input value={citation.title} onChange={event => field('title', event.target.value)} placeholder="资料标题"/><input type="url" value={citation.url} onChange={event => field('url', event.target.value)} placeholder="原文 https://…"/><input value={citation.publisher} onChange={event => field('publisher', event.target.value)} placeholder="发布者"/><input type="url" value={citation.repositoryUrl ?? ''} onChange={event => field('repositoryUrl', event.target.value || undefined)} placeholder="GitHub 仓库地址（可选）"/><input value={citation.locator ?? ''} onChange={event => field('locator', event.target.value || undefined)} placeholder="原文位置，如 README / 安装"/><label className="is-wide">原文片段（可选）<textarea rows="4" value={citation.excerpt ?? ''} onChange={event => field('excerpt', event.target.value || undefined)} placeholder="保存经过核对的短片段，方便读者查看引用上下文"/></label><label>发布日期（可选）<input type="datetime-local" value={citation.publishedAt ? citation.publishedAt.slice(0, 16) : ''} onChange={event => field('publishedAt', event.target.value ? new Date(event.target.value).toISOString() : null)}/></label></article>;
}

export function BlogAdmin({ api, demo = false }) {
  const [articles, setArticles] = useState([]), [selectedId, setSelectedId] = useState(null), [draft, setDraft] = useState(emptyDraft), [version, setVersion] = useState(null), [status, setStatus] = useState('loading'), [busy, setBusy] = useState(''), [message, setMessage] = useState('');
  const selected = useMemo(() => {
    const article = articles.find(item => item.id === selectedId) ?? null;
    return article?.publicationState === 'published' && article.workingRevisionId !== article.publishedRevisionId
      ? { ...article, publicationState: 'draft' }
      : article;
  }, [articles, selectedId]);
  const load = async () => { setStatus('loading'); try { const data = demo ? { items: [] } : (await api.listMyBlogArticles()).data; setArticles(data.items); setStatus('ready'); } catch (error) { setMessage(error.message); setStatus('error'); } };
  useEffect(() => { void load(); }, [api, demo]);
  const select = async item => { setMessage(''); if (!item) { setSelectedId(null); setVersion(null); setDraft(emptyDraft()); return; } setBusy('load'); try { const response = await api.getMyBlogArticle(item.id); setSelectedId(item.id); setVersion(response.data.version); setDraft({ slug: response.data.slug, locale: response.data.locale, title: response.data.title, summary: response.data.summary, blocks: response.data.blocks, citations: response.data.citations }); } catch (error) { setMessage(error.message); } finally { setBusy(''); } };
  const replace = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const save = async () => { setBusy('save'); setMessage(''); try { const response = selectedId ? await api.updateBlogDraft(selectedId, version, draft) : await api.createBlogDraft(draft); setSelectedId(response.data.id); setVersion(response.data.version); setMessage('草稿已保存；尚未公开。'); await load(); } catch (error) { setMessage(error.message); } finally { setBusy(''); } };
  const transition = async action => { if (!selectedId) return; if (!globalThis.confirm?.(action === 'publish' ? '发布当前草稿？公开读者和 Agent 将立即可见。' : '撤回这篇文章？公开访问将立即停止。')) return; setBusy(action); setMessage(''); try { const response = action === 'publish' ? await api.publishBlogArticle(selectedId, version) : await api.withdrawBlogArticle(selectedId, version); setVersion(response.data.version); setMessage(action === 'publish' ? '文章已发布。' : '文章已撤回。'); await load(); } catch (error) { setMessage(error.message); } finally { setBusy(''); } };
  return <section className="blog-admin"><header><div><span className="kicker">OFFICIAL JOURNAL</span><h2>官方文章</h2><p>结构化编辑、显式发布；研究助手只能导入私有草稿，不能自动上线。</p></div><button type="button" className="button button--secondary" onClick={() => select(null)}>新建草稿</button></header>{message && <p className="admin-notice" role="status">{message}</p>}<div className="blog-admin__layout"><aside><h3>文章</h3>{status === 'loading' ? <p>正在加载…</p> : articles.length ? articles.map(item => <button type="button" className={item.id === selectedId ? 'is-active' : ''} key={item.id} onClick={() => select(item)}><strong>{item.title}</strong><span>{item.publicationState === 'published' ? '已发布' : item.publicationState === 'withdrawn' ? '已撤回' : '草稿'} · v{item.version}</span></button>) : <p>尚无文章。</p>}</aside><div className="blog-editor"><div className="blog-editor__meta"><label>文章地址<input value={draft.slug} onChange={event => replace('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, '-'))} placeholder="designing-for-agents" disabled={Boolean(selected?.firstPublishedAt)}/></label><label>语言<select value={draft.locale} onChange={event => replace('locale', event.target.value)} disabled={Boolean(selected?.firstPublishedAt)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><label className="is-wide">标题<input value={draft.title} maxLength="120" onChange={event => replace('title', event.target.value)}/></label><label className="is-wide">摘要<textarea value={draft.summary} maxLength="360" rows="3" onChange={event => replace('summary', event.target.value)}/></label></div><section><div className="blog-editor__section-head"><h3>正文区块</h3><button type="button" onClick={() => replace('blocks', [...draft.blocks, normalizeBlock('paragraph')])}>＋ 添加段落</button></div>{draft.blocks.map((block, index) => <BlockEditor key={index} block={block} citations={draft.citations} onChange={next => replace('blocks', draft.blocks.map((item, current) => current === index ? next : item))} onRemove={() => draft.blocks.length > 1 && replace('blocks', draft.blocks.filter((_, current) => current !== index))}/>)}</section><section><div className="blog-editor__section-head"><h3>资料来源</h3><button type="button" onClick={() => replace('citations', [...draft.citations, { id: randomId(), label: '', title: '', url: '', publisher: '', publishedAt: null, accessedAt: new Date().toISOString() }])}>＋ 添加来源</button></div>{draft.citations.map((citation, index) => <CitationEditor key={citation.id} citation={citation} onChange={next => replace('citations', draft.citations.map((item, current) => current === index ? next : item))} onRemove={() => replace('citations', draft.citations.filter((_, current) => current !== index))}/>)}</section><footer><button type="button" className="button button--primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '保存中…' : '保存私有草稿'}</button>{selectedId && selected?.publicationState !== 'published' && <button type="button" className="button button--secondary" disabled={Boolean(busy)} onClick={() => transition('publish')}>发布</button>}{selectedId && selected?.publicationState === 'published' && <button type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => transition('withdraw')}>撤回</button>}</footer></div></div></section>;
}
