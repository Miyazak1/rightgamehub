import React,{useEffect,useState} from 'react';
import {useI18n} from './I18n.jsx';
export function GameSharePage({code,api,renderPlayer}) {
  const {t}=useI18n();
  const [state,setState]=useState({});
  useEffect(()=>{const controller=new AbortController();api.getGameShare(code,{signal:controller.signal}).then(({data})=>{if(!controller.signal.aborted)setState({share:data});},error=>{if(!controller.signal.aborted)setState({error:error.message||t('gameShare.loadFailed')});});return()=>controller.abort();},[api,code,t]);
  if(state.error)return <main className="page"><h1>{t('gameShare.unavailable')}</h1><p role="alert">{state.error}</p><a href="/discover">{t('common.backDiscover')}</a></main>;
  if(!state.share)return <main className="page" role="status">{t('gameShare.loading')}</main>;
  return renderPlayer(state.share);
}
