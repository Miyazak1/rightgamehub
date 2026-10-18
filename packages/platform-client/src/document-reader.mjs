import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
export const COMPARABLE_ACCEPT='.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.pdf,.docx,text/plain,text/markdown,text/csv,text/html,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const maxBytes=40*1024*1024,maxPages=160,maxChars=2_000_000;
const extension=name=>(String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1]||'');
const limited=text=>{const value=String(text??'');if(value.length>maxChars)throw Object.assign(new Error('DOCUMENT_TEXT_TOO_LARGE'),{code:'DOCUMENT_TEXT_TOO_LARGE'});return value;};

async function readPdf(file,onProgress){
  const source=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  try{
    if(source.numPages>maxPages)throw Object.assign(new Error('DOCUMENT_PAGE_LIMIT'),{code:'DOCUMENT_PAGE_LIMIT'});
    const pages=[];
    for(let pageNumber=1;pageNumber<=source.numPages;pageNumber++){
      onProgress?.({page:pageNumber,total:source.numPages});
      const content=await (await source.getPage(pageNumber)).getTextContent();
      pages.push((content.items||[]).map(item=>`${item.str||''}${item.hasEOL?'\n':' '}`).join('').replace(/[ \t]+\n/gu,'\n').trim());
      limited(pages.join('\n\n'));
    }
    return {text:pages.join('\n\n'),pages:source.numPages,kind:'pdf'};
  }finally{await source.destroy();}
}

export async function readComparableFile(file,{onProgress}={}){
  if(!file)throw Object.assign(new Error('DOCUMENT_FILE_REQUIRED'),{code:'DOCUMENT_FILE_REQUIRED'});
  if(file.size>maxBytes)throw Object.assign(new Error('DOCUMENT_FILE_TOO_LARGE'),{code:'DOCUMENT_FILE_TOO_LARGE'});
  const ext=extension(file.name);
  if(ext==='pdf'||file.type==='application/pdf')return {...await readPdf(file,onProgress),name:file.name,size:file.size};
  if(ext==='docx'||file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
    const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    return {name:file.name,size:file.size,kind:'docx',text:limited(result.value),warnings:result.messages?.length||0};
  }
  if(!['txt','md','markdown','json','csv','tsv','html','htm'].includes(ext)&&!/^text\//u.test(file.type||''))throw Object.assign(new Error('DOCUMENT_TYPE_UNSUPPORTED'),{code:'DOCUMENT_TYPE_UNSUPPORTED'});
  let text=await file.text();
  if(ext==='html'||ext==='htm'||file.type==='text/html')text=new DOMParser().parseFromString(text,'text/html').body?.textContent||'';
  if(ext==='json'||file.type==='application/json'){try{text=JSON.stringify(JSON.parse(text),null,2);}catch{/* compare malformed JSON as plain text */}}
  return {name:file.name,size:file.size,kind:ext||'text',text:limited(text)};
}
