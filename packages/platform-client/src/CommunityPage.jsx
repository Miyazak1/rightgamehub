import React,{useCallback,useEffect,useRef,useState} from 'react';
import { CommunityShell } from './CommunityShell.jsx';
import CommunityIdentity from './CommunityIdentity.jsx';
import {copyCommunityPostLink} from './community-share.mjs';
import {useI18n} from './I18n.jsx';
const labelKeys={game:'community.channel.game',ai:'community.channel.ai',computing:'community.channel.computing'};
const statusKeys={draft:'community.status.draft',pending:'community.status.pending',approved:'community.status.approved',rejected:'community.status.rejected',superseded:'community.status.superseded'};
const newKey=()=>crypto.randomUUID();
const blank=(projectId=null)=>({channel:'game',title:'',blocks:[{type:'paragraph',text:''}],projectId});
const Button=({children,primary=false,...props})=><button className={'button button--'+(primary?'primary':'secondary')} {...props}>{children}</button>;
function ActionIcon({type,active=false}) {
  if(type==='like')return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.2 4.7 13A4.8 4.8 0 0 1 11.5 6.2l.5.6.5-.6A4.8 4.8 0 0 1 19.3 13Z" fill={active?'currentColor':'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if(type==='share')return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8 12 5l3 3M12 5v10M7 11H5.5A2.5 2.5 0 0 0 3 13.5v4A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-4a2.5 2.5 0 0 0-2.5-2.5H17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 17l-5.5 3.5Z" fill={active?'currentColor':'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}
const failure=(error,t)=>error.status===401?t('community.signInFirst'):error.message||t('community.operationFailed');
const postingMessage=(reason,t)=>({AUTH_REQUIRED:'community.posting.auth',ACCOUNT_UNAVAILABLE:'community.posting.account',POSTING_PAUSED:'community.posting.paused',POSTING_RESTRICTED:'community.posting.restricted'}[reason]||'community.posting.unavailable');

function ImageBlock({api,block,preview=false,variant='thumb'}) {
  const {t}=useI18n();
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
  return <figure ref={element} className="community-image">{state.url?<img src={state.url} alt={block.alt||t('community.imageAlt')} loading="lazy"/>:<div role="status">{t(state.error?'community.imageUnavailable':'community.imageLoading')}</div>}{block.alt&&<figcaption>{block.alt}</figcaption>}</figure>;
}
function Blocks({post,api,preview=false,full=false}) {
  const {t}=useI18n();
  const seen=new Set(),blocks=full||preview?post.blocks:post.blocks.filter(block=>{if(seen.has(block.type))return false;seen.add(block.type);return true;}).slice(0,3);
  return <div className={`community-blocks${full||preview?'':' is-preview'}`}>{blocks.map((block,index)=>block.type==='paragraph'?<p key={index}>{block.text}</p>:block.type==='link'?<a className="community-source" key={index} href={block.url} target="_blank" rel="noopener noreferrer"><span>↗</span><span><strong>{block.label||t('community.viewSource')}</strong><small>{new URL(block.url).hostname}</small></span></a>:block.type==='image'?<ImageBlock key={block.assetId} api={api} block={block} preview={preview} variant={full?'display':'thumb'}/>:null)}</div>;
}
function Editor({api,initial,capabilities,onDone,onCancel,demo=false,seedProjectId=null}) {
  const {t}=useI18n();
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
      if(!draft.title.trim())throw Error(t('community.validationTitle'));
      let current=post;
      const blocks=draft.blocks.filter(block=>block.type!=='paragraph'||block.text.trim());
      if(!blocks.length&&!files.length)throw Error(t('community.validationContent'));
      if(!current){
        setMessage(t('community.savingDraft'));
        const seed={...draft,blocks:blocks.length?blocks:[{type:'paragraph',text:draft.title}]};
        current=(await api.communitySave(null,seed,{key:keyFor(JSON.stringify(seed)),signal})).data;
        setPost(current);
      }
      const imageBlocks=[];
      for(const file of files) {
        setMessage(t('community.processingImage',{name:file.name}));
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
          if(['failed','deleted','deleting'].includes(status.state))throw Error(t('community.imageProcessingFailed'));
          if(attempt===44)throw Error(t('community.imageQueued'));
          await new Promise(resolve=>setTimeout(resolve,1000));
          if(signal.aborted)throw Error(t('community.cancelled'));
        }
        imageBlocks.push({type:'image',assetId:asset.id,alt:file.name.replace(/\.[^.]+$/,'').slice(0,120)});
      }
      const body={...draft,blocks:[...blocks,...imageBlocks]};
      const unchanged=current.channel===body.channel&&current.title===body.title&&JSON.stringify(current.blocks)===JSON.stringify(body.blocks)&&(current.project?.id||null)===(body.projectId||null);
      if(!unchanged||['superseded','approved'].includes(current.reviewStatus)){
        setMessage(t('community.savingContent'));
        current=(await api.communitySave(current.id,body,{version:current.version,key:keyFor(current.id+':'+current.version+':'+JSON.stringify(body)),signal})).data;
        setPost(current);setDraft(body);setFiles([]);
      }
      if(submit&&current.reviewStatus!=='pending') {
        setMessage(t('community.submitting'));
        current=(await api.communitySubmit(current,{key:keyFor('submit:'+current.id+':'+current.version),signal})).data;setPost(current);
      }
      onDone(t(submit?'community.submitted':'community.draftSaved'));
    }catch(caught){if(!signal.aborted)setError(failure(caught,t));}
    finally{running.current=false;if(!signal.aborted){setBusy(false);setMessage('');}}
  }
  return <section className="community-editor panel" aria-labelledby="community-editor-title"><div className="community-card-head"><h2 id="community-editor-title">{t(initial?'community.editorTitle':'community.editorNew')}</h2><Button disabled={busy} onClick={onCancel}>{t('community.close')}</Button></div><p className="community-muted">{t('community.editorPrivacy')}</p>
    <fieldset disabled={busy}><label>{t('community.titleLabel')}<input maxLength={120} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})} placeholder={t('community.titlePlaceholder')}/></label><label>{t('community.topic')}<select aria-label={t('community.topic')} value={draft.channel} onChange={event=>setDraft({...draft,channel:event.target.value})}>{Object.entries(labelKeys).map(([key,name])=><option key={key} value={key}>{t(name)}</option>)}</select></label><label>{t('community.relatedProject')}<select aria-label={t('community.relatedProject')} value={draft.projectId||''} onChange={event=>setDraft({...draft,projectId:event.target.value||null})}><option value="">{t('community.normalPost')}</option>{projects.filter(project=>['recruiting','active','completed'].includes(project.status)).map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
    {draft.blocks.map((block,index)=><div className="community-edit-block" key={index}>{block.type==='paragraph'?<label>{t('community.text')}<textarea maxLength={4000} rows={4} value={block.text} onChange={event=>change(index,{text:event.target.value})} placeholder={t('community.textPlaceholder')}/></label>:block.type==='link'?<><label>{t('community.sourceLink')}<input type="url" placeholder="https://" value={block.url} onChange={event=>change(index,{url:event.target.value})}/></label><label>{t('community.linkLabel')}<input maxLength={160} value={block.label||''} onChange={event=>change(index,{label:event.target.value})}/></label></>:<><ImageBlock api={api} block={block} preview/><label>{t('community.imageDescription')}<input maxLength={240} value={block.alt} onChange={event=>change(index,{alt:event.target.value})}/></label></>}<button type="button" className="community-text-button" onClick={()=>setDraft({...draft,blocks:draft.blocks.filter((_,at)=>at!==index)})}>{t(block.type==='image'?'community.removeImage':'community.removeBlock')}</button></div>)}
    <div className="community-actions"><Button disabled={draft.blocks.length>=32} onClick={()=>setDraft({...draft,blocks:[...draft.blocks,{type:'paragraph',text:''}]})}>{t('community.addText')}</Button><Button disabled={draft.blocks.filter(b=>b.type==='link').length>=3} onClick={()=>setDraft({...draft,blocks:[...draft.blocks,{type:'link',url:'',label:''}]})}>{t('community.addLink')}</Button>{capabilities.imagesEnabled&&<label className="community-file">{t('community.addImage')}<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event=>{const selected=Array.from(event.target.files||[]);event.target.value='';if(selected.some(file=>file.size>2097152||!['image/jpeg','image/png','image/webp'].includes(file.type))){setError(t('community.imageRules'));return;}if(files.length+selected.length+draft.blocks.filter(b=>b.type==='image').length>3){setError(t('community.imageCount'));return;}setFiles([...files,...selected]);}}/></label>}</div>
    {files.map((file,index)=><div className="community-file-row" key={index}><span>{file.name}</span><button type="button" onClick={()=>setFiles(files.filter((_,at)=>at!==index))}>{t('community.remove')}</button></div>)}
    <small className="community-muted">{t('community.editorLimits',{images:capabilities.imagesEnabled})}</small></fieldset>
    {error&&<p className="form-error" role="alert">{error}</p>}<p role="status">{message}</p><div className="community-actions"><Button disabled={busy} onClick={()=>persist(false)}>{t('community.saveDraft')}</Button><Button primary disabled={busy} onClick={()=>persist(true)}>{t(busy?'community.processing':'community.submitPost')}</Button></div>
  </section>;
}
function ReviewCard({post,api,go,AvatarView,onChanged,onError}) {
  const {t}=useI18n();
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  const keys=useRef(new Map());
  async function decide(action) {
    if(!reason.trim()){onError('请填写处理理由。');return;}
    setBusy(true);
    const signature=post.id+post.version+action+reason;
    if(!keys.current.has(signature))keys.current.set(signature,newKey());
    try{await api.communityDecide(post,{action,reason},{key:keys.current.get(signature)});onChanged();}
    catch(error){onError(failure(error,t));}finally{setBusy(false);}
  }
  return <article className="community-card panel"><div className="community-card-head"><span className="community-tag">{t(statusKeys[post.reviewStatus])}</span><span>{post.moderationState==='hidden'?t('community.hidden'):''}</span></div><h2>{post.title}</h2><CommunityIdentity person={post.author} AvatarView={AvatarView} api={api} go={go} showHandle/><p className="community-muted">User ID · {post.author.id}</p><Blocks post={post} api={api} preview full/>{post.publishedContent&&post.publishedContent.revisionId!==post.revisionId&&<details><summary>查看当前公开版本（举报对应内容）</summary><h3>{post.publishedContent.title}</h3><Blocks post={post.publishedContent} api={api} preview full/></details>}{post.reports?.map(report=><p className="community-report" key={report.id}>举报 · {report.category}：{report.details}</p>)}<label>处理理由<textarea maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><div className="community-actions">{post.reviewStatus==='pending'&&<><Button disabled={busy} primary onClick={()=>decide('approve')}>通过此版本</Button><Button disabled={busy} onClick={()=>decide('reject')}>退回修改</Button></>}<Button disabled={busy} onClick={()=>decide(post.moderationState==='hidden'?'restore':'hide')}>{post.moderationState==='hidden'?'恢复可见':'隐藏分享'}</Button>{post.reports?.length>0&&<Button disabled={busy} onClick={()=>decide('dismiss_reports')}>驳回举报</Button>}</div></article>;
}
function PostingRestrictions({api,onNotice,onError}) {
  const {t}=useI18n();
  const [id,setId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  async function save(allowed){setBusy(true);try{await api.communityMember(id,{allowed,reason});onNotice(allowed?'投稿限制已解除。':'已限制该账号投稿。');}catch(error){onError(failure(error,t));}finally{setBusy(false);}}
  return <details className="community-members panel"><summary>投稿限制管理</summary><p className="community-muted">正常登录用户默认可投稿。按用户 ID 限制违规账号，或解除已有投稿限制；内容仍需审核。</p><label>用户 ID<input value={id} onChange={event=>setId(event.target.value.trim())}/></label><label>调整原因<input maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label><div className="community-actions"><Button disabled={busy||!id||!reason.trim()} onClick={()=>save(false)}>限制投稿</Button><Button disabled={busy||!id||!reason.trim()} onClick={()=>save(true)}>解除投稿限制</Button></div></details>;
}
export default function CommunityPage({api,go,route,accountProfile,AvatarView,demo=false,embedded=false}) {
  const {t,date}=useI18n();
  const when=value=>value?date(value,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):t('community.notPublished');
  const editorRoute=route==='/community/feed/new'||route.startsWith('/community/feed/new/project/'),seedProjectId=route.match(/^\/community\/feed\/new\/project\/([^/]+)$/)?.[1]||null;
  const [cap,setCap]=useState(null),[items,setItems]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[editor,setEditor]=useState(editorRoute?'new':null),[report,setReport]=useState(null),[confirm,setConfirm]=useState(null),[shared,setShared]=useState('');
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
    }catch(caught){if(current===generation.current)setError(failure(caught,t));}
    finally{if(current===generation.current)setLoading(false);}
  },[api,mode,channel,detail,author,cursor,demo]);
  useEffect(()=>{setItems([]);setCursor(null);setEditor(editorRoute?'new':null);setReport(null);setConfirm(null);load();return()=>{generation.current++;};},[api,mode,channel,detail,author,demo,route]);
  async function interact(post,type) {
    if(busy)return;setBusy(post.id);setError('');
    const property=type==='like'?'liked':'bookmarked',active=!post[property];
    try{
      await api.communityInteract(post.id,type,active);
      setItems(values=>values.filter(p=>!(mode==='bookmarks'&&p.id===post.id&&type==='bookmark'&&!active)).map(p=>p.id===post.id?{...p,[property]:active,likeCount:type==='like'?String(BigInt(p.likeCount)+(active?1n:-1n)):p.likeCount}:p));
    }catch(caught){setError(failure(caught,t));}finally{setBusy('');}
  }
  async function edit(post) {setBusy(post.id);try{setEditor((await api.communityPost(post.id,{manage:true})).data);}catch(caught){setError(failure(caught,t));}finally{setBusy('');}}
  async function remove() {
    setBusy(confirm.post.id);try{await api.communityWithdraw(confirm.post,confirm.remove);setConfirm(null);setNotice(t(confirm.remove?'community.shareDeleted':'community.shareWithdrawn'));await load();}catch(caught){setError(failure(caught,t));}finally{setBusy('');}
  }
  async function sendReport(event){event.preventDefault();setBusy(report.post.id);try{await api.communityReport(report.post.id,{category:report.category,details:report.details});setReport(null);setNotice(t('community.reportSubmitted'));}catch(caught){setError(failure(caught,t));}finally{setBusy('');}}
  async function share(post) {
    setError('');
    const result=await copyCommunityPostLink({location:globalThis.location,clipboard:globalThis.navigator?.clipboard,prompt:globalThis.prompt,promptLabel:t('community.copyPostLink')},post.id);
    if(result.copied){
      setShared(post.id);setNotice(t('community.linkCopied'));
      globalThis.setTimeout?.(()=>setShared(current=>current===post.id?'':current),1800);
    }else if(result.method==='prompt')setNotice(t('community.copyManually'));
    else setError(t('community.copyFailed'));
  }
  const content=<section className={`community-page${home?' is-home':''}${mode==='feed'?' is-feed':''}`}>
    {home&&<section className="community-home-intro" aria-labelledby="community-home-title"><div className="community-home-intro__copy"><span className="kicker">WHAT IS HAPPENING</span><h2 id="community-home-title">{t('community.homeQuestion')}</h2><p>{t('community.homeQuestionLead')}</p></div><div className="community-home-paths"><button type="button" className="is-project" onClick={()=>go('/community/projects')}><span aria-hidden="true">↗</span><strong>{t('community.buildTogether')}</strong><small>{t('community.buildTogetherLead')}</small><em>{t('community.viewProjectsTasks')}</em></button><button type="button" className="is-feed" onClick={()=>go('/community/feed')}><span aria-hidden="true">✦</span><strong>{t('community.viewFeed')}</strong><small>{t('community.viewFeedLead')}</small><em>{t('community.enterFeed')}</em></button></div><div className="community-home-future" aria-label={t('community.overview')}><span><i aria-hidden="true">◫</i><b>{t('community.onlineEvents')}</b><small>{t('community.onlineEventsLead')}</small></span><span><i aria-hidden="true">◉</i><b>{t('community.gameParties')}</b><small>{t('community.gamePartiesLead')}</small></span><em>{t('community.phasedOpening')}</em></div></section>}
    {!home&&!detail&&!author&&<header className="community-section-heading"><div><span className="kicker">{mode==='mine'?'MY COMMUNITY':mode==='bookmarks'?'SAVED FOR LATER':mode==='review'?'COMMUNITY REVIEW':'COMMUNITY FEED'}</span><h2>{t(mode==='mine'?'community.mineTitle':mode==='bookmarks'?'community.savedTitle':mode==='review'?'community.reviewTitle':'community.feedTitle')}</h2><p>{t(mode==='mine'?'community.mineLead':mode==='bookmarks'?'community.savedLead':mode==='review'?'community.reviewLead':'community.feedLead')}</p></div>{mode==='feed'&&<Button primary disabled={Boolean(accountProfile)&&!cap?.canShare} onClick={()=>cap?.canShare?setEditor('new'):go('/account')}>{t(cap?.canShare?'community.publish':accountProfile?cap?.reason==='POSTING_RESTRICTED'?'community.postRestricted':'community.postUnavailable':'community.signInParticipate')}</Button>}</header>}
    {['mine','bookmarks'].includes(mode)&&<nav className="community-personal-nav" aria-label={t('community.participationTitle')}><button className={mode==='mine'?'is-active':''} onClick={()=>go('/community/me')}>{t('community.myShares')}</button><button className={mode==='bookmarks'?'is-active':''} onClick={()=>go('/community/bookmarks')}>{t('community.privateSaved')}</button><button onClick={()=>go('/community/projects')}>{t('community.myTasks')}</button></nav>}
    {notice&&<p className="social-notice" role="status">{notice}</p>}{error&&<div className="community-error" role="alert"><p>{error}</p><Button onClick={()=>load()}>{t('community.reload')}</Button>{!accountProfile&&<Button onClick={()=>go('/account')}>{t('community.login')}</Button>}</div>}
    {editor&&cap?.canShare&&<Editor key={(editor.id||'new')+':'+(seedProjectId||'none')} api={api} initial={editor==='new'?null:editor} seedProjectId={seedProjectId} capabilities={cap} demo={demo} onCancel={()=>{setEditor(null);if(editorRoute)go('/community/feed');}} onDone={message=>{setEditor(null);setNotice(message);if(mode==='mine')load();else go('/community/me');}}/>}
    {cap&&!cap.readEnabled?<section className="community-empty panel"><span aria-hidden="true">◇</span><h2>{t(demo?'community.previewTitle':'community.comingTitle')}</h2><p>{t(demo?'community.previewLead':'community.comingLead')}</p><Button onClick={()=>go('/discover')}>{t('community.discoverGames')}</Button></section>:<>
    {author&&<p className="community-muted">{t('community.publicPosts')}</p>}{mode==='feed'&&!detail&&!author&&<div className="community-feed-head"><div><span className="kicker">{home?'LATEST FROM THE COMMUNITY':'BROWSE BY TOPIC'}</span><h2>{t(home?'community.latest':'community.browseTopics')}</h2></div><div className="filter-row" aria-label={t('community.browseTopics')}>{[[null,'community.allTopics'],...Object.entries(labelKeys)].map(([key,name])=><button key={key||'all'} className={channel===key?'is-active':''} onClick={()=>go('/community/feed'+(key?'/'+key:''))}>{t(name)}</button>)}<span className="community-sort">{t('community.latestPublished')}</span></div></div>}
    {mode==='bookmarks'&&<p className="community-muted">{t('community.savedPrivacy')}</p>}
    {cap&&!cap.canShare&&<p className="community-muted" role="status">{t(postingMessage(cap.reason,t))}</p>}
    {mode==='review'&&cap?.isAdmin&&<PostingRestrictions api={api} onNotice={setNotice} onError={setError}/>}
    {loading&&!items.length?<p className="community-empty" role="status">{t('community.loadingPosts')}</p>:!error&&!items.length?<section className="community-empty panel"><span aria-hidden="true">✧</span><h2>{t(mode==='mine'?'community.emptyMineTitle':mode==='bookmarks'?'community.emptySavedTitle':mode==='review'?'community.emptyReviewTitle':'community.emptyFeedTitle')}</h2><p>{t(mode==='bookmarks'?'community.emptySavedLead':mode==='mine'?'community.emptyMineLead':mode==='review'?'community.emptyReviewLead':'community.emptyFeedLead')}</p></section>:null}
    <div className="community-feed">{items.map(post=>mode==='review'?<ReviewCard key={post.id+post.version} post={post} api={api} go={go} AvatarView={AvatarView} onChanged={()=>load()} onError={setError}/>:<article className={`community-card panel${detail?' is-detail':''}`} key={post.id}><div className="community-card-head"><span className="community-tag">{t(labelKeys[post.channel])}</span><time dateTime={post.publishedAt||post.updatedAt}>{when(mode==='mine'?post.updatedAt:post.publishedAt)}</time></div><h2>{mode==='mine'?post.title:<button onClick={()=>go('/community/posts/'+post.id)}>{post.title}</button>}</h2><button className="community-author" disabled={!post.author.handle} onClick={()=>go('/u/'+post.author.handle)}>{AvatarView?<AvatarView avatar={post.author.avatar} api={api} alt=""/>:<span className="community-author__fallback" aria-hidden="true">{post.author.displayName.slice(0,1)}</span>}<span className="community-author__copy"><strong>{post.author.displayName}</strong>{post.author.handle&&<small>@{post.author.handle}</small>}</span></button>{post.project&&<button type="button" className="community-post-project" onClick={()=>go(`/community/projects/${post.project.id}`)}>{t('community.fromProject',{title:post.project.title})}</button>}{mode==='mine'&&<p className="community-muted">{post.publicationState==='withdrawn'?t('community.withdrawn')+' · ':post.publicationState==='published'?t('community.publicVersion')+' · ':''}{t(statusKeys[post.reviewStatus])}{post.moderationState==='hidden'?' · '+t('community.hidden'):''}{post.reviewReason?' · '+post.reviewReason:''}</p>}<Blocks post={post} api={api} preview={mode==='mine'} full={Boolean(detail)}/><footer className="community-actions">{mode==='mine'?<><Button disabled={busy===post.id||!cap?.canShare} onClick={()=>edit(post)}>{t('community.edit')}</Button>{post.publicationState==='published'&&<Button disabled={Boolean(busy)} onClick={()=>setConfirm({post,remove:false})}>{t('community.withdraw')}</Button>}<Button disabled={Boolean(busy)} onClick={()=>setConfirm({post,remove:true})}>{t('community.delete')}</Button></>:<>{!detail&&<button className="community-read-button" onClick={()=>go('/community/posts/'+post.id)}>{t('community.readFull')} <span aria-hidden="true">→</span></button>}<button className="community-action-button" disabled={Boolean(busy)} aria-label={t('community.likeAria',{count:post.likeCount})} aria-pressed={post.liked} onClick={()=>interact(post,'like')}><ActionIcon type="like" active={post.liked}/><span>{t('community.like')}</span><b>{post.likeCount}</b></button><button className="community-action-button" disabled={Boolean(busy)} aria-label={t(post.bookmarked?'community.unbookmark':'community.bookmark')} aria-pressed={post.bookmarked} onClick={()=>interact(post,'bookmark')}><ActionIcon type="bookmark" active={post.bookmarked}/><span>{t(post.bookmarked?'community.bookmarked':'community.bookmark')}</span></button><button className="community-action-button" aria-label={t('community.sharePost')} onClick={()=>share(post)}><ActionIcon type="share"/><span>{t(shared===post.id?'community.copied':'community.share')}</span></button><button className="community-report-button" onClick={()=>setReport({post,category:'other',details:''})}>{t('community.report')}</button></>}</footer>
    {confirm?.post.id===post.id&&<div className="community-confirm" role="group" aria-label={t('community.confirmAction')}><p>{t(confirm.remove?'community.deleteConfirm':'community.withdrawConfirm')}</p><Button disabled={Boolean(busy)} onClick={()=>setConfirm(null)}>{t('community.cancel')}</Button> <Button disabled={Boolean(busy)} onClick={remove}>{t(confirm.remove?'community.confirmDelete':'community.confirmWithdraw')}</Button></div>}
    {report?.post.id===post.id&&<form className="community-report-form" onSubmit={sendReport}><label>{t('community.reportReason')}<select aria-label={t('community.reportReason')} value={report.category} onChange={event=>setReport({...report,category:event.target.value})}>{[['unsafe','community.reportUnsafe'],['harassment','community.reportHarassment'],['copyright','community.reportCopyright'],['spam','community.reportSpam'],['other','community.reportOther']].map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label><label>{t('community.reportDetails')}<textarea required maxLength={1000} value={report.details} onChange={event=>setReport({...report,details:event.target.value})}/></label><Button type="button" onClick={()=>setReport(null)}>{t('community.cancel')}</Button> <Button type="submit" disabled={Boolean(busy)}>{t('community.submitReport')}</Button></form>}</article>)}</div>
    {cursor&&<div className="community-more"><Button disabled={loading} onClick={()=>load(true)}>{t(loading?'community.loadingMore':'community.loadMore')}</Button></div>}</>}
  </section>;
  return embedded?content:<CommunityShell route={route} go={go}>{content}</CommunityShell>;
}
