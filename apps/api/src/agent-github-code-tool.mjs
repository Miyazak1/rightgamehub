import {normalizeGitHubRepositoryLocator} from './agent-github-repository-tool.mjs';
import {githubRequestHeaders,normalizeGitHubResearchToken,githubRateLimitBackoffSeconds} from './agent-github-research-runtime.mjs';
import {boundedAgentSignal,chargeAgentNetworkRequest} from './agent-execution-context.mjs';
import {stableHash} from './researcher-qa-protocol/stable-json.mjs';

export const GITHUB_CODE_TOOL=Object.freeze({toolKey:'research.github.code.read',contractVersion:1,status:'active',capabilityKey:'research.github.read',riskLevel:'L1',executionClass:'remote',effectClass:'read-only',inputSchema:{key:'github.code.input',version:1},outputSchema:{key:'github.code.output',version:1},networkPolicy:{allowedOrigins:['https://api.github.com'],redirects:'deny',authentication:'none'},filesystemPolicy:{read:false,write:false},timeoutSeconds:40,outputLimitBytes:65536});
const fail=(code,options={})=>{throw Object.assign(new Error(code),{code,...options});};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/u.test(v);
export const validCodePath=v=>typeof v==='string'&&v.length>0&&v.length<=300&&!/[\\\u0000-\u001f\u007f%?#]/u.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..');
const encoded=p=>p.split('/').map(encodeURIComponent).join('/');
export function validateGitHubCodeInput(v){
 if(!v||Object.keys(v).some(k=>!['repository','operation','revision','path','fromLine'].includes(k))||!['inspect','file'].includes(v.operation))fail('AGENT_GITHUB_CODE_INPUT_INVALID',{notDispatched:true});
 const repository=normalizeGitHubRepositoryLocator(v.repository).canonicalUrl,revision=v.revision??null;
 if(revision!==null&&!sha(revision))fail('AGENT_GITHUB_CODE_INPUT_INVALID',{notDispatched:true});
 if(v.operation==='inspect'){if(v.path!=null||v.fromLine!=null)fail('AGENT_GITHUB_CODE_INPUT_INVALID',{notDispatched:true});return {repository,operation:'inspect',revision};}
 if(!sha(revision)||!validCodePath(v.path)||!Number.isSafeInteger(v.fromLine??1)||(v.fromLine??1)<1||(v.fromLine??1)>10000)fail('AGENT_GITHUB_CODE_INPUT_INVALID',{notDispatched:true});
 return {repository,operation:'file',revision,path:v.path,fromLine:v.fromLine??1};
}
export function validateGitHubCodeOutput(v){
 if(!v||v.schemaVersion!=='github-code-v1'||!sha(v.revision)||!['inspect','file'].includes(v.operation)||!Array.isArray(v.files)||v.files.length>500||v.files.some(p=>!validCodePath(p))||typeof v.treeTruncated!=='boolean'||!Array.isArray(v.sources)||v.sources.length>1)fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');
 const repository=normalizeGitHubRepositoryLocator(v.repository).canonicalUrl;if(repository!==v.repository)fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');
 for(const s of v.sources){
  if(!validCodePath(s.path)||!Number.isSafeInteger(s.fromLine)||s.fromLine<1||!Number.isSafeInteger(s.toLine)||s.toLine<s.fromLine||typeof s.text!=='string'||!s.text||Buffer.byteLength(s.text)>18000||s.toLine-s.fromLine+1!==s.text.split('\n').length||typeof s.truncated!=='boolean'||s.sha256!==stableHash(s.text)||s.url!==repository+'/blob/'+v.revision+'/'+encoded(s.path))fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');
 }
 if(v.symbols!=null&&(!Array.isArray(v.symbols)||v.symbols.length>80||v.symbols.some(s=>typeof s.name!=='string'||s.name.length>100||!Number.isSafeInteger(s.line)||s.line<1)))fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');
 if(v.operation==='file'&&v.sources.length!==1)fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');
 if(Buffer.byteLength(JSON.stringify(v))>65536)fail('AGENT_GITHUB_CODE_OUTPUT_INVALID');return structuredClone(v);
}
async function boundedText(response,limit,{prefix=false}={}){
 const reader=response.body.getReader(),chunks=[];let size=0,truncated=false;
 try{while(true){const {done,value}=await reader.read();if(done)break;const remaining=limit-size;if(value.length>remaining){if(!prefix)fail('AGENT_GITHUB_CODE_RESPONSE_TOO_LARGE');chunks.push(value.subarray(0,remaining));truncated=true;break;}chunks.push(value);size+=value.length;}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks),{stream:truncated});}catch{fail('AGENT_GITHUB_CODE_TEXT_INVALID');}
 if(text.includes('\0'))fail('AGENT_GITHUB_CODE_TEXT_INVALID');return {text,truncated};
}
export function createGitHubCodeAdapter({fetchImpl=fetch,token=null}={}){
 token=normalizeGitHubResearchToken(token);
 return async({request,signal})=>{
  const input=validateGitHubCodeInput(request),locator=normalizeGitHubRepositoryLocator(input.repository),base='/repos/'+locator.key;
  const get=async(path,raw=false)=>{
   await chargeAgentNetworkRequest();let r;
   try{r=await fetchImpl('https://api.github.com'+path,{headers:githubRequestHeaders({accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',userAgent:'Mooyu-GitHub-Research/1.0',token}),redirect:'error',signal:boundedAgentSignal(35,signal)});}catch{fail('AGENT_GITHUB_CODE_NETWORK_FAILED',{retryable:true});}
   if(!r.ok){await r.body?.cancel?.().catch(()=>{});fail('AGENT_GITHUB_CODE_HTTP_'+r.status,{retryable:r.status===429||r.status>=500,backoffSeconds:githubRateLimitBackoffSeconds(r)});}return r;
  };
  const json=async path=>{try{return JSON.parse((await boundedText(await get(path),1048576)).text);}catch(e){if(e.code)throw e;fail('AGENT_GITHUB_CODE_RESPONSE_INVALID');}};
  // Recheck public visibility on each invocation, even with a privileged token.
  const metadata=await json(base);if(metadata.private!==false||String(metadata.full_name).toLowerCase()!==locator.key.toLowerCase())fail('AGENT_GITHUB_CODE_PUBLIC_REPOSITORY_REQUIRED');
  let revision=input.revision;
  if(!revision){const ref=await json(base+'/commits/'+encodeURIComponent(metadata.default_branch??'HEAD'));revision=ref.sha;if(!sha(revision))fail('AGENT_GITHUB_CODE_RESPONSE_INVALID');}
  const result={schemaVersion:'github-code-v1',operation:input.operation,repository:input.repository,revision,files:[],treeTruncated:false,sources:[],symbols:[]};
  if(input.operation==='inspect'){
   const tree=await json(base+'/git/trees/'+revision+'?recursive=1');if(!Array.isArray(tree.tree))fail('AGENT_GITHUB_CODE_RESPONSE_INVALID');
   const files=tree.tree.filter(x=>x.type==='blob'&&['100644','100755'].includes(x.mode)&&validCodePath(x.path)).map(x=>x.path);
   // Prioritize entry points, source and tests; a partial tree is explicitly marked.
   files.sort((a,b)=>(/^(src|lib|test|tests)\//u.test(b)?1:0)-(/^(src|lib|test|tests)\//u.test(a)?1:0)||a.localeCompare(b));
   let size=0;for(const p of files){const bytes=Buffer.byteLength(JSON.stringify(p))+1;if(result.files.length>=500||size+bytes>20000)break;result.files.push(p);size+=bytes;}
   result.treeTruncated=tree.truncated===true||files.length>result.files.length;
  }else{
   const {text,truncated}=await boundedText(await get(base+'/contents/'+encoded(input.path)+'?ref='+revision,true),262144,{prefix:true});
   const all=text.replace(/\r\n/gu,'\n').split('\n');if(input.fromLine>all.length)fail('AGENT_GITHUB_CODE_LINE_NOT_AVAILABLE');
   // A lexical outline is only a locator for the next read, never evidence of
   // a function's behavior. It does not execute or parse untrusted programs.
   for(const [i,line]of all.entries()){
    const name=line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function\*?|def|fn)\s+([A-Za-z_$][\w$]*)\s*[(<]/u)?.[1]
     ??line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=.*=>/u)?.[1];
    if(name&&name.length<=100)result.symbols.push({name,line:i+1});if(result.symbols.length===80)break;
   }
   const lines=[];let bytes=0;for(const line of all.slice(input.fromLine-1,input.fromLine+139)){const n=Buffer.byteLength(line)+(lines.length?1:0);if(bytes+n>4000)break;lines.push(line);bytes+=n;}
   const excerpt=lines.join('\n');if(!excerpt)fail('AGENT_GITHUB_CODE_LINE_NOT_AVAILABLE');
   result.sources=[{path:input.path,url:input.repository+'/blob/'+revision+'/'+encoded(input.path),fromLine:input.fromLine,toLine:input.fromLine+lines.length-1,text:excerpt,truncated:truncated||input.fromLine>1||input.fromLine+lines.length-1<all.length,sha256:stableHash(excerpt)}];
  }
  const output=validateGitHubCodeOutput(result);return {receiptId:'github-code:'+stableHash(output),output,responseRef:{type:'github-code',repository:input.repository,revision}};
 };
}
