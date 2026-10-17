import {diffArrays} from 'diff';

export const DOCUMENT_DIFF_MODES=Object.freeze(['lines','words','characters']);

const normalizeNewlines=value=>String(value??'').replace(/\r\n?/gu,'\n');
const tokenize=(value,mode,{ignoreWhitespace=false}={})=>{
  const text=normalizeNewlines(value);
  if(mode==='lines')return text.match(/.*(?:\n|$)/gu)?.filter((token,index,tokens)=>token||index<tokens.length-1)||[];
  if(mode==='words')return text.match(/\s+|[^\s]+/gu)||[];
  return ignoreWhitespace?(text.match(/\s+|[^\s]/gu)||[]):[...text];
};
const equivalent=(left,right,{ignoreWhitespace=false,ignoreCase=false}={})=>{
  let a=left,b=right;
  if(ignoreWhitespace){
    if(/^\s+$/u.test(a)&&/^\s+$/u.test(b))return true;
    a=a.replace(/\s+/gu,' ').trim();b=b.replace(/\s+/gu,' ').trim();
  }
  if(ignoreCase){a=a.toLocaleLowerCase();b=b.toLocaleLowerCase();}
  return a===b;
};
const diffTokens=(before,after,mode,options)=>diffArrays(tokenize(before,mode,options),tokenize(after,mode,options),{comparator:(left,right)=>equivalent(left,right,options)}).map((part,index)=>({...part,id:`part-${index}`,value:part.value.join('')}));
const unitCount=(value,mode)=>{
  if(!value)return 0;
  if(mode==='lines')return value.split('\n').filter((line,index,lines)=>line||index<lines.length-1).length;
  if(mode==='words')return value.trim()?value.trim().split(/\s+/u).length:0;
  return [...value].length;
};

export function compareDocuments(before,after,{mode='lines',ignoreWhitespace=false,ignoreCase=false}={}){
  const selectedMode=DOCUMENT_DIFF_MODES.includes(mode)?mode:'lines';
  const parts=diffTokens(before,after,selectedMode,{ignoreCase,ignoreWhitespace});
  const stats=parts.reduce((all,part)=>{const count=unitCount(part.value,selectedMode);if(part.added)all.added+=count;else if(part.removed)all.removed+=count;else all.unchanged+=count;return all;},{added:0,removed:0,unchanged:0});
  const total=stats.unchanged+Math.max(stats.added,stats.removed);
  return {mode:selectedMode,parts,stats:{...stats,changes:parts.filter(part=>part.added||part.removed).length,similarity:total?Math.round(stats.unchanged/total*100):100}};
}

const splitLines=value=>{
  const matches=String(value??'').match(/.*(?:\n|$)/gu)||[];
  return matches.filter((line,index)=>line||index<matches.length-1).map(line=>line.replace(/\n$/u,''));
};

export function buildSideBySideRows(before,after,{ignoreWhitespace=false,ignoreCase=false}={}){
  const parts=diffTokens(before,after,'lines',{ignoreWhitespace,ignoreCase}),rows=[];
  let beforeNumber=1,afterNumber=1,rowId=0;
  for(let index=0;index<parts.length;index++){
    const part=parts[index],lines=splitLines(part.value);
    if(part.removed&&parts[index+1]?.added){
      const added=splitLines(parts[index+1].value),count=Math.max(lines.length,added.length);
      for(let offset=0;offset<count;offset++)rows.push({id:`row-${rowId++}`,status:'changed',before:lines[offset]??'',after:added[offset]??'',beforeNumber:offset<lines.length?beforeNumber++:null,afterNumber:offset<added.length?afterNumber++:null});
      index++;
    }else if(part.removed){
      for(const line of lines)rows.push({id:`row-${rowId++}`,status:'removed',before:line,after:'',beforeNumber:beforeNumber++,afterNumber:null});
    }else if(part.added){
      for(const line of lines)rows.push({id:`row-${rowId++}`,status:'added',before:'',after:line,beforeNumber:null,afterNumber:afterNumber++});
    }else{
      for(const line of lines)rows.push({id:`row-${rowId++}`,status:'same',before:line,after:line,beforeNumber:beforeNumber++,afterNumber:afterNumber++});
    }
  }
  return rows;
}

export function compareInline(before,after,{ignoreCase=false,ignoreWhitespace=false}={}){return diffTokens(before,after,'words',{ignoreCase,ignoreWhitespace});}

export function buildDiffReport({beforeLabel='Before',afterLabel='After',before='',after='',options={}}={}){
  const result=compareDocuments(before,after,options),rows=buildSideBySideRows(before,after,options).filter(row=>row.status!=='same');
  const output=[`# ${beforeLabel} ↔ ${afterLabel}`,'',`- Similarity: ${result.stats.similarity}%`,`- Added: ${result.stats.added}`,`- Removed: ${result.stats.removed}`,`- Change blocks: ${result.stats.changes}`,'','## Changes',''];
  if(!rows.length)output.push('No differences found.');
  else for(const row of rows){output.push(`### ${row.beforeNumber??'–'} → ${row.afterNumber??'–'}`,'',`- ${beforeLabel}: ${row.before||'∅'}`,`- ${afterLabel}: ${row.after||'∅'}`,'');}
  return output.join('\n');
}
