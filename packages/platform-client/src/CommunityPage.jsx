import React,{useCallback,useEffect,useRef,useState} from 'react';
import { CommunityShell } from './CommunityShell.jsx';
const labels={game:'游戏',ai:'AI',computing:'计算机'};
const statuses={draft:'草稿',pending:'待审核',approved:'已通过',rejected:'需修改',superseded:'待重新编辑'};
const newKey=()=>crypto.randomUUID();
const blank=(projectId=null)=>({channel:'game',title:'',blocks:[{type:'paragraph',text:''}],projectId});
const when=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未发布';
const Button=({children,primary=false,...props})=><button className={'button button--'+(primary?'primary':'secondary')} {...props}>{children}</button>;
function ActionIcon({type,active=false}) {
  if(type==='like')return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.7 13A4.8 4.8 0 0 1 11.5 6.2l.5.6.5-.6A4.8 4.8 0 0 1 19.3 13Z" fill={active?'currentColor':'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 17l-5.5 3.5Z" fill={active?'currentColor':'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}
const failure=error=>error.status===401?'请先登录，再继续操作。':error.message||'操作未完成，请重试。';
const postingMessage=reason=>({AUTH_REQUIRED:'请登录后投稿，内容审核通过后公开。',ACCOUNT_UNAVAILABLE:'当前账号不可用，请检查账号状态。',POSTING_PAUSED:'投稿暂时暂停，请稍后再试。',POSTING_RESTRICTED:'当前账号已被限制投稿；已有分享仍可查看、撤回或删除。'}[reason]||'投稿暂不可用，请稍后重试。');

function ImageBlock({api,block,preview=false,variant='thumb'}) {
  const element=useRef(null),[near,setNear]=useState(false);
  useEffect(()=>{if(!globalThis.IntersectionObserver){setNear(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);observer.disconnect();}},{rootMargin:'200px'});observer.observe(element.current);return()=>observer.disconnect();},[]);
  const [state,setState]=useState({url:null,error:false});
  useEffect(()=>{
    if(!near)return;
    const abort=new AbortController();let url;
    setState({url:null,error:false});
    api.communityImage(block.assetId,{preview,variant,signal:abort.signal}).then(({data})=>{
      if(abort.signal.aborted)return;
      url=URL.createObjectURL(data);setState({url,error:false});
    }).catch(()=>{if(!abort.signal.aborted)setState({url:null,error:true});});
    return()=>{abort.abort();if(url)URL.revokeObjectURL(url);};
  },[api,block.assetId,preview,variant,near]);
  return <figure ref={element} className="community-image">{state.url?<img src={state.url} alt={block.alt||'分享图片'} loading="lazy"/>:<div role="status">{state.error?'图片暂不可见':'图片载入中…'}</div>}{block.alt&&<figcaption>{block.alt}</figcaption>}</figure>;
}
function Blocks({post,api,preview=false,full=false}) {
  return <div className="community-blocks">{post.blocks.map((block,index)=>block.type==='paragraph'?<p key={index}>{block.text}</p>:block.type==='link'?<a className="community-source" key={index} href={block.url} target="_blank" rel="noopener noreferrer"><span>↗</span><span><strong>{block.label||'查看原文'}</strong><small>{new URL(block.url).hostname}</small></span></a>:block.type==='image'?<ImageBlock key={block.assetId} api={api} block={block} preview={preview} variant={full?'display':'thumb'}/>:null)}</div>;
}
function Editor({api,initial,capabilities,onDone,onCancel,demo=false,seedProjectId=null}) {
  const [post,setPost]=useState(initial),[draft,setDraft]=useState(initial?{channel:initial.channel,title:initial.title,blocks:initial.blocks,projectId:initial.project?.id||null}:()=>blank(seedProjectId)),[projects,setProjects]=useState([]);
  const [files,setFiles]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const requestKeys=useRef(new Map()),uploads=useRef(new Map()),abort=useRef(new AbortController()),running=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();abort.current=controller;
    return()=>controller.abort();
  },[]);
  useEffect(()=>{let live=true;(demo?Promise.resolve([{id:'demo-project',title:'像素迷阵移动端适配',isOwner:true,status:'recruiting',membership:null}]):api.communityProjects({mine:true}).then(result=>result.data)).then(items=>{if(live)setProjects(items.filter(project=>project.isOwner||project.membership?.state==='active'));}).catch(()=>{});return()=>{live=false;};},[api,demo]);
  const keyFor=value=>{const map=requestKeys.current;if(!map.has(value))map.set(value,newKey());return map.get(value);};
  const change=(index,patch)=>setDraft(value=>({...value,blocks:value.blocks.map((block,at)=>at===index?{...block,...patch}:block)}));
  async function persist(submit) {
    if(running.current)return;
    running.current=true;setBusy(true);setError('');
    const signal=abort.current.signal;
    try{
      if(!draft.title.trim())throw Error('请填写标题。');
      let current=post;
      const blocks=draft.blocks.filter(block=>block.type!=='paragraph'||block.text.trim());
      if(!blocks.length&&!files.length)throw Error('请写一点内容、添加来源链接或图片。');
      if(!current){
        setMessage('保存草稿…');
        const seed={...draft,blocks:blocks.length?blocks:[{type:'paragraph',text:draft.title}]};
        current=(await api.communitySave(null,seed,{key:keyFor(JSON.stringify(seed)),signal})).data;
        setPost(current);
      }
      const imageBlocks=[];
      for(const file of files) {
        setMessage('正在处理图片：'+file.name);
        let asset=uploads.current.get(file);
        if(!asset) {
          const bytes=await file.arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
          asset=(await api.communityReserve(current.id,{bytes:file.size,contentType:file.type,sha256},{key:keyFor(current.id+':'+sha256),signal})).data;
          uploads.current.set(file,asset);
          await api.communityUpload(asset.id,bytes,{signal});
          await api.communityComplete(asset.id,{signal});
        } else if(asset.state==='reserved') {
          await api.communityUpload(asset.id,await file.arrayBuffer(),{signal});
          await api.communityComplete(asset.id,{signal});
        }
        for(let attempt=0;attempt<45;attempt++) {
          const status=(await api.communityMediaStatus(asset.id,{signal})).data;asset.state=status.state;
          if(status.state==='ready')break;
          if(['failed','deleted','deleting'].includes(status.state))throw Error('图片处理失败，请移除此图片后重新选择。');
          if(attempt===44)throw Error('图片仍在排队。稍后点击保存即可继续。');
          await new Promise(resolve=>setTimeout(resolve,1000));
          if(signal.aborted)throw Error('操作已取消。');
        }
        imageBlocks.push({type:'image',assetId:asset.id,alt:file.name.replace(/\.[^.]+$/,'').slice(0,120)});
      }
      const body={...draft,blocks:[...blocks,...imageBlocks]};
      const unchanged=current.channel===body.channel&&current.title===body.title&&JSON.stringify(current.blocks)===JSON.stringify(body.blocks)&&(current.project?.id||null)===(body.projectId||null);
      if(!unchanged||['superseded','approved'].includes(current.reviewStatus)){
        setMessage('保存内容…');
        current=(await api.communitySave(current.id,body,{version:current.version,key:keyFor(current.id+':'+current.version+':'+JSON.stringify(body)),signal})).data;
        setPost(current);setDraft(body);setFiles([]);
      }
      if(submit&&current.reviewStatus!=='pending') {
        setMessage('提交审核…');
        current=(await api.communitySubmit(current,{key:keyFor('submit:'+current.id+':'+current.version),signal})).data;setPost(current);
      }
      onDone(submit?'已提交，审核通过后会出现在分享页。':'草稿已保存。');
    }catch(caught){if(!signal.aborted)setError(failure(caught));}
    finally{running.current=false;if(!signal.aborted){setBusy(false);setMessage('');}}
  }
  return <section className="community-editor panel" aria-labelledby="community-editor-title"><div className="community-card-head"><h2 id="community-editor-title">{initial?'编辑分享':'分享新发现'}</h2><Button disabled={busy} onClick={onCancel}>关闭</Button></div><p className="community-muted">内容和修改审核通过后，将连同你的昵称公开。个人主页仍按原隐私设置展示。请附上消息来源，只上传有权分享的图片。</p>
    <fieldset disabled={busy}><label>标题<input maxLength={120} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} placeholder="这个发现有什么值得一看？"/></label><label>主题<select aria-label="主题" value={draft.channel} onChange={event=>setDraft({...draft,channel:event.target.value})}>{Object.entries(labels).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label>关联项目（可选）<select aria-label="关联项目" value={draft.projectId||''} onChange={event=>setDraft({...draft,projectId:event.target.value||null})}><option value="">普通动态</option>{projects.filter(project=>['recruiting','active','completed'].includes(project.status)).map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    {draft.blocks.map((block,index)=><div className="community-edit-block" key={index}>{block.type==='paragraph'?<label>文字<textarea maxLength={4000} rows={4} value={block.text} onChange={event=>change(index,{text:event.target.value})} placeholder="补充你的看法或消息摘要…"/></label>:block.type==='link'?<><label>来源链接<input type="url" placeholder="https://" value={block.url} onChange={event=>change(index,{url:event.target.value})}/></label><label>链接说明<input maxLength={160} value={block.label||''} onChange={event=>change(index,{label:event.target.value})}/></label></>:<><ImageBlock api={api} block={block} preview/><label>图片说明<input maxLength={240} value={block.alt} onChange={event=>change(index,{alt:event.target.value})}/></label></>}<button type="button" className="community-text-button" onClick={()=>setDraft({...draft,blocks:draft.blocks.filter((_,at)=>at!==index)})}>移除{block.type==='image'?'图片':'这一段'}</button></div>)}
    <div className="community-actions"><Button disabled={draft.blocks.length>=32} onClick={()=>setDraft({...draft,blocks:[...draft.blocks,{type:'paragraph',text:''}]})}>＋ 文字</Button><Button disabled={draft.blocks.filter(b=>b.type==='link').length>=3} onClick={()=>setDraft({...draft,blocks:[...draft.blocks,{type:'link',url:'',label:''}]})}>＋ 来源链接</Button>{capabilities.imagesEnabled&&<label className="community-file">＋ 图片<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event=>{const selected=Array.from(event.target.files||[]);event.target.value='';if(selected.some(file=>file.size>2097152||!['image/jpeg','image/png','image/webp'].includes(file.type))){setError('请选择 2 MiB 以内的静态 JPG、PNG 或 WebP。');return;}if(files.length+selected.length+draft.blocks.filter(b=>b.type==='image').length>3){setError('每条分享最多 3 张图片。');return;}setFiles([...files,...selected]);}}/></label>}</div>
    {files.map((file,index)=><div className="community-file-row" key={index}><span>{file.name}</span><button type="button" onClick={()=>setFiles(files.filter((_,at)=>at!==index))}>移除</button></div>)}
    <small className="community-muted">文字合计 4,000 字 · 最多 3 个来源链接{capabilities.imagesEnabled?' · 3 张静态图片，每张 2 MiB 以内':''}</small></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<p role="status">{message}</p><div className="community-actions"><Button disabled={busy} onClick={()=>persist(false)}>保存草稿</Button><Button primary disabled={busy} onClick={()=>persist(true)}>{busy?'处理中…':'提交分享'}</Button></div>
  </section>;
}
function ReviewCard({post,api,onChanged,onError}) {
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  const keys=useRef(new Map());
  async function decide(action) {
    if(!reason.trim()){onError('请填写处理理由。');return;}
    setBusy(true);
    const signature=post.id+post.version+action+reason;
    if(!keys.current.has(signature))keys.current.set(signature,newKey());
    try{await api.communityDecide(post,{action,reason},{key:keys.current.get(signature)});onChanged();}
    catch(error){onError(failure(error));}finally{setBusy(false);}
  }
  return <article className="community-card panel"><div className="community-card-head"><span className="community-tag">{statuses[post.reviewStatus]}</span><span>{post.moderationState==='hidden'?'已隐藏':''}</span></div><h2>{post.title}</h2><p className="community-muted">{post.author.displayName} · {post.author.id}</p><Blocks post={post} api={api} preview full/>{post.publishedContent&&post.publishedContent.revisionId!==post.revisionId&&<details><summary>查看当前公开版本（举报对应内容）</summary><h3>{post.publishedContent.title}</h3><Blocks post={post.publishedContent} api={api} preview full/></details>}{post.reports?.map(report=><p className="community-report" key={report.id}>举报 · {report.category}：{report.details}</p>)}<label>处理理由<textarea maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><div className="community-actions">{post.reviewStatus==='pending'&&<><Button disabled={busy} primary onClick={()=>decide('approve')}>通过此版本</Button><Button disabled={busy} onClick={()=>decide('reject')}>退回修改</Button></>}<Button disabled={busy} onClick={()=>decide(post.moderationState==='hidden'?'restore':'hide')}>{post.moderationState==='hidden'?'恢复可见':'隐藏分享'}</Button>{post.reports?.length>0&&<Button disabled={busy} onClick={()=>decide('dismiss_reports')}>驳回举报</Button>}</div></article>;
}
function PostingRestrictions({api,onNotice,onError}) {
  const [id,setId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  async function save(allowed){setBusy(true);try{await api.communityMember(id,{allowed,reason});onNotice(allowed?'投稿限制已解除。':'已限制该账号投稿。');}catch(error){onError(failure(error));}finally{setBusy(false);}}
  return <details className="community-members panel"><summary>投稿限制管理</summary><p className="community-muted">正常登录用户默认可投稿。按用户 ID 限制违规账号，或解除已有投稿限制；内容仍需审核。</p><label>用户 ID<input value={id} onChange={event=>setId(event.target.value.trim())}/></label><label>调整原因<input maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><div className="community-actions"><Button disabled={busy||!id||!reason.trim()} onClick={()=>save(false)}>限制投稿</Button><Button disabled={busy||!id||!reason.trim()} onClick={()=>save(true)}>解除投稿限制</Button></div></details>;
}
export default function CommunityPage({api,go,route,accountProfile,AvatarView,demo=false}) {
  const editorRoute=route==='/community/feed/new'||route.startsWith('/community/feed/new/project/'),seedProjectId=route.match(/^\/community\/feed\/new\/project\/([^/]+)$/)?.[1]||null;
  const [cap,setCap]=useState(null),[items,setItems]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[editor,setEditor]=useState(editorRoute?'new':null),[report,setReport]=useState(null),[confirm,setConfirm]=useState(null);
  const mode=['/community/mine','/community/me'].includes(route)?'mine':route==='/community/bookmarks'?'bookmarks':route==='/community/review'?'review':'feed';
  const parts=route.split('/').filter(Boolean),candidate=parts[1]==='feed'?parts[2]:parts[1];
  const channel=['game','ai','computing'].includes(candidate)?candidate:null;
  const author=route.startsWith('/community/author/')?route.split('/')[3]:null;
  const detail=route.startsWith('/community/posts/')?route.split('/')[3]:null;
  const home=route==='/community'||route==='/social';
  const generation=useRef(0);
  const load=useCallback(async(more=false)=>{
    const current=++generation.current;setLoading(true);setError('');
    try{
      if(demo){setCap({readEnabled:false});setItems([]);return;}
      const capabilities=(await api.communityCapabilities()).data;
      if(current!==generation.current)return;setCap(capabilities);
      if(!capabilities.readEnabled){setItems([]);return;}
      const response=detail?{items:[(await api.communityPost(detail)).data]}:mode==='review'?(await api.communityReview({cursor:more?cursor:undefined})).data:(await api.communityList({kind:mode,author:mode==='feed'?author:undefined,channel:mode==='feed'?channel:undefined,cursor:more?cursor:undefined})).data;
      if(current!==generation.current)return;
      setItems(previous=>more?[...previous,...response.items.filter(item=>!previous.some(p=>p.id===item.id))]:response.items);
      setCursor(response.nextCursor??null);
    }catch(caught){if(current===generation.current)setError(failure(caught));}
    finally{if(current===generation.current)setLoading(false);}
  },[api,mode,channel,detail,author,cursor,demo]);
  useEffect(()=>{setItems([]);setCursor(null);setEditor(editorRoute?'new':null);setReport(null);setConfirm(null);load();return()=>{generation.current++;};},[api,mode,channel,detail,author,demo,route]);
  async function interact(post,type) {
    if(busy)return;setBusy(post.id);setError('');
    const property=type==='like'?'liked':'bookmarked',active=!post[property];
    try{
      await api.communityInteract(post.id,type,active);
      setItems(values=>values.filter(p=>!(mode==='bookmarks'&&p.id===post.id&&type==='bookmark'&&!active)).map(p=>p.id===post.id?{...p,[property]:active,likeCount:type==='like'?String(BigInt(p.likeCount)+(active?1n:-1n)):p.likeCount}:p));
    }catch(caught){setError(failure(caught));}finally{setBusy('');}
  }
  async function edit(post) {setBusy(post.id);try{setEditor((await api.communityPost(post.id,{manage:true})).data);}catch(caught){setError(failure(caught));}finally{setBusy('');}}
  async function remove() {
    setBusy(confirm.post.id);try{await api.communityWithdraw(confirm.post,confirm.remove);setConfirm(null);setNotice(confirm.remove?'分享已删除。':'分享已撤回。');await load();}catch(caught){setError(failure(caught));}finally{setBusy('');}
  }
  async function sendReport(event){event.preventDefault();setBusy(report.post.id);try{await api.communityReport(report.post.id,{category:report.category,details:report.details});setReport(null);setNotice('举报已提交。');}catch(caught){setError(failure(caught));}finally{setBusy('');}}
  return <CommunityShell route={route} go={go}><section className={`community-page${home?' is-home':''}`}>
    {home&&<section className="community-home-intro" aria-labelledby="community-home-title"><div className="community-home-intro__copy"><span className="kicker">WHAT IS HAPPENING</span><h2 id="community-home-title">今天，和谁一起做点什么？</h2><p>从一个小任务开始参与作品，也可以看看社区刚刚分享的新发现。</p></div><div className="community-home-paths"><button type="button" className="is-project" onClick={()=>go('/community/projects')}><span aria-hidden="true">↗</span><strong>一起做</strong><small>领取开放任务，留下可信贡献</small><em>查看项目与任务 →</em></button><button type="button" className="is-feed" onClick={()=>go('/community/feed')}><span aria-hidden="true">✦</span><strong>看看动态</strong><small>游戏、AI 与计算机的新发现</small><em>进入动态 →</em></button></div><div className="community-home-future" aria-label="正在准备的社区能力"><span><i aria-hidden="true">◫</i><b>线上活动</b><small>试玩会与社区聚会</small></span><span><i aria-hidden="true">◉</i><b>游戏组队</b><small>围绕真实游戏找队友</small></span><em>设计已完成 · 分阶段开放</em></div></section>}
    {!home&&!detail&&!author&&<header className="community-section-heading"><div><span className="kicker">{mode==='mine'?'MY COMMUNITY':mode==='bookmarks'?'SAVED FOR LATER':mode==='review'?'COMMUNITY REVIEW':'COMMUNITY FEED'}</span><h2>{mode==='mine'?'我的参与':mode==='bookmarks'?'私人收藏':mode==='review'?'审核管理':'动态'}</h2><p>{mode==='mine'?'管理自己的分享，并继续处理已经参与的共建任务。':mode==='bookmarks'?'只有你能看到收藏；原内容不可用后不会泄露正文。':mode==='review'?'处理投稿、举报与账号投稿限制。':'游戏、AI、计算机。把值得一看的新发现留在这里。'}</p></div>{mode==='feed'&&<Button primary disabled={Boolean(accountProfile)&&!cap?.canShare} onClick={()=>cap?.canShare?setEditor('new'):go('/account')}>{cap?.canShare?'＋ 发布动态':accountProfile?cap?.reason==='POSTING_RESTRICTED'?'投稿已受限':'暂不可投稿':'登录后参与'}</Button>}</header>}
    {['mine','bookmarks'].includes(mode)&&<nav className="community-personal-nav" aria-label="我的参与"><button className={mode==='mine'?'is-active':''} onClick={()=>go('/community/me')}>我的分享</button><button className={mode==='bookmarks'?'is-active':''} onClick={()=>go('/community/bookmarks')}>私人收藏</button><button onClick={()=>go('/community/projects')}>我的任务 ↗</button></nav>}
    {notice&&<p className="social-notice" role="status">{notice}</p>}{error&&<div className="community-error" role="alert"><p>{error}</p><Button onClick={()=>load()}>重新加载</Button>{!accountProfile&&<Button onClick={()=>go('/account')}>登录</Button>}</div>}
    {editor&&cap?.canShare&&<Editor key={(editor.id||'new')+':'+(seedProjectId||'none')} api={api} initial={editor==='new'?null:editor} seedProjectId={seedProjectId} capabilities={cap} demo={demo} onCancel={()=>{setEditor(null);if(editorRoute)go('/community/feed');}} onDone={message=>{setEditor(null);setNotice(message);if(mode==='mine')load();else go('/community/me');}}/>}
    {cap&&!cap.readEnabled?<section className="community-empty panel"><span aria-hidden="true">◇</span><h2>{demo?'分享板块预览':'分享板块即将开放'}</h2><p>{demo?'预览模式不发布内容。连接服务后可查看实际分享。':'先去玩一局，下一次来看看大家的新发现。'}</p><Button onClick={()=>go('/discover')}>去发现游戏</Button></section>:<>
    {author&&<p className="community-muted">这位玩家的公开动态</p>}{mode==='feed'&&!detail&&!author&&<div className="community-feed-head"><div><span className="kicker">{home?'LATEST FROM THE COMMUNITY':'BROWSE BY TOPIC'}</span><h2>{home?'最新动态':'按主题浏览'}</h2></div><div className="filter-row" aria-label="主题筛选">{[[null,'全部'],...Object.entries(labels)].map(([key,name])=><button key={key||'all'} className={channel===key?'is-active':''} onClick={()=>go('/community/feed'+(key?'/'+key:''))}>{name}</button>)}<span className="community-sort">最新发布</span></div></div>}
    {mode==='bookmarks'&&<p className="community-muted">只有你能查看这里的收藏。已撤回、隐藏或不再向你公开的内容会自动从列表中隐藏。</p>}
    {cap&&!cap.canShare&&<p className="community-muted" role="status">{postingMessage(cap.reason)}</p>}
    {mode==='review'&&cap?.isAdmin&&<PostingRestrictions api={api} onNotice={setNotice} onError={setError}/>}
    {loading&&!items.length?<p className="community-empty" role="status">正在载入分享…</p>:!error&&!items.length?<section className="community-empty panel"><span aria-hidden="true">✧</span><h2>{mode==='mine'?'你的第一个发现，从这里开始':mode==='bookmarks'?'还没有收藏':mode==='review'?'审核队列为空':'等待第一个新发现'}</h2><p>{mode==='bookmarks'?'看到想留着看的内容，点击收藏。':mode==='mine'?'一篇文章、一张图片，或一点自己的观察。':mode==='review'?'新的投稿和举报会显示在这里。':'有趣的新游戏、AI 的新进展、值得了解的计算机技术。'}</p></section>:null}
    <div className="community-feed">{items.map(post=>mode==='review'?<ReviewCard key={post.id+post.version} post={post} api={api} onChanged={()=>load()} onError={setError}/>:<article className="community-card panel" key={post.id}><div className="community-card-head"><span className="community-tag">{labels[post.channel]}</span><time dateTime={post.publishedAt||post.updatedAt}>{when(mode==='mine'?post.updatedAt:post.publishedAt)}</time></div><h2>{mode==='mine'?post.title:<button onClick={()=>go('/community/posts/'+post.id)}>{post.title}</button>}</h2><button className="community-author" disabled={!post.author.handle} onClick={()=>go('/u/'+post.author.handle)}>{AvatarView?<AvatarView avatar={post.author.avatar} api={api} alt=""/>:<span className="community-author__fallback" aria-hidden="true">{post.author.displayName.slice(0,1)}</span>}<span className="community-author__copy"><strong>{post.author.displayName}</strong>{post.author.handle&&<small>@{post.author.handle}</small>}</span></button>{post.project&&<button type="button" className="community-post-project" onClick={()=>go(`/community/projects/${post.project.id}`)}>来自项目：{post.project.title} →</button>}{mode==='mine'&&<p className="community-muted">{post.publicationState==='withdrawn'?'已撤回 · ':post.publicationState==='published'?'已有公开版本 · ':''}{statuses[post.reviewStatus]}{post.moderationState==='hidden'?' · 已隐藏':''}{post.reviewReason?' · '+post.reviewReason:''}</p>}<Blocks post={post} api={api} preview={mode==='mine'} full={Boolean(detail)}/><footer className="community-actions">{mode==='mine'?<><Button disabled={busy===post.id||!cap?.canShare} onClick={()=>edit(post)}>编辑</Button>{post.publicationState==='published'&&<Button disabled={Boolean(busy)} onClick={()=>setConfirm({post,remove:false})}>撤回</Button>}<Button disabled={Boolean(busy)} onClick={()=>setConfirm({post,remove:true})}>删除</Button></>:<><button className="community-action-button" disabled={Boolean(busy)} aria-label={`点赞 ${post.likeCount}`} aria-pressed={post.liked} onClick={()=>interact(post,'like')}><ActionIcon type="like" active={post.liked}/><span>赞</span><b>{post.likeCount}</b></button><button className="community-action-button" disabled={Boolean(busy)} aria-label={post.bookmarked?'取消收藏':'收藏'} aria-pressed={post.bookmarked} onClick={()=>interact(post,'bookmark')}><ActionIcon type="bookmark" active={post.bookmarked}/><span>{post.bookmarked?'已收藏':'收藏'}</span></button><button className="community-report-button" onClick={()=>setReport({post,category:'other',details:''})}>举报</button></>}</footer>
    {confirm?.post.id===post.id&&<div className="community-confirm" role="group" aria-label="确认操作"><p>{confirm.remove?'删除后无法恢复编辑。确认删除这条分享？':'撤回后其他人将无法查看。确认撤回？'}</p><Button disabled={Boolean(busy)} onClick={()=>setConfirm(null)}>取消</Button> <Button disabled={Boolean(busy)} onClick={remove}>确认{confirm.remove?'删除':'撤回'}</Button></div>}
    {report?.post.id===post.id&&<form className="community-report-form" onSubmit={sendReport}><label>举报原因<select aria-label="举报原因" value={report.category} onChange={event=>setReport({...report,category:event.target.value})}>{[['unsafe','不适宜内容'],['harassment','骚扰'],['copyright','侵权'],['spam','垃圾信息'],['other','其他']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>补充说明<textarea required maxLength={1000} value={report.details} onChange={event=>setReport({...report,details:event.target.value})}/></label><Button type="button" onClick={()=>setReport(null)}>取消</Button> <Button type="submit" disabled={Boolean(busy)}>提交举报</Button></form>}</article>)}</div>
    {cursor&&<div className="community-more"><Button disabled={loading} onClick={()=>load(true)}>{loading?'载入中…':'加载更多'}</Button></div>}</>}
  </section></CommunityShell>;
}
