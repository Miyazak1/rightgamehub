import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {SCOPES_BASE,RECOVERY_BASE,scopesUpdater} from './github-search-scopes-release.mjs';
import {addQQApplicationGate} from './integrate-qq-release-guard.mjs';
export function formatUpdater(original,{base='sha256:8f72cb8afcbfe2fb33730c467668f007b6cdc23a8a1a3f9c70851155efcab1e2',operationPrefix='github-search-plan-format-operation-20261123-'}={}){
 let s=original;
 const once=(a,b)=>{if(s.split(a).length!==2)throw Error('UPDATER_ANCHOR_REQUIRED');s=s.replace(a,b);};
 once("import {Cutover,composeArgs,fingerprint,PAPER_KEYS}from'./agent-server-cutover.mjs';","import {Cutover,composeArgs,fingerprint,PAPER_KEYS}from'./agent-server-cutover.mjs';\nimport {verifyDeclaredRuntime}from'./github-search-runtime-verification.mjs';");
 once("const BASE='sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';","const BASE='"+base+"';");
 const start=s.indexOf(' function assertRecreated('),end=s.indexOf('\n async function backup(',start);
 if(start<0||end<0)throw Error('ASSERT_ANCHOR_REQUIRED');
 s=s.slice(0,start)+` function assertRecreated(role,selected,overlay){
  const c=inspect(role.container),model=JSON.parse(composed(role,overlay,['--profile','*','config','--format','json'])),service=model.services[role.compose.service],image=JSON.parse(docker(['image','inspect',selected]))[0],base=JSON.parse(docker(['image','inspect',role.image]))[0];
  if(!c.State.Running||c.Image!==selected||fingerprint({...c,Image:role.image})!==role.fingerprint||hash(composeArgs(c).args)!==hash([...role.compose.args,'-f',overlay]))fail('RECREATED_CONFIGURATION_MISMATCH');
  if(hash(image.Config)!==hash(base.Config))fail('IMAGE_RUNTIME_CONFIGURATION_CHANGED');
  const before=JSON.parse(composed(role,null,['--profile','*','config','--format','json'])).services[role.compose.service];
  if(Object.keys({...before,...service}).some(k=>k!=='image'&&hash(before[k]??null)!==hash(service[k]??null)))fail('NON_IMAGE_COMPOSE_CHANGE');
  reader.record=directory;reader.processEnv=processEnv;reader.captureRole(structuredClone(role),path.basename(overlay));verifyDeclaredRuntime(c,service,image);
 }
`+s.slice(end);
 once("compareModel(role);roles.push(role);","compareModel(role);reader.processEnv=processEnv;reader.captureRole(structuredClone(role),null);verifyDeclaredRuntime(c,JSON.parse(composed(role,null,['--profile','*','config','--format','json'])).services[role.compose.service],JSON.parse(docker(['image','inspect',role.image]))[0]);roles.push(role);");
 once("if(mode==='rollback'&&hash(roles.map(r=>r.comparableHash))!==hash(previous.roles.map(r=>r.comparableHash)))fail('ROLLBACK_CONFIG_DRIFT');","if(mode==='rollback'&&roles.some(r=>{const old=previous.roles.find(p=>p.container===r.container);return !old||fingerprint({...inspect(r.container),Image:old.image})!==old.fingerprint;}))fail('ROLLBACK_CONFIG_DRIFT');");
 once("bootstrap:async()=>{if(mode==='upgrade'){setPhase('register-additive-search-contract-and-workflow');docker(['exec',UPDATE_NAMES[0],'node','apps/api/src/agent-interaction-bootstrap-cli.mjs']);if(Number(q('api',ONLINE_SQL.registered))!==1)fail('SEARCH_WORKFLOW_NOT_REGISTERED');}},","bootstrap:async()=>{setPhase('verify-existing-search-workflow-no-registration');if(Number(q('api',ONLINE_SQL.registered))!==1)fail('SEARCH_WORKFLOW_NOT_REGISTERED');},");
 once("ROOT+'/github-search-operation-20261123-'","ROOT+'/"+operationPrefix+"'");
 once("recordArg?.startsWith(ROOT+'/github-search-operation-')","recordArg?.startsWith(ROOT+'/"+operationPrefix+"')");
 return s;
}
export function buildFormatRelease(out,variant='plan-format',resumeTests=false){
 if(!['plan-format','receipts','verification','scopes','recovery'].includes(variant))throw Error('UNKNOWN_PATCH_VARIANT');
 if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out)!==resumeTests)throw Error('NEW_BUILD_PATH_OR_EXISTING_TEST_RESUME_REQUIRED');
 if(resumeTests&&['build-proof.json','update-github-search-online.mjs','images.tar'].some(n=>fs.existsSync(path.join(out,n))))throw Error('ONLY_FAILED_TEST_STAGE_CAN_RESUME');
 const run=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:4000000,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0]+'_FAILED');return r.stdout?.trim()??'';};
 const date=['scopes','recovery'].includes(variant)?'20261124':'20261123';
 const base=variant==='recovery'?RECOVERY_BASE:variant==='scopes'?SCOPES_BASE:variant==='verification'?'sha256:990c3a3c6b229e99afd3cf903ccc0392dae3c906ab8897df6ee68fe96308d61b':variant==='receipts'?'sha256:a48de95df41613c4e0c455850a47cbfd83abfdda052ca4516125e85c780fcf3a':'sha256:8f72cb8afcbfe2fb33730c467668f007b6cdc23a8a1a3f9c70851155efcab1e2',tag='mooyu-github-search:'+date+'-'+variant+'-r1',alias='mooyu-github-search-base:'+date+'-'+base.slice(7,13);
 const original=JSON.parse(run(['image','inspect',base]))[0];if((spawnSync('docker',['image','inspect',tag],{stdio:'ignore'}).status===0)!==resumeTests)throw Error('NEW_TAG_OR_EXISTING_TEST_IMAGE_REQUIRED');
 const a=spawnSync('docker',['image','inspect',alias],{encoding:'utf8'});if(a.status===0){if(JSON.parse(a.stdout)[0].Id!==base)throw Error('BASE_ALIAS_CONFLICT');}else run(['tag',base,alias]);
 if(!resumeTests)fs.mkdirSync(out,{recursive:true});const ctx=path.join(out,'context');if(!resumeTests)fs.mkdirSync(ctx);
 const files=variant==='receipts'?['agent-interaction-task-receipts.mjs','agent-interaction-service.mjs','agent-interaction-conversation.mjs','platform-assistant.mjs']:['agent-plugins/github/search.mjs'];
 const sources=files.map((f,i)=>{const b=fs.readFileSync(path.join('apps/api/src',f)),name='source-'+i+'.mjs';if(resumeTests){if(!fs.readFileSync(path.join(ctx,name)).equals(b))throw Error('ORIGINAL_TESTED_SOURCE_CHANGED');}else fs.writeFileSync(path.join(ctx,name),b);return {path:'/app/apps/api/src/'+f,name,sha256:crypto.createHash('sha256').update(b).digest('hex')};});
 const dockerfile='FROM '+alias+'\n'+sources.map(f=>'COPY --chmod=0444 '+f.name+' '+f.path).join('\n')+'\n';
 if(resumeTests){if(fs.readFileSync(path.join(ctx,'Dockerfile'),'utf8')!==dockerfile)throw Error('ORIGINAL_BUILD_CONTEXT_CHANGED');}else{fs.writeFileSync(path.join(ctx,'Dockerfile'),dockerfile);run(['build','--network','none','--pull=false','-t',tag,ctx]);}
 const image=JSON.parse(run(['image','inspect',tag]))[0];if(JSON.stringify(image.Config)!==JSON.stringify(original.Config)||JSON.stringify(image.RootFS.Layers.slice(0,original.RootFS.Layers.length))!==JSON.stringify(original.RootFS.Layers))throw Error('BASE_CONFIG_OR_LAYERS_CHANGED');
 const probe="const fs=require('fs'),c=require('crypto');for(const f of "+JSON.stringify(sources)+")if(c.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)throw Error('IMAGE_SOURCE_MISMATCH');console.log('IMAGE_SOURCES_VERIFIED');";
 run(['run','--rm','--network','none','--read-only','--entrypoint','node',image.Id,'-e',probe]);
 const tests=variant==='receipts'?['agent-task-receipt-grounding.test.mjs','platform-assistant.test.cjs','agent-interaction.test.mjs','github-search-plan-format.test.mjs','github-search-quality.test.mjs']:['verification','scopes','recovery'].includes(variant)?['github-search-plan-format.test.mjs','github-search-quality.test.mjs','github-search-verification-format.test.mjs','agent-task-receipt-grounding.test.mjs',...(['scopes','recovery'].includes(variant)?['github-search-requirement-scopes.test.mjs']:[]),...(variant==='recovery'?['github-search-verification-recovery.test.mjs']:[])]:['github-search-plan-format.test.mjs','github-search-quality.test.mjs'],args=['run','--rm','--network','none','--read-only','--entrypoint','node'];for(const t of tests)args.push('--mount','type=bind,source='+path.resolve('tests/platform',t)+',target=/app/tests/platform/'+t+',readonly');
 if(variant==='receipts')for(const p of ['apps/qq-channel/src','packages/platform-client/src'])args.push('--mount','type=bind,source='+path.resolve(p)+',target=/app/'+p+',readonly');
 const testOut=resumeTests?path.join(out,'image-acceptance-r2'):out;if(resumeTests)fs.mkdirSync(testOut);
 const r=spawnSync('docker',[...args,image.Id,'--test',...tests.map(t=>'/app/tests/platform/'+t)],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4000000});fs.writeFileSync(path.join(testOut,'image-tests.tap'),r.stdout??'');fs.writeFileSync(path.join(testOut,'image-tests.stderr.txt'),r.stderr??'');if(r.status!==0)throw Error('ACTUAL_IMAGE_TESTS_FAILED');
 const formatted=formatUpdater(fs.readFileSync('scripts/update-github-search-online.mjs','utf8'),{base,operationPrefix:'github-search-'+variant+'-operation-'+date+'-'}),updater=addQQApplicationGate(['scopes','recovery'].includes(variant)?scopesUpdater(formatted,{variant}):formatted);if(spawnSync(process.execPath,['--input-type=module','--check'],{input:updater,encoding:'utf8'}).status!==0)throw Error('UPDATER_SYNTAX_FAILED');fs.writeFileSync(path.join(out,'update-github-search-online.mjs'),updater);
 const proof={result:'PASSED',variant,image:image.Id,tag,baseImage:base,configPreserved:true,baseLayersPreserved:true,applicationSourceFromImage:true,actualImageTests:true,changedSources:sources.map(({name,...f})=>f),migrationsAdded:false,productionChanged:false};fs.writeFileSync(path.join(out,'build-proof.json'),JSON.stringify(proof,null,2)+'\n');run(['save','--output',path.join(out,'images.tar'),tag]);console.log(JSON.stringify(proof));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')))buildFormatRelease(process.argv[2],process.argv[3],process.argv[4]==='resume-tests');
