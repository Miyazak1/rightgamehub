import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {PRIVACY_TYPES,redactSensitiveText,scanSensitiveText,summarizeFindings} from './privacy-redactor.mjs';
import PdfPrivacyPanel from './PdfPrivacyPanel.jsx';
import './PrivacyRedactorTool.css';

const textTypes=PRIVACY_TYPES.filter(type=>type!=='custom');
const maxImageBytes=40*1024*1024,maxImagePixels=40_000_000;

function routeDefaults(){
  const outer=new URLSearchParams(String(globalThis.location?.search||'').replace(/^\?/u,'')),embedded=outer.get('gh_route');
  const query=embedded?.includes('?')?embedded.slice(embedded.indexOf('?')+1):String(globalThis.location?.search||'').replace(/^\?/u,'');
  const params=new URLSearchParams(query),requested=(params.get('types')||'').split(',').filter(type=>textTypes.includes(type));
  return {mode:['image','pdf'].includes(params.get('mode'))?params.get('mode'):'text',types:requested.length?requested:textTypes};
}

function downloadBlob(blob,name){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safeName(name){return String(name||'image').replace(/\.[^.]+$/u,'').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,80)||'image';}

export default function PrivacyRedactorTool(){
  const {t}=useI18n(),defaults=useMemo(routeDefaults,[]),[mode,setMode]=useState(defaults.mode);
  const [text,setText]=useState(''),[types,setTypes]=useState(defaults.types),[customTerms,setCustomTerms]=useState(''),[maskMode,setMaskMode]=useState('labels');
  const [findings,setFindings]=useState([]),[selected,setSelected]=useState(new Set()),[scanned,setScanned]=useState(false),[notice,setNotice]=useState('');
  const result=useMemo(()=>redactSensitiveText(text,findings,{selectedIds:selected,mode:maskMode}),[text,findings,selected,maskMode]);
  const summary=useMemo(()=>summarizeFindings(findings.filter(item=>selected.has(item.id))),[findings,selected]);
  const scan=()=>{const items=scanSensitiveText(text,{types:[...types,...(customTerms.trim()?['custom']:[])],customTerms:customTerms.split(/\r?\n/u)});setFindings(items);setSelected(new Set(items.map(item=>item.id)));setScanned(true);setNotice(items.length?t('tools.privacy.scanDone',{count:items.length}):t('tools.privacy.noneFound'));};
  const resetText=()=>{setText('');setFindings([]);setSelected(new Set());setScanned(false);setNotice('');};
  const copyResult=async()=>{try{await navigator.clipboard.writeText(result);setNotice(t('tools.privacy.copied'));}catch{setNotice(t('tools.privacy.copyFailed'));}};
  const downloadText=()=>downloadBlob(new Blob([result],{type:'text/plain;charset=utf-8'}),'mooyu-sanitized.txt');
  const toggleType=type=>setTypes(current=>current.includes(type)?current.filter(item=>item!==type):[...current,type]);
  const toggleFinding=id=>setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});

  return <section className="privacy-tool" aria-label={t('tools.privacy.workspace')}>
    <div className="privacy-tool__trust"><span aria-hidden="true">●</span><div><strong>{t('tools.privacy.localOnly')}</strong><p>{t('tools.privacy.localLead')}</p></div></div>
    <div className="privacy-tool__tabs" role="tablist" aria-label={t('tools.privacy.mode')}>
      <button role="tab" aria-selected={mode==='text'} onClick={()=>{setMode('text');setNotice('');}}>{t('tools.privacy.text')}</button>
      <button role="tab" aria-selected={mode==='image'} onClick={()=>{setMode('image');setNotice('');}}>{t('tools.privacy.image')}</button>
      <button role="tab" aria-selected={mode==='pdf'} onClick={()=>{setMode('pdf');setNotice('');}}>{t('tools.privacy.pdf')}</button>
    </div>
    {mode==='text'?<div className="privacy-text">
      <div className="privacy-panel privacy-text__source"><div className="privacy-panel__heading"><div><span className="kicker">01 · SCAN</span><h2>{t('tools.privacy.source')}</h2></div><button className="button button--ghost" onClick={resetText} disabled={!text}>{t('tools.privacy.clear')}</button></div>
        <textarea value={text} onChange={event=>{setText(event.target.value);setScanned(false);setNotice('');}} placeholder={t('tools.privacy.textPlaceholder')} spellCheck="false" />
        <fieldset><legend>{t('tools.privacy.detect')}</legend><div className="privacy-checks">{textTypes.map(type=><label key={type}><input type="checkbox" checked={types.includes(type)} onChange={()=>toggleType(type)}/><span>{t(`tools.privacy.type.${type}`)}</span></label>)}</div></fieldset>
        <label className="privacy-custom"><span>{t('tools.privacy.custom')}</span><textarea value={customTerms} onChange={event=>setCustomTerms(event.target.value)} placeholder={t('tools.privacy.customPlaceholder')}/><small>{t('tools.privacy.customLead')}</small></label>
        <button className="button button--primary" onClick={scan} disabled={!text.trim()||(!types.length&&!customTerms.trim())}>{t('tools.privacy.scan')}</button>
      </div>
      <div className="privacy-panel privacy-text__result"><div className="privacy-panel__heading"><div><span className="kicker">02 · REVIEW</span><h2>{t('tools.privacy.result')}</h2></div><span className="privacy-count">{selected.size}</span></div>
        <div className="privacy-mask-modes"><label><input type="radio" name="privacy-mask" checked={maskMode==='labels'} onChange={()=>setMaskMode('labels')}/>{t('tools.privacy.labels')}</label><label><input type="radio" name="privacy-mask" checked={maskMode==='mask'} onChange={()=>setMaskMode('mask')}/>{t('tools.privacy.mask')}</label></div>
        {scanned&&findings.length?<div className="privacy-findings">{findings.map(item=><label key={item.id}><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleFinding(item.id)}/><span className="privacy-findings__type">{t(`tools.privacy.type.${item.type}`)}</span><code>{item.value}</code></label>)}</div>:<div className="privacy-empty"><strong>{scanned?t('tools.privacy.noneFound'):t('tools.privacy.readyTitle')}</strong><p>{scanned?t('tools.privacy.noneLead'):t('tools.privacy.readyLead')}</p></div>}
        <textarea className="privacy-output" value={scanned?result:''} readOnly placeholder={t('tools.privacy.outputPlaceholder')}/>
        {Object.keys(summary).length?<div className="privacy-summary">{Object.entries(summary).map(([type,count])=><span key={type}>{t(`tools.privacy.type.${type}`)} · {count}</span>)}</div>:null}
        <div className="privacy-actions"><button className="button button--primary" onClick={copyResult} disabled={!scanned}>{t('tools.privacy.copy')}</button><button className="button button--secondary" onClick={downloadText} disabled={!scanned}>{t('tools.privacy.download')}</button></div>
      </div>
    </div>:mode==='image'?<ImageRedactor t={t}/>:<PdfPrivacyPanel t={t} types={types} onTypesChange={setTypes} customTerms={customTerms} onCustomTermsChange={setCustomTerms}/>}
    {notice?<div className="privacy-notice" role="status">{notice}</div>:null}
  </section>;
}
function ImageRedactor({t}){
  const canvasRef=useRef(null),imageRef=useRef(null),objectUrlRef=useRef(''),draftRef=useRef(null);
  const [file,setFile]=useState(null),[boxes,setBoxes]=useState([]),[draft,setDraft]=useState(null),[message,setMessage]=useState(''),[detecting,setDetecting]=useState(false);
  const redraw=useCallback((nextBoxes=boxes,nextDraft=draft)=>{const canvas=canvasRef.current,image=imageRef.current;if(!canvas||!image)return;const context=canvas.getContext('2d',{alpha:false});context.drawImage(image,0,0,canvas.width,canvas.height);context.fillStyle='#111018';for(const box of nextBoxes)context.fillRect(box.x,box.y,box.width,box.height);if(nextDraft){context.save();context.strokeStyle='#7655ff';context.lineWidth=Math.max(2,canvas.width/500);context.setLineDash([10,8]);context.strokeRect(nextDraft.x,nextDraft.y,nextDraft.width,nextDraft.height);context.restore();}},[boxes,draft]);
  useEffect(()=>{redraw();},[redraw]);
  useEffect(()=>()=>{if(objectUrlRef.current)URL.revokeObjectURL(objectUrlRef.current);},[]);
  const openFile=selectedFile=>{if(!selectedFile)return;if(!selectedFile.type.startsWith('image/')||selectedFile.size>maxImageBytes){setMessage(t('tools.privacy.imageInvalid'));return;}const url=URL.createObjectURL(selectedFile),image=new Image();image.onload=()=>{if(image.naturalWidth*image.naturalHeight>maxImagePixels){URL.revokeObjectURL(url);setMessage(t('tools.privacy.imageTooLarge'));return;}if(objectUrlRef.current)URL.revokeObjectURL(objectUrlRef.current);objectUrlRef.current=url;imageRef.current=image;const canvas=canvasRef.current;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;setFile(selectedFile);setBoxes([]);setDraft(null);setMessage(t('tools.privacy.imageReady'));requestAnimationFrame(()=>{const context=canvas.getContext('2d',{alpha:false});context.drawImage(image,0,0,canvas.width,canvas.height);});};image.onerror=()=>{URL.revokeObjectURL(url);setMessage(t('tools.privacy.imageInvalid'));};image.src=url;};
  const point=event=>{const canvas=canvasRef.current,rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};};
  const onPointerDown=event=>{if(!file)return;event.currentTarget.setPointerCapture(event.pointerId);const start=point(event),next={x:start.x,y:start.y,width:0,height:0,startX:start.x,startY:start.y};draftRef.current=next;setDraft(next);};
  const onPointerMove=event=>{const current=draftRef.current;if(!current)return;const now=point(event),next={...current,x:Math.min(current.startX,now.x),y:Math.min(current.startY,now.y),width:Math.abs(now.x-current.startX),height:Math.abs(now.y-current.startY)};draftRef.current=next;setDraft(next);};
  const onPointerUp=()=>{const current=draftRef.current;draftRef.current=null;setDraft(null);if(current&&current.width>=4&&current.height>=4)setBoxes(existing=>[...existing,{x:current.x,y:current.y,width:current.width,height:current.height}]);};
  const detectFaces=async()=>{if(!globalThis.FaceDetector||!imageRef.current)return;setDetecting(true);try{const faces=await new globalThis.FaceDetector({fastMode:false,maxDetectedFaces:30}).detect(imageRef.current);setBoxes(existing=>[...existing,...faces.map(({boundingBox})=>({x:Math.max(0,boundingBox.x-8),y:Math.max(0,boundingBox.y-8),width:Math.min(canvasRef.current.width,boundingBox.width+16),height:Math.min(canvasRef.current.height,boundingBox.height+16)}))]);setMessage(faces.length?t('tools.privacy.facesFound',{count:faces.length}):t('tools.privacy.noFaces'));}catch{setMessage(t('tools.privacy.faceFailed'));}finally{setDetecting(false);}};
  const exportImage=()=>{redraw(boxes,null);canvasRef.current.toBlob(blob=>{if(blob){downloadBlob(blob,`${safeName(file.name)}-sanitized.png`);setMessage(t('tools.privacy.imageExported'));}},'image/png');};
  return <div className="privacy-image">
    <aside className="privacy-panel privacy-image__controls"><span className="kicker">LOCAL IMAGE</span><h2>{t('tools.privacy.imageTitle')}</h2><p>{t('tools.privacy.imageLead')}</p>
      <label className="privacy-file"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>openFile(event.target.files?.[0])}/><strong>{file?t('tools.privacy.changeImage'):t('tools.privacy.chooseImage')}</strong><span>{file?`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`:t('tools.privacy.imageFormats')}</span></label>
      <div className="privacy-image__steps"><strong>{t('tools.privacy.imageHow')}</strong><ol><li>{t('tools.privacy.imageStep1')}</li><li>{t('tools.privacy.imageStep2')}</li><li>{t('tools.privacy.imageStep3')}</li></ol></div>
      <button className="button button--secondary" onClick={detectFaces} disabled={!file||!globalThis.FaceDetector||detecting}>{globalThis.FaceDetector?t(detecting?'tools.privacy.detectingFaces':'tools.privacy.detectFaces'):t('tools.privacy.faceUnavailable')}</button>
      <div className="privacy-actions"><button className="button button--ghost" onClick={()=>setBoxes(current=>current.slice(0,-1))} disabled={!boxes.length}>{t('tools.privacy.undo')}</button><button className="button button--ghost" onClick={()=>setBoxes([])} disabled={!boxes.length}>{t('tools.privacy.clearBoxes')}</button></div>
      <button className="button button--primary" onClick={exportImage} disabled={!file}>{t('tools.privacy.exportImage')}</button><small>{t('tools.privacy.metadataNote')}</small>
    </aside>
    <div className={`privacy-image__stage${file?' is-ready':''}`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();openFile(event.dataTransfer.files?.[0]);}}>
      {!file?<div className="privacy-image__empty"><span aria-hidden="true">▧</span><strong>{t('tools.privacy.dropImage')}</strong><p>{t('tools.privacy.dropImageLead')}</p></div>:null}
      <canvas ref={canvasRef} aria-label={t('tools.privacy.imageCanvas')} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}/>
      {file?<div className="privacy-image__status"><span>{boxes.length} {t('tools.privacy.boxes')}</span><span>{imageRef.current?.naturalWidth} × {imageRef.current?.naturalHeight}</span></div>:null}
    </div>{message?<div className="privacy-notice privacy-image__notice" role="status">{message}</div>:null}
  </div>;
}
