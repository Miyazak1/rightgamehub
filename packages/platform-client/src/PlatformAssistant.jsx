import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './I18n.jsx';
import { MathContent } from './PracticeMath.tsx';
import { assistantHostMode, hostPracticePrompt } from './assistant-context.mjs';
import { requestHostAssistant, syncHostAssistantContext } from './assistant-host-bridge.mjs';
import './PlatformAssistant.css';
import PlatformAgentCards from './PlatformAgentCards.jsx';
import {validAgentNavigation} from './agent-navigation.mjs';
import AvatarView from './AvatarView.jsx';

const Assistant = createContext(null);
export const usePlatformAssistant = () => useContext(Assistant);
const fresh = () => ({ conversationId:crypto.randomUUID(),messages: [], draft: '', open: false, width: 380, pinned: null });
const storageKey = owner => 'mooyu.assistant.v1:' + owner;
function restore(owner, mode) {
  if (!owner || mode !== 'platform') return fresh();
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(owner)) || 'null');
    if (!value || !Array.isArray(value.messages)) return fresh();
    return { ...fresh(),...( /^[a-f0-9-]{36}$/i.test(value.conversationId??'')?{conversationId:value.conversationId}:{}), draft: String(value.draft || '').slice(0,2000), open: value.open === true,
      width: Math.min(520,Math.max(300,Number(value.width)||380)), messages: value.messages.slice(-80)
        .filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string')
        .map(m => ({...m, status: m.status === 'pending'&&!m.interaction ? 'interrupted' : m.status})), pinned: null };
  } catch { return fresh(); }
}
const questionLabel = (context, en) => context ? (en ? `Question ${context.number}` : `第 ${context.number} 题`) : (en ? 'Platform' : '平台对话');

export function PlatformAssistantProvider({ children, api, avatarApi, profile, host, capabilities, owner, route, go }) {
  const mode = assistantHostMode(capabilities), {locale} = useI18n(), en = locale === 'en';
  const [state,setState] = useState(() => restore(owner,mode));
  const [practice,setPractice] = useState(null), [availability,setAvailability] = useState(null);
  const [hostNotice,setHostNotice] = useState('');
  const [navigation,setNavigation]=useState(null);const expectedNavigation=useRef(null);
  const pending = useRef(null), mounted = useRef(true), generation = useRef(0);
  const handledActions=useRef(new Set());
  const ownRoute = practice && route === '/learn/practice/' + practice.batchId ? practice : null;
  const pinnedCurrent=state.pinned&&ownRoute?.batchId===state.pinned.batchId&&ownRoute?.questionId===state.pinned.questionId;
  const context = pinnedCurrent ? ownRoute : state.pinned || ownRoute;
  useEffect(()=>{if(expectedNavigation.current?.route===route){setNavigation({...expectedNavigation.current,status:'opened'});expectedNavigation.current=null;}},[route]);
  const openCapability=useCallback(async capabilityId=>{
    const epoch=generation.current;setNavigation({status:'opening'});
    try {
      const {data}=await api.executeAgentTool('open_capability',{capabilityId,locale:en?'en':'zh-CN'});
      if(!mounted.current||generation.current!==epoch)return;
      if(!validAgentNavigation(data.action)||typeof go!=='function')throw Error('NAVIGATION_UNAVAILABLE');
      if(route===data.action.route){setNavigation({...data.action,status:'opened'});return;}
      expectedNavigation.current=data.action;setNavigation({...data.action,status:'opening'});go(data.action.route);
    } catch {if(mounted.current&&generation.current===epoch){expectedNavigation.current=null;setNavigation({status:'failed'});}}
  },[api,go,route,en]);
  const registerContext = useCallback(value => setPractice(value), []);
  const sharedPractice=useRef(false);
  // Clear our context before a new page's passive effects publish its own tool context.
  // Never overwrite another tool's context merely because this global provider mounted.
  useLayoutEffect(() => {
    if(mode==='host' && (ownRoute || sharedPractice.current)) {
      syncHostAssistantContext(host,ownRoute);sharedPractice.current=Boolean(ownRoute);
    }
  },[mode,host,ownRoute]);
  useEffect(() => { mounted.current=true; return () => {mounted.current=false;pending.current?.abort();}; }, []);
  // Owner and host changes remount this provider in the app; no transcript crosses an account boundary.
  useEffect(() => {
    if (mode !== 'platform' || !owner) return;
    try { sessionStorage.setItem(storageKey(owner), JSON.stringify({...state,pinned:null})); } catch {}
  }, [state,owner,mode]);
  useEffect(() => {
    if (mode !== 'platform' || !owner || !api.getAssistantCapabilities) return;
    const abort = new AbortController();
    api.getAssistantCapabilities({signal:abort.signal}).then(({data})=>setAvailability(data)).catch(()=>setAvailability({available:false}));
    return () => abort.abort();
  },[api,mode,owner]);
  const tracking=state.messages.filter(m=>m.interaction&&!['completed','failed','needs-review'].includes(m.interaction.state)||m.task&&!['completed','failed','needs-review'].includes(m.task.state)).map(m=>({messageId:m.id,root:m.interaction,task:m.task}));
  const trackingKey=JSON.stringify(tracking);
  useEffect(()=>{
    if(mode!=='platform'||!owner||!api.getAgentInteraction||!tracking.length)return;
    const controller=new AbortController(),epoch=generation.current;let timer;
    async function poll(){
      for(const item of JSON.parse(trackingKey)){
        const rootDone=['completed','failed','needs-review'].includes(item.root?.state),isTask=Boolean(item.task&&rootDone);
        const target=isTask?item.task.id:item.root?.id;if(!target)continue;
        try{const {data}=await api.getAgentInteraction(target,{signal:controller.signal});
          if(controller.signal.aborted||generation.current!==epoch||!mounted.current)return;
          const terminal=['completed','failed','needs-review'].includes(data.state);
          setState(s=>({...s,messages:s.messages.map(m=>m.id!==item.messageId?m:isTask?{...m,task:{...m.task,state:data.state,progress:data.progress},...(terminal?{taskResult:data.reply}:{})}:{...m,content:data.reply,status:terminal?'sent':'pending',interaction:{id:data.id,state:data.state},results:data.results??[],...(data.task?{task:data.task}:{})})}));
          if(!isTask&&terminal&&data.actions?.[0]?.capabilityId&&!handledActions.current.has(data.id)){handledActions.current.add(data.id);await openCapability(data.actions[0].capabilityId);}
        }catch(error){if(controller.signal.aborted)return;if([401,403,404].includes(error.status)){setState(s=>({...s,messages:s.messages.map(m=>m.id!==item.messageId?m:{...m,status:'sent',content:en?'Task access is unavailable.':'当前无法查看任务，请检查登录或授权。',interaction:{...m.interaction,state:'failed'},...(m.task?{task:{...m.task,state:'failed'}}:{})})}));}}
      }
      if(!controller.signal.aborted)timer=setTimeout(poll,2000);
    }
    poll();return()=>{controller.abort();clearTimeout(timer);};
  },[api,mode,owner,trackingKey,en,openCapability]);
  const send = useCallback(async (text, intent = 'chat', retry = null) => {
    if (mode !== 'platform' || !owner || availability?.available === false || pending.current || !text.trim()) return;
    const snapshot = retry && Object.hasOwn(retry,'context') ? retry.context : context;
    const history = retry?.history || state.messages.filter(m => ['user','assistant'].includes(m.role) && m.status === 'sent')
      .slice(-12).map(m => ({role:m.role,content:m.content.slice(0,2000),questionId:m.context?.questionId||null,
        ...(m.role==='assistant'&&/^[a-f0-9-]{36}$/i.test(m.id?.replace(/:reply$/,''))?{requestId:m.id.replace(/:reply$/,'')}:{})}));
    const requestId = availability?.mode==='agent'&&retry?.requestId?retry.requestId:crypto.randomUUID(), controller = new AbortController(), epoch = generation.current;
    pending.current = controller;
    const content = text.trim().slice(0,2000);
    const userMessage = {id:requestId,requestId,role:'user',content,context:snapshot,history,intent,status:'sent'};
    setState(s => ({...s,open:true,draft:retry ? s.draft : '',messages:[...s.messages.filter(m=>m.id!==retry?.id && (!retry?.id || m.id!==retry.id.replace(/:reply$/,''))),userMessage,
      {id:requestId+':reply',role:'assistant',content:'',context:snapshot,status:'pending',request:userMessage}].slice(-80)}));
    const settle = update => { if(mounted.current && generation.current===epoch)setState(s=>({...s,messages:s.messages.map(m=>m.id===requestId+':reply'?{...m,...update}:m)})); };
    try {
      const {data} = await api.sendAssistantMessage({requestId,...(availability?.mode==='agent'?{conversationId:state.conversationId}:{}),message: intent==='hint' ? '请给一小步提示，先不要直接给出答案。' : intent==='explain' ? '请解释这道题的解题过程。' : content,
        context:snapshot ? {batchId:snapshot.batchId,questionId:snapshot.questionId} : null,history},{signal:controller.signal});
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      settle({content:data.reply,status:data.interaction&&!['completed','failed','needs-review'].includes(data.interaction.state)?'pending':'sent',results:data.results||[],...(data.interaction?{interaction:data.interaction}:{}),...(data.task?{task:data.task}:{})});
      if(mounted.current&&generation.current===epoch&&data.actions?.[0]?.capabilityId)await openCapability(data.actions[0].capabilityId);
    } catch(error) { settle({content:error.name==='AbortError' ? (en?'Waiting stopped. The server may still finish this request.':'已停止等待，服务端可能仍在完成这次请求。') : (error.message || (en?'Unable to reply. Please retry.':'暂时无法回复，请重试。')),status:error.name==='AbortError'?'interrupted':'failed'}); }
    finally { if(pending.current===controller)pending.current=null; }
  },[mode,owner,availability,context,state.messages,state.conversationId,api,en,openCapability]);
  const askQuestion = useCallback(async (value,intent='hint') => {
    if(mode==='platform') { setState(s=>({...s,open:true,pinned:null})); await send(intent==='hint'?(en?'Give me a hint.':'给我一点提示。'):(en?'Explain this question.':'解释这道题。'),intent,{context:value}); return; }
    if(mode!=='host')return;
    setHostNotice(en?'Sending to host…':'正在交给宿主…');
    try { await requestHostAssistant(host,{context:value,intent,prompt:hostPracticePrompt(value,intent)}); setHostNotice(en?'Sent to your host chat.':'已交给宿主聊天。'); }
    catch { setHostNotice(en?'Host chat is unavailable. Copy the question context and paste it into your host chat.':'当前宿主未提供消息接口，请复制题目上下文后粘贴到宿主聊天。'); }
  },[mode,host,send,en]);
  const value = useMemo(()=>({state,setState,mode,context,registerContext,askQuestion,hostNotice,send,owner,availability,host,go,openCapability,navigation,
    profile:profile?.id===owner?profile:null,avatarApi,
    retryConnection:()=>{setAvailability(null);api.getAssistantCapabilities().then(({data})=>setAvailability(data)).catch(()=>setAvailability({available:false}));},
    stop:()=>{pending.current?.abort();setState(s=>({...s,messages:s.messages.map(m=>m.status==='pending'&&m.interaction?{...m,status:'interrupted'}:m)}));},newChat:()=>{generation.current++;pending.current?.abort();pending.current=null;expectedNavigation.current=null;setNavigation(null);setState(s=>({...fresh(),open:true,width:s.width}));},
    currentPractice:ownRoute}),[state,mode,context,registerContext,askQuestion,hostNotice,send,owner,availability,ownRoute,api,avatarApi,profile,host,go,openCapability,navigation]);
  return <Assistant.Provider value={value}>{children}</Assistant.Provider>;
}

export function AssistantToggle() {
  const assistant=usePlatformAssistant(),{locale}=useI18n();
  if(assistant?.mode!=='platform')return null;
  return <button className="assistant-toggle" aria-label={locale==='en'?'Mooyu assistant':'墨鱼助手'} title={locale==='en'?'Mooyu assistant':'墨鱼助手'} aria-controls="platform-assistant" aria-expanded={assistant.state.open}
    onClick={()=>assistant.setState(s=>({...s,open:!s.open}))}><span className="assistant-toggle-label">{locale==='en'?'Mooyu assistant':'墨鱼助手'}</span><span aria-hidden="true">◧</span></button>;
}

export function PracticeAssistantActions({context}) {
  const assistant=usePlatformAssistant(),{locale}=useI18n(),en=locale==='en';
  const [copied,setCopied]=useState(false);
  if(!assistant || !context || assistant.mode==='pending')return null;
  const host=assistant.mode==='host';
  return <div className="practice-assistant-actions"><button type="button" onClick={()=>assistant.askQuestion(context,context.checked?'explain':'hint')}>
    {host?(en?'Ask host Agent':'请宿主 Agent 帮我'):(en?'Ask about this question':'问这道题')}</button>
    {host && <><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(hostPracticePrompt(context,context.checked?'explain':'hint'));setCopied(true);}catch{setCopied(false);}}}>{copied?(en?'Copied':'已复制'):(en?'Copy question context':'复制题目上下文')}</button><small role="status">{assistant.hostNotice}</small></>}
  </div>;
}

export function AssistantWorkspace({children}) {
  const a=usePlatformAssistant(),{locale}=useI18n(),en=locale==='en',log=useRef(null),panel=useRef(null),lastFocus=useRef(null);
  const [resizing,setResizing]=useState(false);
  const followReplies=useRef(true),previousCount=useRef(0);
  const open=a?.mode==='platform'&&a.state.open;
  useEffect(()=>{
    if(!open || !window.visualViewport)return;
    const viewport=window.visualViewport;
    const update=()=>{if(!panel.current)return;panel.current.dataset.compact=String(viewport.height<600);panel.current.style.setProperty('--assistant-viewport-height',viewport.height+'px');panel.current.style.setProperty('--assistant-keyboard-offset',Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)+'px');};
    update();viewport.addEventListener('resize',update);viewport.addEventListener('scroll',update);
    return()=>{viewport.removeEventListener('resize',update);viewport.removeEventListener('scroll',update);};
  },[open]);
  useEffect(()=>{if(open){lastFocus.current=document.activeElement;panel.current?.focus();}else lastFocus.current?.focus?.();},[open]);
  useEffect(()=>{
    const count=a?.state.messages.length||0;
    if(count>previousCount.current)followReplies.current=true;
    previousCount.current=count;
    if(open&&log.current&&followReplies.current)log.current.scrollTop=log.current.scrollHeight;
  },[open,a?.state.messages.length,a?.state.messages.at(-1)?.status]);
  useEffect(()=>{
    if(!open||!log.current||typeof ResizeObserver!=='function')return;
    const observer=new ResizeObserver(()=>{if(followReplies.current&&log.current)log.current.scrollTop=log.current.scrollHeight;});
    observer.observe(log.current);return()=>observer.disconnect();
  },[open]);
  useEffect(()=>{
    if(!resizing)return;
    const move=e=>a.setState(s=>({...s,width:Math.min(520,Math.max(300,window.innerWidth-e.clientX))}));
    const end=()=>setResizing(false);window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);};
  },[resizing,a?.setState]);
  if(!a)return children;
  const pending=a.state.messages.some(m=>m.status==='pending');
  return <div className={'assistant-workspace'+(open?' is-open':'')} style={{'--assistant-width':a.state.width+'px'}}>
    <div className="assistant-main">{children}</div>
    {a.mode==='platform'&&<><div className="assistant-player-entry"><AssistantToggle/></div><aside id="platform-assistant" className="platform-assistant" ref={panel} tabIndex={-1} hidden={!open} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();a.setState(s=>({...s,open:false}));}}} aria-label={en?'Mooyu assistant':'墨鱼助手'}>
      <div className="assistant-resize" role="separator" aria-label={en?'Assistant width':'助手宽度'} aria-orientation="vertical" aria-valuemin={300} aria-valuemax={520} aria-valuenow={a.state.width} tabIndex={0}
        onPointerDown={e=>{e.preventDefault();setResizing(true);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();a.setState(s=>({...s,width:Math.min(520,Math.max(300,s.width+(e.key==='ArrowLeft'?20:-20)))}));}}}/>
      <header className="assistant-heading"><div className="assistant-brand"><span className="assistant-brand-mark" aria-hidden="true">✦</span><div><strong>{en?'Mooyu assistant':'墨鱼助手'}</strong><small>{en?'Your platform workspace':'全局对话'}</small></div></div><div className="assistant-heading-actions"><button onClick={a.newChat} disabled={pending} aria-label={en?'New chat':'新对话'} title={en?'New chat':'新对话'}>＋</button><button aria-label={en?'Close assistant':'收起助手'} title={en?'Close assistant':'收起助手'} onClick={()=>a.setState(s=>({...s,open:false}))}>×</button></div></header>
      <div className="assistant-context"><div className="assistant-context-label"><span aria-hidden="true">{a.context?'▤':'◈'}</span><strong>{questionLabel(a.context,en)}{a.context?.total?' / '+a.context.total:''}</strong></div>
        <p>{a.context?.prompt || (en?'Learning, games and tools in one workspace.':'学习、游戏和工具，共用一个对话工作区。')}</p>
        {a.context&&<button onClick={()=>a.setState(s=>({...s,pinned:s.pinned?null:a.context}))}>{a.state.pinned?(en?'Unpin · Follow page':'取消固定 · 跟随页面'):(en?'Following page · Pin':'跟随页面 · 固定此题')}</button>}
      </div>
      <div className="assistant-messages" ref={log} onScroll={e=>{const el=e.currentTarget;followReplies.current=el.scrollHeight-el.scrollTop-el.clientHeight<60;}} role="log" aria-live="polite" aria-relevant="additions text">
        {!a.state.messages.length&&<div className="assistant-empty"><span className="assistant-empty-mark" aria-hidden="true">✦</span><strong>{en?'Where shall we start?':'从哪里开始？'}</strong><p>{en?'Ask for a small hint, or talk through a step. Your conversation stays here as you move between pages.':'想要一点提示，还是一起理清某一步？切换页面时，对话会留在这里。'}</p></div>}
        {a.state.messages.map(m=><article key={m.id} className={'assistant-message is-'+m.role+' is-'+m.status}>
          <small>{m.role==='user'?<span className="assistant-user-avatar"><AvatarView avatar={a.profile?.avatar} api={a.avatarApi} alt={en?'Your avatar':'你的头像'}/></span>:<span className="assistant-message-mark" aria-hidden="true">✦</span>}{m.role==='user'?(a.profile?.displayName||(en?'You':'你')):(en?'Mooyu':'墨鱼')}<span className="assistant-message-scope">{questionLabel(m.context,en)}</span></small>
          {m.status==='pending'?<p role="status" className="assistant-thinking">{en?'Thinking…':'正在思考…'}</p>:<div className="assistant-message-body"><MathContent text={m.content} formatPlainMath/></div>}
          {m.role==='assistant'&&m.status==='sent'&&<PlatformAgentCards results={m.results} go={a.go} openCapability={a.openCapability} disabled={pending||a.navigation?.status==='opening'}/>}
          {m.task&&<div className="assistant-task" role="status"><small>{en?'Agent task':'小墨鱼任务'} · {({queued:'排队中',running:'执行中',waiting:'等待恢复',completed:'已完成',failed:'未完成','needs-review':'待核对'})[m.task.state]??m.task.state}{m.task.progress?.total?' · '+m.task.progress.completed+'/'+m.task.progress.total:''}</small><p>{m.taskResult||m.task.id}</p></div>}
          {['failed','interrupted'].includes(m.status)&&<button disabled={pending} onClick={()=>a.send(m.request.content,m.request.intent||'chat',{...m.request,id:m.id})}>{en?'Retry':'重试'}</button>}
        </article>)}
      </div>
      <div className="assistant-input-area">
        {a.navigation&&<p className="agent-navigation-status" role="status">{a.navigation.status==='opened'?(en?'Opened: ':'已打开：')+a.navigation.title:a.navigation.status==='opening'?(en?'Opening…':'正在打开…'):(en?'Could not open this content. Try again.':'未能打开该内容，请重试。')}</p>}
        {!a.context&&<div className="assistant-suggestions"><button disabled={pending||!a.owner||a.availability?.available===false} onClick={()=>a.send(en?'Find a short puzzle game.':'帮我找一个短时间能玩的益智游戏。')}>{en?'Find a game':'找个游戏'}</button><button disabled={pending||!a.owner||a.availability?.available===false} onClick={()=>a.send(en?'Show my learning summary for the last 30 days.':'看看我最近30天的学习情况。')}>{en?'My learning':'我的学习'}</button></div>}
        {!a.owner?<p>{en?'Sign in to chat with Mooyu.':'登录后与墨鱼助手交流。'}</p>:a.availability?.available===false?<p role="status">{en?'Assistant is currently unavailable. Your conversation is preserved.':'助手暂不可用，对话已保留。'} <button type="button" onClick={a.retryConnection}>{en?'Reconnect':'重新连接'}</button></p>:null}
        {a.context&&<div className="assistant-suggestions"><button disabled={pending||!a.owner||a.availability?.available===false} onClick={()=>a.send(en?'Give me a hint.':'给我一点提示。','hint')}>{en?'Small hint':'给一点提示'}</button>{a.context.checked&&<button disabled={pending||!a.owner||a.availability?.available===false} onClick={()=>a.send(en?'Explain this question.':'解释这道题。','explain')}>{en?'Explain':'讲解思路'}</button>}</div>}
        <form onSubmit={e=>{e.preventDefault();a.send(a.state.draft);}}><label className="assistant-input-label" htmlFor="assistant-draft">{en?'Message Mooyu':'向墨鱼提问'}</label><textarea id="assistant-draft" maxLength={2000} rows={3} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();if(!pending)a.send(a.state.draft);}}} value={a.state.draft} placeholder={a.context?(en?'Ask about this question…':'这道题，哪里还没想明白？'):(en?'Ask Mooyu…':'有什么想和墨鱼聊聊？')} onChange={e=>a.setState(s=>({...s,draft:e.target.value}))}/><div><small>{a.context?(en?'Question attached':'已附当前题目'):(en?'Platform conversation':'平台对话')}</small>{pending?<button type="button" className="assistant-send" onClick={a.stop}>{en?'Stop waiting':'停止等待'}</button>:<button type="submit" className="assistant-send" disabled={!a.owner||!a.state.draft.trim()||a.availability?.available===false}>{en?'Send ↑':'发送 ↑'}</button>}</div></form>
        <small className="assistant-retention">{a.availability?.mode==='agent'?(en?'Tasks are saved on the server. Closing chat does not cancel them.':'任务已在服务端保存，收起对话不会取消任务。'):(en?'Stored in this tab · Model replies may be imperfect':'当前标签页保存 · 模型回答仅供参考')}</small>
      </div>
    </aside></>}
  </div>;
}
