import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useI18n} from './I18n.jsx';
import {isEmbeddedAgentTool,subscribeYueRhymeStatus,syncYueRhymeContext} from './agent-tool-bridge.mjs';
import {
  YUE_RHYME_DATA_NOTICE,YUE_RHYME_DOCUMENT_VERSION,YUE_RHYME_STORAGE_KEY,
  addCustomWord,buildYueRhymeAgentContext,createYueRhymeLibrary,lookupYueRhyme,
  normalizeCustomWords,normalizeHanCharacter,yueRhymeFinals,
} from './yue-rhyme-model.mjs';
import './YueRhymeTool.css';

const LEGACY_STORAGE_KEY='jyutjam_custom_words';

function readCustomWords(){
  try{
    const stored=globalThis.localStorage?.getItem(YUE_RHYME_STORAGE_KEY);
    if(stored){
      const parsed=JSON.parse(stored);
      return normalizeCustomWords(parsed?.words??parsed);
    }
    const legacy=globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    return legacy?normalizeCustomWords(JSON.parse(legacy)):{};
  }catch{return {};}
}

function persistCustomWords(words){
  try{
    globalThis.localStorage?.setItem(YUE_RHYME_STORAGE_KEY,JSON.stringify({schemaVersion:YUE_RHYME_DOCUMENT_VERSION,words}));
    return true;
  }catch{return false;}
}

function downloadJson(words){
  const blob=new Blob([JSON.stringify({format:'mooyu.yue-rhyme-custom-words',schemaVersion:YUE_RHYME_DOCUMENT_VERSION,words},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='yue-rhyme-custom-words.json';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

function isCantoneseVoice(voice){
  const lang=String(voice?.lang||'').toLowerCase().replace('_','-'),name=String(voice?.name||'');
  return lang==='yue'||lang.startsWith('yue-')||lang==='zh-hk'||lang.startsWith('zh-hk-')||/cantonese|hong kong|sinji|善怡|粵|粤/iu.test(name);
}

function RhymeCard({set,wide,onChoose,t}){
  if(!set?.count)return null;
  return <section className={`yue-rhyme-card ${wide?'is-wide':''}`}>
    <header><div><span>{wide?t('tools.yueRhyme.wide'):t('tools.yueRhyme.strict')}</span><h3>{set.final}</h3></div><strong>{t('tools.yueRhyme.characterCount',{count:set.count})}</strong></header>
    <div className="yue-rhyme-groups">{set.groups.map(group=><section key={group.syllable} className="yue-rhyme-group">
      <h4>{group.syllable}<small>{t('tools.yueRhyme.characterCount',{count:group.items.length})}</small></h4>
      <div>{group.items.map(item=><button type="button" key={`${item.character}-${item.jyutping}`} className={wide?'is-wide':''} onClick={()=>onChoose(item.character,item.jyutping)} aria-label={`${item.character} ${item.jyutping}`}><b>{item.character}</b><span>{item.jyutping}</span></button>)}</div>
    </section>)}</div>
  </section>;
}

export default function YueRhymeTool(){
  const {t}=useI18n(),agentSurface=isEmbeddedAgentTool(),importRef=useRef(null);
  const [customWords,setCustomWords]=useState(readCustomWords);
  const [query,setQuery]=useState(''),[result,setResult]=useState(null),[notice,setNotice]=useState('');
  const [agentStatus,setAgentStatus]=useState('idle'),[speechStatus,setSpeechStatus]=useState('');
  const [draft,setDraft]=useState({character:'',jyutping:'',final:''});
  const library=useMemo(()=>createYueRhymeLibrary(customWords),[customWords]);
  const finals=useMemo(()=>yueRhymeFinals(),[]);
  const context=useMemo(()=>buildYueRhymeAgentContext(result),[result]);

  useEffect(()=>subscribeYueRhymeStatus(message=>setAgentStatus(message.status||'failed')),[agentSurface]);
  useEffect(()=>{
    if(!agentSurface||!context)return;
    setAgentStatus('syncing');
    if(!syncYueRhymeContext(context))setAgentStatus('failed');
  },[agentSurface,context]);
  useEffect(()=>()=>globalThis.speechSynthesis?.cancel?.(),[]);

  const runLookup=(value=query,preferredJyutping='')=>{
    const character=normalizeHanCharacter(value);
    if(!character){setResult({ok:false,code:'character-invalid'});setNotice(t('tools.yueRhyme.characterInvalid'));return;}
    const next=lookupYueRhyme({character,preferredJyutping,library});
    setQuery(character);setResult(next);setNotice(next.ok?'':t('tools.yueRhyme.notFound',{character}));setSpeechStatus('');
  };
  const choose=(character,jyutping)=>runLookup(character,jyutping);
  const speak=()=>{
    if(!result?.ok||!globalThis.speechSynthesis||!globalThis.SpeechSynthesisUtterance){setSpeechStatus(t('tools.yueRhyme.speechUnavailable'));return;}
    const voice=globalThis.speechSynthesis.getVoices().find(isCantoneseVoice);
    if(!voice){setSpeechStatus(t('tools.yueRhyme.voiceMissing'));return;}
    globalThis.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(result.character);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.86;
    utterance.onstart=()=>setSpeechStatus(t('tools.yueRhyme.speaking',{character:result.character}));
    utterance.onend=()=>setSpeechStatus(t('tools.yueRhyme.spoken',{character:result.character}));
    utterance.onerror=()=>setSpeechStatus(t('tools.yueRhyme.speechFailed'));
    globalThis.speechSynthesis.speak(utterance);
  };
  const saveDraft=()=>{
    const added=addCustomWord(customWords,draft);
    if(!added.ok){setNotice(t(`tools.yueRhyme.error.${added.code}`));return;}
    setCustomWords(added.customWords);
    const persisted=persistCustomWords(added.customWords);
    setNotice(t(persisted?'tools.yueRhyme.saved':'tools.yueRhyme.saveFailed',{character:added.reading.character}));
    setDraft({character:'',jyutping:'',final:''});
    setQuery(added.reading.character);
    setResult(lookupYueRhyme({character:added.reading.character,preferredJyutping:added.reading.jyutping,library:createYueRhymeLibrary(added.customWords)}));
  };
  const clearCustom=()=>{
    if(!globalThis.confirm?.(t('tools.yueRhyme.clearConfirm')))return;
    setCustomWords({});persistCustomWords({});setNotice(t('tools.yueRhyme.cleared'));
    if(result?.custom)setResult(null);
  };
  const importWords=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>512*1024){setNotice(t('tools.yueRhyme.importTooLarge'));return;}
    try{
      const parsed=JSON.parse(await file.text());
      if(parsed?.format&&parsed.format!=='mooyu.yue-rhyme-custom-words')throw new Error('format');
      const words=normalizeCustomWords(parsed?.words??parsed);
      if(!Object.keys(words).length)throw new Error('empty');
      const merged=normalizeCustomWords({...customWords,...words});setCustomWords(merged);persistCustomWords(merged);
      setNotice(t('tools.yueRhyme.imported',{count:Object.keys(words).length}));
    }catch{setNotice(t('tools.yueRhyme.importFailed'));}
  };

  return <section className="yue-rhyme-tool" aria-label={t('tools.yueRhyme.workspace')}>
    <details className="yue-rhyme-guide" open>
      <summary>{t('tools.yueRhyme.guideTitle')}</summary>
      <ol><li><b>1</b><span>{t('tools.yueRhyme.guideStep1')}</span></li><li><b>2</b><span>{t('tools.yueRhyme.guideStep2')}</span></li><li><b>3</b><span>{t('tools.yueRhyme.guideStep3')}</span></li></ol>
      <p>{agentSurface?t('tools.yueRhyme.agentDisclosure'):t('tools.yueRhyme.localDisclosure')}</p>
    </details>
    <div className="yue-rhyme-layout">
      <main className="yue-rhyme-main">
        <form className="yue-rhyme-search" onSubmit={event=>{event.preventDefault();runLookup();}}>
          <label htmlFor="yue-rhyme-query">{t('tools.yueRhyme.queryLabel')}</label>
          <div><input id="yue-rhyme-query" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('tools.yueRhyme.queryPlaceholder')} autoComplete="off" inputMode="text"/><button type="submit">{t('tools.yueRhyme.search')}</button></div>
          <small>{t('tools.yueRhyme.examples')} {[['眼','ngaan5'],['可','ho2'],['唔','m4'],['书','syu1']].map(([character,jyutping])=><button type="button" key={character} onClick={()=>choose(character,jyutping)}>{character}</button>)}</small>
        </form>
        <div className="yue-rhyme-results" aria-live="polite">
          {notice&&!result?.ok&&<p className="yue-rhyme-notice is-error" role="alert">{notice}</p>}
          {!result&&<div className="yue-rhyme-empty"><span aria-hidden="true">粵</span><h2>{t('tools.yueRhyme.emptyTitle')}</h2><p>{t('tools.yueRhyme.emptyLead')}</p></div>}
          {result?.ok&&<>
            <section className="yue-rhyme-reading">
              <div><span>{t('tools.yueRhyme.character')}</span><strong>{result.character}</strong>{result.custom&&<em>{t('tools.yueRhyme.custom')}</em>}</div>
              <dl><div><dt>{t('tools.yueRhyme.jyutping')}</dt><dd>{result.primary.jyutping}</dd></div><div><dt>{t('tools.yueRhyme.final')}</dt><dd>{result.primary.final}</dd></div></dl>
              {!!result.alternatives.length&&<div className="yue-rhyme-alternatives"><span>{t('tools.yueRhyme.alternatives')}</span>{result.alternatives.map(item=><button type="button" key={item.jyutping} onClick={()=>choose(result.character,item.jyutping)}>{item.jyutping}</button>)}</div>}
              <button type="button" className="yue-rhyme-listen" onClick={speak}>{t('tools.yueRhyme.listen')}</button><small role="status">{speechStatus}</small>
            </section>
            {notice&&<p className="yue-rhyme-notice">{notice}</p>}
            {agentSurface&&<p className={`yue-rhyme-agent is-${agentStatus}`}>{t(`tools.yueRhyme.agent.${agentStatus}`)}</p>}
            <RhymeCard set={result.strict} onChoose={choose} t={t}/>
            {result.wide.map(set=><RhymeCard key={set.final} set={set} wide onChoose={choose} t={t}/>)}
          </>}
        </div>
      </main>
      <aside className="yue-rhyme-sidebar">
        <section><span className="kicker">LOCAL LIBRARY</span><h2>{t('tools.yueRhyme.addTitle')}</h2><p>{t('tools.yueRhyme.addLead')}</p>
          <label>{t('tools.yueRhyme.character')}<input value={draft.character} onChange={event=>setDraft(current=>({...current,character:event.target.value}))} placeholder="字"/></label>
          <label>{t('tools.yueRhyme.jyutping')}<input value={draft.jyutping} onChange={event=>setDraft(current=>({...current,jyutping:event.target.value}))} placeholder="jat1" autoCapitalize="none"/></label>
          <label>{t('tools.yueRhyme.final')}<select value={draft.final} onChange={event=>setDraft(current=>({...current,final:event.target.value}))}><option value="">{t('tools.yueRhyme.chooseFinal')}</option>{finals.map(final=><option key={final} value={final}>{final}</option>)}</select></label>
          <button type="button" className="button" onClick={saveDraft}>{t('tools.yueRhyme.save')}</button>
          <div className="yue-rhyme-library-actions"><button type="button" onClick={()=>downloadJson(customWords)} disabled={!Object.keys(customWords).length}>{t('tools.yueRhyme.export')}</button><button type="button" onClick={()=>importRef.current?.click()}>{t('tools.yueRhyme.import')}</button><button type="button" onClick={clearCustom} disabled={!Object.keys(customWords).length}>{t('tools.yueRhyme.clear')}</button></div>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={importWords}/><small>{t('tools.yueRhyme.customCount',{count:Object.keys(customWords).length})}</small>
        </section>
        <details><summary>{t('tools.yueRhyme.dataTitle')}</summary><p>{t('tools.yueRhyme.dataLead')}</p><a href={YUE_RHYME_DATA_NOTICE.pronunciation.url} target="_blank" rel="noreferrer">{YUE_RHYME_DATA_NOTICE.pronunciation.name}</a><small>{YUE_RHYME_DATA_NOTICE.pronunciation.license}</small><p className="yue-rhyme-provenance-warning">{t('tools.yueRhyme.provenanceWarning')}</p></details>
      </aside>
    </div>
  </section>;
}
