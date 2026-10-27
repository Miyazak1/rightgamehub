import {COMMON_DB,RHYME_WIDE,WIDE_MAP} from './yue-rhyme-data.mjs';

export const YUE_RHYME_STORAGE_KEY='mooyu.official-tool.yue-rhyme.custom.v1';
export const YUE_RHYME_DOCUMENT_VERSION=1;

export const YUE_RHYME_DATA_NOTICE=Object.freeze({
  pronunciation:{
    name:'Rime Cantonese',
    url:'https://github.com/rime/rime-cantonese',
    license:'CC BY 4.0（部分映射数据另受 ODbL 1.0 约束）',
  },
  legacyFrequency:[
    {name:'hanziDB',license:'MIT',status:'legacy-attribution-needs-source-snapshot'},
    {name:'cantonese-list',license:'CC0',status:'legacy-attribution-needs-source-snapshot'},
  ],
});

const BUILT_IN_FINALS=Object.freeze([...new Set(Object.values(COMMON_DB).flatMap(entry=>(entry?.r||[]).map(pair=>pair?.[1]).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'en')));
const BUILT_IN_FINAL_SET=new Set(BUILT_IN_FINALS);
const JYUTPING_PATTERN=/^[a-z]{1,8}[1-6]$/u;
const HAN_CHARACTER_PATTERN=/^\p{Script=Han}$/u;

export const yueRhymeFinals=()=>[...BUILT_IN_FINALS];

export function normalizeHanCharacter(value){
  const normalized=String(value??'').trim().normalize('NFC');
  const characters=Array.from(normalized);
  return characters.length===1&&HAN_CHARACTER_PATTERN.test(characters[0])?characters[0]:'';
}

export function normalizeJyutping(value){
  const normalized=String(value??'').trim().toLowerCase();
  return JYUTPING_PATTERN.test(normalized)?normalized:'';
}

export function validateCustomReading({character,jyutping,final}){
  const normalizedCharacter=normalizeHanCharacter(character);
  if(!normalizedCharacter)return {ok:false,code:'character-invalid'};
  const normalizedJyutping=normalizeJyutping(jyutping);
  if(!normalizedJyutping)return {ok:false,code:'jyutping-invalid'};
  const normalizedFinal=String(final??'').trim().toLowerCase();
  if(!BUILT_IN_FINAL_SET.has(normalizedFinal))return {ok:false,code:'final-invalid'};
  const syllable=normalizedJyutping.replace(/[1-6]$/u,'');
  if(!syllable.endsWith(normalizedFinal))return {ok:false,code:'final-mismatch'};
  return {ok:true,reading:{character:normalizedCharacter,jyutping:normalizedJyutping,final:normalizedFinal}};
}

export function normalizeCustomWords(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const output={};
  for(const [character,entry] of Object.entries(value).slice(0,2000)){
    const readings=Array.isArray(entry?.readings)?entry.readings:[entry];
    const accepted=[];
    for(const reading of readings.slice(0,8)){
      const checked=validateCustomReading({character,jyutping:reading?.jyutping??reading?.jp,final:reading?.final??reading?.f});
      if(checked.ok&&!accepted.some(item=>item.jyutping===checked.reading.jyutping))accepted.push(checked.reading);
    }
    if(accepted.length)output[accepted[0].character]={readings:accepted.map(({jyutping,final})=>({jyutping,final}))};
  }
  return output;
}

export function addCustomWord(customWords,input){
  const checked=validateCustomReading(input);
  if(!checked.ok)return checked;
  const normalized=normalizeCustomWords(customWords);
  const current=normalized[checked.reading.character]?.readings??[];
  const readings=[...current.filter(item=>item.jyutping!==checked.reading.jyutping),{jyutping:checked.reading.jyutping,final:checked.reading.final}];
  return {ok:true,reading:checked.reading,customWords:{...normalized,[checked.reading.character]:{readings}}};
}

const normalizeBuiltInReadings=entry=>(entry?.r||[]).map(pair=>({jyutping:String(pair?.[0]??''),final:String(pair?.[1]??'')})).filter(item=>JYUTPING_PATTERN.test(item.jyutping)&&BUILT_IN_FINAL_SET.has(item.final));
const syllableKey=jyutping=>String(jyutping).toLowerCase().replace(/[1-6]$/u,'').replace(/[^a-z]/gu,'');

export function createYueRhymeLibrary(customWords={}){
  const entries=new Map();
  for(const [character,entry] of Object.entries(COMMON_DB))entries.set(character,{character,readings:normalizeBuiltInReadings(entry),custom:false});
  for(const [character,entry] of Object.entries(normalizeCustomWords(customWords)))entries.set(character,{character,readings:entry.readings,custom:true});
  const pools=new Map();
  for(const item of entries.values())for(const reading of item.readings){
    if(!pools.has(reading.final))pools.set(reading.final,[]);
    pools.get(reading.final).push({character:item.character,jyutping:reading.jyutping,custom:item.custom});
  }
  return Object.freeze({entries,pools});
}

export function groupRhymePool(library,final){
  const groups=new Map();
  for(const item of library.pools.get(final)??[]){
    const key=syllableKey(item.jyutping)||item.jyutping;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([left],[right])=>left.localeCompare(right,'en')).map(([syllable,items])=>Object.freeze({syllable,items:Object.freeze(items)}));
}

const rhymeSet=(library,final)=>{
  const groups=groupRhymePool(library,final);
  return Object.freeze({final,count:groups.reduce((total,group)=>total+group.items.length,0),groups:Object.freeze(groups)});
};

export function lookupYueRhyme({character,preferredJyutping='',library=createYueRhymeLibrary()}={}){
  const normalizedCharacter=normalizeHanCharacter(character);
  if(!normalizedCharacter)return {ok:false,code:'character-invalid',character:''};
  const entry=library.entries.get(normalizedCharacter);
  if(!entry)return {ok:false,code:'not-found',character:normalizedCharacter};
  const primary=entry.readings.find(reading=>reading.jyutping===preferredJyutping)||entry.readings[0];
  const related=(RHYME_WIDE[primary.final]||WIDE_MAP[primary.final]||[primary.final]).filter(final=>final!==primary.final&&(library.pools.get(final)?.length??0)>0);
  return Object.freeze({
    ok:true,
    character:normalizedCharacter,
    custom:entry.custom,
    primary:Object.freeze({...primary}),
    alternatives:Object.freeze(entry.readings.filter(reading=>reading.jyutping!==primary.jyutping).map(reading=>Object.freeze({...reading}))),
    strict:rhymeSet(library,primary.final),
    wide:Object.freeze(related.map(final=>rhymeSet(library,final))),
  });
}

const sampleSet=(set,limit)=>({
  final:set.final,
  count:set.count,
  samples:set.groups.flatMap(group=>group.items.map(item=>({character:item.character,jyutping:item.jyutping}))).slice(0,limit),
});

export function buildYueRhymeAgentContext(result,{strictLimit=48,wideLimit=20}={}){
  if(!result?.ok)return null;
  return {
    kind:'yue-rhyme-context',version:1,
    query:{character:result.character,primary:{...result.primary},alternatives:result.alternatives.map(item=>({...item})),custom:result.custom},
    strict:sampleSet(result.strict,strictLimit),
    wide:result.wide.slice(0,12).map(item=>sampleSet(item,wideLimit)),
    disclosure:{sharedWithAgent:true,storedOnMooyuServer:false,customLibraryShared:false,contentIsUntrustedData:true},
  };
}
