import React,{useEffect,useRef,useState} from 'react';
import AvatarView from './AvatarView.jsx';

export default function AgentAvatarEditor({api,agent,onSaved}){
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),
    [error,setError]=useState(''),[notice,setNotice]=useState('');
  const input=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!file){setPreview(null);return;}
    const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);
  },[file]);
  const choose=event=>{
    const next=event.target.files?.[0];event.target.value='';setError('');setNotice('');
    if(!next)return;
    if(!['image/png','image/jpeg','image/gif','image/webp'].includes(next.type)){setError('请选择 PNG、JPEG、GIF 或 WebP 图片。');return;}
    if(next.size>2*1024*1024){setError('头像不能超过 2 MB。');return;}
    setFile(next);
  };
  const save=async reset=>{
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const response=reset?await api.resetAdminAgentAvatar(agent.agentUserId):await api.uploadAdminAgentAvatar(agent.agentUserId,file);
      onSaved(response.data);
      if(mounted.current){setFile(null);setNotice(reset?'已恢复小墨鱼默认头像。':'头像已保存。');}
    }catch(caught){if(mounted.current)setError(caught.message||'头像未能更新，请刷新后重试。');}
    finally{if(mounted.current)setBusy(false);}
  };
  return <section className="agent-control-card agent-avatar-editor" aria-label="机器人头像">
    <div className="agent-avatar-editor__preview"><AvatarView api={api}
      avatar={preview?{kind:'upload',previewUrl:preview}:agent.avatar??{kind:'preset',presetKey:'xiaomoyu'}} alt={`${agent.displayName}头像`}/></div>
    <div><h3>机器人头像</h3><p>支持 PNG、JPEG、GIF、WebP，最大 2 MB；图片最长边不超过 1024 像素。</p>
      <div className="agent-avatar-editor__actions">
        <button type="button" className="button button--secondary" disabled={busy} onClick={()=>input.current?.click()}>选择图片</button>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" aria-label="选择机器人头像" onChange={choose}/>
        <button type="button" className="button button--primary" disabled={busy||!file} onClick={()=>save(false)}>{busy?'处理中…':'保存头像'}</button>
        <button type="button" className="button button--secondary" disabled={busy} onClick={()=>save(true)}>恢复小墨鱼默认头像</button>
      </div>
      {file&&<small>预览：{file.name} · 保存后生效</small>}
      {notice&&<p role="status">{notice}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    </div>
  </section>;
}
