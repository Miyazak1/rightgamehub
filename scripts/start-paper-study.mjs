import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createPaperStudyApiFixture} from '../tests/desktop/paper-study-api-fixture.mjs';
import {createPaperStudyModelProcessor,createPaperStudyPublicSourceResolver} from '../apps/api/src/paper-study-model-processor.mjs';
import {createAgentDeepSeekProviderAdapter} from '../apps/api/src/agent-deepseek-provider-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),live=process.argv.length===3&&process.argv[2]==='--live';
if(process.argv.length!==2&&!live)throw Error('PAPER_STUDY_OPTIONS_INVALID');
if(live&&(!process.env.DEEPSEEK_API_KEY||!process.env.DEEPSEEK_MODEL))throw Error('LOCAL_MODEL_CONFIGURATION_REQUIRED');
let processor;
if(live){
  const adapter=createAgentDeepSeekProviderAdapter();
  processor=createPaperStudyModelProcessor({modelId:process.env.DEEPSEEK_MODEL,resolvePublicSource:createPaperStudyPublicSourceResolver(),providerGateway:{async invoke(request){
    const receipt=await adapter({apiKey:process.env.DEEPSEEK_API_KEY,modelId:process.env.DEEPSEEK_MODEL,request:request.request,tokenCeiling:request.tokenCeiling,timeoutSeconds:Math.min(540,request.timeoutSeconds),idempotencyKey:request.idempotencyKey});
    return {...receipt,status:'succeeded',actionId:crypto.randomUUID(),provider:'deepseek',modelId:process.env.DEEPSEEK_MODEL};
  }}});
}
const backend=await createPaperStudyApiFixture({processor,mode:live?'isolated-live':'isolated-replay',onMail:code=>process.stdout.write('Local test OTP: '+code+'\n')});
await fs.mkdir(path.join(root,'.runtime/paper-study'),{recursive:true});
const directory=await fs.mkdtemp(path.join(root,'.runtime/paper-study/manual-')),profileRoot=path.join(directory,'profile');await fs.mkdir(profileRoot);
const config=path.join(directory,'launch.json'),launch=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-shell/launch.json')));
const clean=JSON.parse(await fs.readFile(path.join(root,'.runtime/paper-study/clean-latest.json')));
if(!clean.passed)throw Error('PAPER_STUDY_CLEAN_BUILD_REQUIRED');
const assetRoot=path.join(clean.directory,'source/.runtime/desktop-shell/web');
await fs.writeFile(config,JSON.stringify({assetRoot,profileRoot,accountApiOrigin:backend.origin,accountEnvironment:'local-test',initialRoute:'/tools/paper-study?lang=zh-CN'}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_MODEL;
console.log(JSON.stringify({origin:backend.origin,mode:live?'isolated-live':'isolated-replay',profileRoot,productionConnected:false,modelEnabled:live,note:'Use any @example.test email. OTP is printed only in this terminal. Library is ephemeral; do not import private documents.'}));
const child=spawn(launch.electronExecutable,[path.join(root,'apps/desktop/electron/main.cjs'),'--config',config],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stderr.on('data',()=>{});child.on('error',async()=>{await backend.close();process.exitCode=1;});
child.on('exit',async code=>{await backend.close();process.exitCode=code??1;});
