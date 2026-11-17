// Explicit local acceptance only. Never imported by the application or test inventory.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function main(){
 if(process.argv[2]!=='--run'||!process.argv[3])throw Error('Usage: --run /absolute/path/to/model.env');
 if(process.env.QA_LEDGER_TEST_ISOLATED!=='1'||!/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:\d+\/qa_ledger_test_[a-f0-9]{32}$/.test(process.env.QA_LEDGER_TEST_URL??''))throw Error('ISOLATED_DATABASE_REQUIRED');
 for(const key of ['PAPER_STUDY_ENABLED','PAPER_STUDY_WORKER_ENABLED','PAPER_STUDY_MODELS_ENABLED','PAPER_STUDY_PUBLISH_ENABLED'])process.env[key]='false';
 const settings={};for(const line of (await fs.readFile(path.resolve(process.argv[3]),'utf8')).split(/\r?\n/)){
  const match=line.match(/^(DEEPSEEK_API_KEY|DEEPSEEK_MODEL|GITHUB_RESEARCH_TOKEN|AGENT_GITHUB_RESEARCH_TOKEN)=(.*)$/);
  if(match)settings[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2');
 }
 if(!settings.DEEPSEEK_API_KEY||!settings.DEEPSEEK_MODEL)throw Error('LOCAL_MODEL_CONFIGURATION_REQUIRED');
 const directory=await fs.mkdtemp(path.resolve('.runtime/blog-public-live-'));
 const report={passed:false,productionConnected:false,paperEnabled:false,modelId:settings.DEEPSEEK_MODEL,
  realGitHub:true,realModel:true,manualOutputEdits:false,providerCalls:[],directory};
 const save=()=>fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
 const load=file=>import('../apps/api/src/'+file);
 const {createGitHubRepositorySearchAdapter}=await load('agent-github-repository-search-tool.mjs');
 const {createGitHubRepositoryReadAdapter}=await load('agent-github-repository-tool.mjs');
 const {createGitHubRepositoryMaterialsAdapter}=await load('agent-github-repository-materials-tool.mjs');
 const {createAgentDeepSeekProviderAdapter}=await load('agent-deepseek-provider-adapter.mjs');
 let token=settings.AGENT_GITHUB_RESEARCH_TOKEN??settings.GITHUB_RESEARCH_TOKEN??null;
 if(!token&&process.argv.includes('--git-credential')){
  const result=require('node:child_process').spawnSync('git',['credential','fill'],{
   input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,timeout:15000,
   env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
  if(result.status===0)token=result.stdout.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9)??null;
  if(!token)throw Error('EXISTING_GITHUB_LOGIN_UNAVAILABLE');
 }
 const adapter=createAgentDeepSeekProviderAdapter(),cleanups=[];let database;
 console.log(JSON.stringify({event:'start',directory,modelId:settings.DEEPSEEK_MODEL,githubAuthenticated:!!token}));
 await save();
 try{
  const {publicPipelineFixture}=require('../tests/platform/agent-blog-public-pipeline-db.test.cjs');
  await publicPipelineFixture({after:fn=>cleanups.push(fn)},{live:{modelId:settings.DEEPSEEK_MODEL,apiKey:settings.DEEPSEEK_API_KEY,githubAuthenticated:!!token,
   onDatabase:pool=>database=pool,
   toolAdapters:{'research.github.repository.search@1':createGitHubRepositorySearchAdapter({token}),
    'research.github.repository.read@1':createGitHubRepositoryReadAdapter({token}),
    'research.github.repository.materials.read@1':createGitHubRepositoryMaterialsAdapter({token})},
   providerAdapter:async input=>{
    const call={schema:input.responseSchema.key,startedAt:new Date().toISOString(),requestSha256:crypto.createHash('sha256').update(JSON.stringify(input.request)).digest('hex')};
    report.providerCalls.push(call);await save();console.log(JSON.stringify({event:'provider-start',schema:call.schema}));
    try{const result=await adapter(input);Object.assign(call,{completed:true,providerRequestId:result.providerRequestId,usage:result.usage});return result;}
    catch(error){call.errorCode=error.code??'PROVIDER_FAILED';throw error;}
    finally{await save();}
   },onComplete:async result=>{report.acceptance=result;await save();}
  }});
 }catch(error){
  report.error={code:error.code??'LOCAL_ACCEPTANCE_FAILED',message:String(error.message).slice(0,500),details:error.details};
  if(database){
   report.stages=(await database.query('SELECT stage_key,status,error_code FROM agent_run_stages ORDER BY created_at,ordinal')).rows;
   report.runs=(await database.query('SELECT id,workflow_key,status,error_code FROM agent_runs ORDER BY created_at')).rows;
  }
  await save();throw error;
 }finally{
  if(database){await database.query('DELETE FROM agent_provider_secrets');report.temporaryCredentialsRemoved=true;await save();}
  for(const close of cleanups.reverse())await close();
 }
 report.passed=true;await save();
 console.log(JSON.stringify({event:'passed',directory,providerCalls:report.providerCalls.length,receipts:report.acceptance.receipts}));
}
main().catch(error=>{console.error(JSON.stringify({event:'failed',code:error.code??'LOCAL_ACCEPTANCE_FAILED',message:String(error.message).slice(0,500)}));process.exitCode=1;});
