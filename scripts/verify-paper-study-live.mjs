import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPaperStudyApiFixture} from '../tests/desktop/paper-study-api-fixture.mjs';
import {createPaperStudyModelProcessor,createPaperStudyPublicSourceResolver} from '../apps/api/src/paper-study-model-processor.mjs';
import {createArxivPaperReadAdapter} from '../apps/api/src/agent-arxiv-paper-tool.mjs';
import {createAgentDeepSeekProviderAdapter} from '../apps/api/src/agent-deepseek-provider-adapter.mjs';
import {stableHash} from '../apps/api/src/researcher-qa-protocol/stable-json.mjs';
import {PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW} from '../apps/api/src/agent-paper-article-workflow.mjs';

if(process.argv.length!==2)throw Error('PAPER_STUDY_LIVE_ARGUMENTS');
const root=fileURLToPath(new URL('../',import.meta.url));
// Read only the model fields and arXiv contact. Never execute this file as code.
const text=await fs.readFile(path.join(root,'.env.paper-text-draft.local'),'utf8');
const settings=Object.fromEntries(text.split(/\r?\n/).filter(s=>/^(DEEPSEEK_API_KEY|DEEPSEEK_MODEL|AGENT_ARXIV_CONTACT_EMAIL)=/.test(s)).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')];}));
const apiKey=settings.DEEPSEEK_API_KEY,modelId=settings.DEEPSEEK_MODEL;
if(!apiKey||!modelId)throw Error('LOCAL_MODEL_CONFIGURATION_REQUIRED');
const clean=JSON.parse(await fs.readFile(path.join(root,'.runtime/paper-study/clean-latest.json')));
if(!clean.passed)throw Error('CLEAN_BUILD_REQUIRED');
const source=path.join(clean.directory,'source');
for(const file of ['packages/platform-client/src/PaperStudyTool.jsx','packages/platform-client/src/PaperStudyTool.css'])
  if(!(await fs.readFile(path.join(root,file))).equals(await fs.readFile(path.join(source,file))))throw Error('PAPER_STUDY_UI_BUILD_STALE');
const pdf=path.join(root,'.runtime/paper-layout-audit/1706.03762v7.pdf');
const sourceSha256=crypto.createHash('sha256').update(await fs.readFile(pdf)).digest('hex');
if(sourceSha256!=='bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697')throw Error('PAPER_STUDY_SAMPLE_CHANGED');
await fs.mkdir(path.join(root,'.runtime/paper-study'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.runtime/paper-study/live-'));
const profileRoot=path.join(directory,'profile');await fs.mkdir(profileRoot);
const otpFile=path.join(directory,'otp.txt'),result=path.join(directory,'window-result.json'),config=path.join(directory,'launch.json');
const report={passed:false,directory,modelId,articleWorkflowVersion:PAPER_ARTICLE_DRAFT_SHADOW_WORKFLOW.workflowVersion,sourceSha256,productionConnected:false,realAccountUsed:false,modelInvoked:false,manualOutputEdits:false,retries:0,published:false,providerCalls:[],artifacts:[],checks:[]};
const save=()=>fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
const safeError=e=>/^[A-Z][A-Z0-9_]{2,100}$/.test(e?.code??e?.message??'')?(e.code??e.message):'PAPER_STUDY_LIVE_FAILED';
const abort=new AbortController();let backend,child,stopped=false;
const fetchIsolated=(url,options={})=>{
  const target=new URL(url);
  if(target.protocol!=='https:'||!['arxiv.org','export.arxiv.org','api.deepseek.com'].includes(target.hostname)||target.username||target.password||target.port)throw Error('PAPER_STUDY_NETWORK_DENIED');
  abort.signal.throwIfAborted();
  return fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,abort.signal]):abort.signal});
};
try{
  const adapter=createAgentDeepSeekProviderAdapter({fetchImpl:fetchIsolated});
  const resolve=createPaperStudyPublicSourceResolver({readArxiv:createArxivPaperReadAdapter({fetchImpl:fetchIsolated,contactEmail:settings.AGENT_ARXIV_CONTACT_EMAIL??process.env.AGENT_ARXIV_CONTACT_EMAIL})});
  const processor=createPaperStudyModelProcessor({modelId,
    resolvePublicSource:async(hash,id)=>{
      console.log(JSON.stringify({stage:'verify-public-source',arxivId:id}));
      const metadata=await resolve(hash,id);report.publicSourceVerified=true;report.checks.push('Public arXiv PDF hash matches imported bytes');await save();return metadata;
    },
    onArtifact:async row=>{
      const name=`artifact-${report.artifacts.length+1}-${row.artifactKey.replace(/[^a-z0-9.-]/gi,'_')}.json`;
      await fs.writeFile(path.join(directory,name),JSON.stringify(row,null,2),{flag:'wx'});
      report.artifacts.push({artifactKey:row.artifactKey,file:name,contentSha256:row.contentSha256});await save();
    },
    providerGateway:{async invoke(request){
      if(stopped)throw Error('PAPER_STUDY_RUN_STOPPED');
      const index=report.providerCalls.length+1,stage=request.action.actionKey;
      const prefix=`call-${String(index).padStart(2,'0')}-${stage.replace(/[^a-z0-9-]/gi,'_')}`;
      const call={index,stage,promptVersion:request.promptTemplate.version,status:'running',requestSha256:stableHash(request.request),startedAt:new Date().toISOString()};
      report.providerCalls.push(call);report.modelInvoked=true;await fs.writeFile(path.join(directory,prefix+'-request.json'),JSON.stringify(request.request,null,2),{flag:'wx'});await save();
      console.log(JSON.stringify({stage,index,status:'model-request-started'}));
      try{
        const receipt=await adapter({apiKey,modelId,request:request.request,tokenCeiling:request.tokenCeiling,timeoutSeconds:Math.min(240,request.timeoutSeconds),idempotencyKey:request.idempotencyKey});
        await fs.writeFile(path.join(directory,prefix+'-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
        Object.assign(call,{status:'succeeded',responseSha256:stableHash(receipt.output),usage:receipt.usage,finishedAt:new Date().toISOString()});await save();
        console.log(JSON.stringify({stage,index,status:'model-response-received'}));
        return {...receipt,status:'succeeded',actionId:crypto.randomUUID(),provider:'deepseek',modelId};
      }catch(error){stopped=true;Object.assign(call,{status:'failed',errorCode:safeError(error),finishedAt:new Date().toISOString()});await save();throw error;}
    }},
  });
  backend=await createPaperStudyApiFixture({processor,mode:'isolated-live',onMail:code=>fs.writeFile(otpFile,code,{mode:0o600})});
  await fs.writeFile(config,JSON.stringify({live:true,accountApiOrigin:backend.origin,otpFile,profileRoot,result,pdf,assetRoot:path.join(source,'.runtime/desktop-shell/web')}));
  await save();console.log(JSON.stringify({directory,modelId,mode:'isolated-live',productionConnected:false}));
  const electron=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-shell/launch.json'))).electronExecutable;
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_MODEL;
  await new Promise((resolve,reject)=>{
    child=spawn(electron,[path.join(root,'tests/desktop/electron-paper-study-acceptance.cjs'),config],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{abort.abort();child.kill();reject(Error('PAPER_STUDY_LIVE_TIMEOUT'));},30*60_000);
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);
    child.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(directory,'electron.log'),output);code===0?resolve():reject(Error('PAPER_STUDY_WINDOW_STOPPED'));});
  });
  const window=JSON.parse(await fs.readFile(result));if(!window.passed)throw Error('PAPER_STUDY_WINDOW_STOPPED');
  const papers=backend.service.list({userId:'31e033b2-13d6-4b81-b214-21b3f25dca60'});
  if(papers.length!==1||papers[0].status!=='draft-ready'||papers[0].draft?.publicPublicationEnabled!==false||papers[0].draft?.publicationState!=='draft')throw Error('PAPER_STUDY_PRIVATE_DRAFT_REQUIRED');
  report.window=window;report.checks.push(...window.checks);report.passed=true;
}catch(error){
  stopped=true;report.errorCode=safeError(error);
}finally{
  abort.abort();
  if(backend){await Promise.allSettled(backend.repository.list('31e033b2-13d6-4b81-b214-21b3f25dca60').map(row=>row.job));const papers=backend.service.list({userId:'31e033b2-13d6-4b81-b214-21b3f25dca60'});await fs.writeFile(path.join(directory,'paper-results.json'),JSON.stringify(papers,null,2));report.paperStates=papers.map(p=>({id:p.id,status:p.status,errorCode:p.errorCode,analysisPresent:!!p.analysis,draftPresent:!!p.draft}));await backend.close();}
  await fs.rm(otpFile,{force:true});await save();
  await fs.writeFile(path.join(root,'.runtime/paper-study/live-latest.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({passed:report.passed,directory,modelId,modelCalls:report.providerCalls.length,paperStates:report.paperStates,errorCode:report.errorCode,productionConnected:false,published:false},null,2));
if(!report.passed)process.exitCode=1;
