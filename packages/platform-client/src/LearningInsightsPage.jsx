import React,{useEffect,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {usePlatformAssistant} from './PlatformAssistant.jsx';
import {requestHostAssistant} from './assistant-host-bridge.mjs';
import {cleanLearningContext,hostLearningPrompt} from '../../practice-core/src/agent-context.mjs';
import {LearningDataCard} from './PlatformAgentCards.jsx';

function initialQuery(){
  const outer=new URLSearchParams(globalThis.location?.search||''),embedded=outer.get('gh_route');
  const params=new URLSearchParams(embedded?.split('?')[1]||outer.toString());
  return {view:['summary','history','wrong'].includes(params.get('view'))?params.get('view'):'summary',days:[0,7,30,90,365].includes(Number(params.get('days')??30))?Number(params.get('days')??30):30,
    ...Object.fromEntries(['subjectId','stageId','topicId','difficultyId'].filter(k=>/^[a-zA-Z0-9._:-]{1,100}$/.test(params.get(k)||'')).map(k=>[k,params.get(k)])),limit:10,offset:0};
}
export default function LearningInsightsPage({api,accountProfile,go}) {
  const {locale}=useI18n(),en=locale==='en',assistant=usePlatformAssistant(),host=assistant?.host;
  const [query,setQuery]=useState(initialQuery),[state,setState]=useState({status:'loading'}),[catalog,setCatalog]=useState(null),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();api.getPracticeCatalog({}, {signal:controller.signal}).then(({data})=>setCatalog(data)).catch(()=>{});return()=>controller.abort();},[api]);
  useEffect(()=>{
    if(!accountProfile){setState({status:'signed-out'});return;}
    const controller=new AbortController();let live=true;setState({status:'loading'});setNotice('');
    api.getLearningInsights(query,{signal:controller.signal}).then(({data})=>{if(!live)return;const context=cleanLearningContext({kind:'learning-insights',version:1,requestId:crypto.randomUUID(),result:data});setState({status:'ready',data,context});
      if(assistant?.mode==='host'&&context&&window.parent!==window)window.parent.postMessage({type:'gamehub/learning.context',payload:context},'*');
    }).catch(error=>{if(live)setState({status:'error',message:error.message});});
    return()=>{live=false;controller.abort();if(assistant?.mode==='host'&&window.parent!==window)window.parent.postMessage({type:'gamehub/learning.context',payload:null},'*');};
  },[api,accountProfile?.id,query,revision,assistant?.mode]);
  const filter=(key,value)=>setQuery(q=>({...q,[key]:value,offset:0}));
  const askHost=async()=>{try{await requestHostAssistant(host,{intent:'learning-insights',context:state.context,prompt:hostLearningPrompt(state.context)});setNotice(en?'Sent to host chat.':'已交给宿主聊天。');}catch{setNotice(en?'Host chat unavailable. Copy the summary instead.':'宿主消息接口不可用，可复制摘要后粘贴到宿主聊天。');}};
  return <main className="page learning-insights-page"><header className="learning-hero"><div><span className="learning-kicker">MOOYU.FUN · LEARNING</span><h1>{en?'Your learning data':'个人学习数据'}</h1><p>{en?'Review real practice records and plan your next step.':'从真实练习记录出发，了解进展，安排下一步。'}</p></div><button onClick={()=>go('/learn/practice')}>{en?'Continue practice':'继续练习'} →</button></header>
    <div className="agent-insights-filters"><label>{en?'View':'查看'}<select aria-label={en?'View':'查看'} value={query.view} onChange={e=>filter('view',e.target.value)}><option value="summary">{en?'Overview':'学习概览'}</option><option value="history">{en?'Practice history':'练习历史'}</option><option value="wrong">{en?'Wrong answers':'错题记录'}</option></select></label>
    <label>{en?'Period':'时间范围'}<select aria-label={en?'Period':'时间范围'} value={query.days} onChange={e=>filter('days',Number(e.target.value))}>{[7,30,90,365,0].map(days=><option key={days} value={days}>{days?(en?`Last ${days} days`:`最近 ${days} 天`):(en?'All time':'全部时间')}</option>)}</select></label>
    {['subjectId','stageId','topicId','difficultyId'].map((key,index)=><label key={key}>{(en?['Subject','Stage','Topic','Difficulty']:['学科','学段','知识点','难度'])[index]}<select aria-label={key} value={query[key]||''} onChange={e=>filter(key,e.target.value)}><option value="">{en?'All':'全部'}</option>{(catalog?.[{subjectId:'subjects',stageId:'stages',topicId:'topics',difficultyId:'difficulties'}[key]]||[]).map(item=><option key={item.id} value={item.id}>{typeof item.title==='string'?item.title:item.title?.[en?'en':'zh-CN']||item.label?.[en?'en':'zh-CN']||item.name?.[en?'en':'zh-CN']||item.id}</option>)}</select></label>)}</div>
    {state.status==='loading'?<p role="status">{en?'Reading your records…':'正在读取你的学习记录…'}</p>:state.status==='signed-out'?<p>{en?'Sign in to read your learning data.':'登录后查看你自己的学习数据。'} <button onClick={()=>go('/account')}>{en?'Sign in':'登录'}</button></p>:state.status==='error'?<p role="alert">{state.message}<button onClick={()=>setRevision(r=>r+1)}>{en?'Retry':'重试'}</button></p>:<><LearningDataCard result={state.data} go={go}/>{query.view!=='summary'&&<nav className="agent-insights-pagination"><button disabled={!query.offset} onClick={()=>setQuery(q=>({...q,offset:Math.max(0,q.offset-10)}))}>{en?'Previous':'上一页'}</button><span>{query.offset/10+1}</span><button disabled={!state.data.pagination?.hasMore} onClick={()=>setQuery(q=>({...q,offset:q.offset+10}))}>{en?'Next':'下一页'}</button></nav>}
    {assistant?.mode==='host'&&state.context&&<div className="practice-assistant-actions"><button onClick={askHost}>{en?'Ask host Agent':'请宿主 Agent 分析'}</button><button onClick={async()=>{try{await navigator.clipboard.writeText(hostLearningPrompt(state.context));setNotice(en?'Copied':'已复制');}catch{setNotice(en?'Unable to copy':'复制失败');}}}>{en?'Copy learning summary':'复制学习摘要'}</button><small role="status">{notice}</small></div>}</>}
    {assistant?.mode==='host'&&<p className="agent-insights-note">{en?'A bounded learning summary is shared with this host conversation. Account credentials are never shared.':'本页受限的学习摘要会同步给当前宿主会话，账号凭据不会共享。'}</p>}
    <p className="agent-insights-note">{en?'Only platform practice is recorded here. Dates use a rolling day window; submitted batches use submission time. No courseware or game mastery is inferred.':'当前仅涵盖平台练习记录。时间范围按滚动天数计算，已提交练习以提交时间为准；不会推断课件或游戏的学习进度。'}</p>
  </main>;
}
