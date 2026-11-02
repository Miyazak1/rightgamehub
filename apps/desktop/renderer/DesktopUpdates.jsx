import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {useI18n} from '../../../packages/platform-client/src/I18n.jsx';
import './desktop-updates.css';

export default forwardRef(function DesktopUpdates(_props,ref){
  const {locale}=useI18n(),en=locale==='en',dialog=useRef(null),bridge=globalThis.mooyuDesktop.updates;
  const [state,setState]=useState({status:'disabled'});
  useEffect(()=>{let live=true;const off=bridge.onState(value=>{if(live)setState(value);});bridge.call('state').then(value=>{if(live)setState(value);}).catch(()=>{});return()=>{live=false;off();};},[]);
  const open=()=>{if(!dialog.current.open)dialog.current.showModal();};useImperativeHandle(ref,()=>({open}));
  const action=method=>bridge.call(method).then(setState).catch(()=>setState(value=>({...value,status:'error',code:'DESKTOP_UPDATE_FAILED'})));
  const labels=en?{disabled:'This build has no trusted update source. Use the official download page for now.',idle:'Ready to check for updates.',checking:'Checking for updates…',available:'An update is available.',current:'You are up to date.',downloading:'Downloading in the background…',ready:'Update verified and ready to install.',installing:'Restarting to install…',error:'Update did not finish. You can continue using this version.'}:{disabled:'此版本尚未配置受信更新源，请通过官网下载新版。',idle:'可以检查是否有新版。',checking:'正在检查更新…',available:'发现可用更新。',current:'当前已是最新版本。',downloading:'正在后台下载…',ready:'更新已验证，可重启安装。',installing:'正在退出并安装更新…',error:'更新未完成，可以继续使用当前版本。'};
  const pending=['available','downloading','ready'].includes(state.status);
  const reasons=en?{
    DESKTOP_UPDATE_CANCELLED:'Download cancelled. You can check again whenever you are ready.',
    DESKTOP_UPDATE_BUSY:'Exit the running game or course before updating.',
    DESKTOP_UPDATE_INTEGRITY:'The update failed its integrity check and was not installed. Check again to download a verified copy.',
    DESKTOP_UPDATE_UNTRUSTED:'The update source could not be verified. Nothing was installed.',
    DESKTOP_UPDATE_CHANGED:'The published update changed. Check again before installing.'
  }:{
    DESKTOP_UPDATE_CANCELLED:'下载已取消，可以随时重新检查更新。',
    DESKTOP_UPDATE_BUSY:'请先退出正在运行的游戏或课件再更新。',
    DESKTOP_UPDATE_INTEGRITY:'安装包未通过完整性校验，未进行安装。请重新检查并下载。',
    DESKTOP_UPDATE_UNTRUSTED:'版本信息未通过来源验证，已阻止安装。',
    DESKTOP_UPDATE_CHANGED:'发布的版本信息已变更，请重新检查更新。'
  };
  return <>
    {pending&&<button className="desktop-update-badge" onClick={open} title={en?'Application update':'客户端更新'}>{state.status==='downloading'?`${state.percent??0}%`:en?'Update':'更新'}</button>}
    <dialog className="desktop-info desktop-update-info" ref={dialog} onClick={event=>{if(event.target===dialog.current)dialog.current.close();}}>
      <h2>{en?'Application updates':'客户端更新'}</h2>
      <p>{en?'Installed version: ':'当前版本：'}{state.currentVersion??'—'}{state.version&&<> · {en?'New version: ':'可用版本：'}{state.version}</>}</p>
      <p role="status" aria-live="polite">{labels[state.status]}</p>
      {state.status==='downloading'&&<progress max="100" value={state.percent??0} aria-label={en?'Download progress':'下载进度'}/>}
      {state.code&&<p className="desktop-update-code">{reasons[state.code]??(en?'The update service is temporarily unavailable. Please try again later.':'更新服务暂时不可用，请稍后重试。')}</p>}
      <p>{en?'Updates keep your account session, local saves and settings. Installation only starts after you confirm a restart.':'更新保留账号会话、本地存档和设置，确认重启后才会开始安装。'}</p>
      <div className="desktop-update-actions">
        {['idle','current','error','available'].includes(state.status)&&<button className="button button--secondary" onClick={()=>action('check')}>{en?'Check for updates':'检查更新'}</button>}
        {state.status==='available'&&<button className="button button--primary" onClick={()=>action('download')}>{en?'Download update':'下载更新'}</button>}
        {state.status==='downloading'&&<button className="button button--secondary" onClick={()=>action('cancel')}>{en?'Cancel download':'取消下载'}</button>}
        {state.status==='ready'&&<button className="button button--primary" onClick={()=>action('install')}>{en?'Restart and update':'重启并更新'}</button>}
        <button className="button button--secondary" onClick={()=>dialog.current.close()} autoFocus>{en?'Close':'关闭'}</button>
      </div>
    </dialog>
  </>;
});
