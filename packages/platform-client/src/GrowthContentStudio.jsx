import React,{useEffect,useMemo,useState} from 'react';
import {buildXhsDraft} from './growth-content-copy.mjs';

const slides=[
  ['cover','01','封面','用一句话抓住注意力'],
  ['overview','02','推荐理由','说明它为什么值得玩'],
  ['play','03','快速上手','把开始门槛降到最低'],
  ['source','04','作者与来源','保留作者、仓库与许可信息'],
  ['cta','05','行动页','告诉读者去哪里免费体验'],
];

const fallbackDemo={id:'gamehub-guess-baike',title:'猜百科',kind:'game',description:'从中文维基百科的线索中逐字揭开答案，看看你能多快猜中。',estimatedMinutes:5,openSource:true,licenseSpdx:'MIT',repositoryUrl:'https://github.com/gamehub/example',tags:['推理','每日一题']};

export default function GrowthContentStudio({api,demo,demoWorks=[]}){
  const [state,setState]=useState({status:'loading',works:[]});
  const [selectedId,setSelectedId]=useState('');
  const [active,setActive]=useState('cover');
  const [message,setMessage]=useState('');
  const load=async()=>{
    try{
      const works=demo?(demoWorks.length?demoWorks:[fallbackDemo]):(await api.listWorks({limit:50})).data;
      setState({status:'ready',works});setSelectedId(current=>current||works[0]?.id||'');
    }catch{setState({status:'error',works:[]});}
  };
  useEffect(()=>{load();},[api,demo]);
  const work=state.works.find(item=>item.id===selectedId)||state.works[0];
  const origin=globalThis.location?.origin||'https://mooyu.fun';
  const draft=useMemo(()=>work?buildXhsDraft(work,{origin}):null,[work,origin]);
  const copy=async(value,label)=>{try{await navigator.clipboard.writeText(value);setMessage(`${label}已复制。`);}catch{setMessage('无法写入剪贴板，请检查浏览器权限。');}};
  if(state.status==='loading')return <section className="growth-studio"><p role="status">正在准备传播素材…</p></section>;
  if(state.status==='error')return <section className="growth-studio"><p role="alert">传播素材暂时无法读取，请稍后重试。</p></section>;
  if(!work)return <section className="growth-studio"><p>还没有可以制作传播素材的公开作品。</p></section>;
  const version=`${work.revision||work.updatedAt||'1'}-poster-v2`;
  return <section className="growth-studio" aria-labelledby="growth-studio-title">
    <div className="puzzle-ops__head"><div><span className="kicker">GROWTH CONTENT STUDIO</span><h2 id="growth-studio-title">小红书五图传播包</h2><p>为公开作品生成一套 3:4 图文素材；下载后先人工检查，再发布到对应账号。</p></div><span>1080 × 1440</span></div>
    <div className="growth-studio__layout">
      <aside className="growth-studio__controls">
        <label>选择作品<select value={work.id} onChange={event=>{setSelectedId(event.target.value);setActive('cover');setMessage('');}}>{state.works.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <div className="growth-studio__channel"><strong>小红书图文</strong><span>5 张 · 3:4 竖图</span><p>封面负责停留，随后依次交代推荐理由、玩法、来源和行动入口。</p></div>
        <div className="growth-studio__copy"><div><span>标题</span><button type="button" onClick={()=>copy(draft.title,'标题')}>复制</button></div><textarea readOnly value={draft.title} aria-label="小红书标题"/><div><span>正文</span><button type="button" onClick={()=>copy(draft.body,'正文')}>复制</button></div><textarea className="growth-studio__body" readOnly value={draft.body} aria-label="小红书正文"/></div>
        {message&&<p className="growth-studio__notice" role="status">{message}</p>}
        <small>系统不会自动发布，也不会自动联系作者。请确认事实、授权和平台标签后再发布。</small>
      </aside>
      <div className="growth-studio__canvas">
        <div className="growth-studio__preview"><img src={api.workXhsPromoUrl(work.id,active,{version})} alt={`${work.title} · ${slides.find(([id])=>id===active)?.[2]}预览`}/></div>
        <nav className="growth-studio__slides" aria-label="传播图片分页">{slides.map(([id,index,name,purpose])=><button type="button" className={active===id?'is-active':''} aria-pressed={active===id} onClick={()=>setActive(id)} key={id}><span>{index}</span><strong>{name}</strong><small>{purpose}</small></button>)}</nav>
        <div className="growth-studio__downloads"><a className="button button--primary" href={api.workXhsPromoUrl(work.id,active,{download:true,version})} download={`mooyu-${work.id}-xhs-${active}.png`}>下载当前图片</a>{slides.map(([id,index])=><a key={id} href={api.workXhsPromoUrl(work.id,id,{download:true,version})} download={`mooyu-${work.id}-xhs-${id}.png`} aria-label={`下载第 ${index} 张`}>{index}</a>)}</div>
      </div>
    </div>
  </section>;
}
