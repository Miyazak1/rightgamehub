import React,{useEffect,useState} from 'react';
export function GameSharePage({code,api,renderPlayer}) {
  const [state,setState]=useState({});
  useEffect(()=>{const controller=new AbortController();api.getGameShare(code,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setState({share:data});},error=>{if(!controller.signal.aborted)setState({error:error.message||'分享暂时无法读取，请稍后重试。'});});return()=>controller.abort();},[api,code]);
  if(state.error)return <main className="page"><h1>分享不可用</h1><p role="alert">{state.error}</p><a href="#/discover">返回发现</a></main>;
  if(!state.share)return <main className="page" role="status">正在读取游戏分享…</main>;
  return renderPlayer(state.share);
}
