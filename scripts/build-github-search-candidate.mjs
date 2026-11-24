import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync}from'node:child_process';
const base='sha256:b67910da86d687e0485b14b583ce31ac814a89f9421069abe125ce36b69c7abe';
const files=['agent-github-repository-search-tool.mjs','agent-interaction-github.mjs','agent-blog-public-request-repository.mjs','agent-interaction-contracts.mjs','platform-assistant.mjs',...['search','admission','index','tools'].map(n=>'agent-plugins/github/'+n+'.mjs')];
const out=path.resolve(process.argv[2]??''),tag='mooyu-github-search:20261123-r1',alias='mooyu-github-search-base:20261123-b67910';
if(!process.argv[2]||!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_BUILD_PATH_REQUIRED');
const docker=args=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4000000});if(r.status!==0)throw Error('LOCAL_BUILD_'+args[0]+'_FAILED');return r.stdout.trim();};
if(spawnSync('docker',['image','inspect',tag],{stdio:'ignore'}).status===0)throw Error('NEW_TAG_REQUIRED');
const original=JSON.parse(docker(['image','inspect',base]))[0],prior=spawnSync('docker',['image','inspect',alias],{encoding:'utf8'});
if(prior.status===0){if(JSON.parse(prior.stdout)[0].Id!==base)throw Error('BASE_ALIAS_CONFLICT');}else docker(['tag',base,alias]);
fs.mkdirSync(out,{recursive:true});const ctx=path.join(out,'context');fs.mkdirSync(ctx);const sources=[];
for(const f of files){const source=fs.readFileSync(path.resolve('apps/api/src',f)),dest=path.join(ctx,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source);sources.push({path:'/app/apps/api/src/'+f,sha256:crypto.createHash('sha256').update(source).digest('hex')});}
fs.writeFileSync(path.join(ctx,'Dockerfile'),'FROM '+alias+'\n'+files.map(f=>'COPY '+f+' /app/apps/api/src/'+f).join('\n')+'\n');
docker(['build','--network','none','--pull=false','-t',tag,ctx]);const candidate=JSON.parse(docker(['image','inspect',tag]))[0];
if(JSON.stringify(candidate.Config)!==JSON.stringify(original.Config)||JSON.stringify(candidate.RootFS.Layers.slice(0,original.RootFS.Layers.length))!==JSON.stringify(original.RootFS.Layers))throw Error('BASE_CONFIGURATION_CHANGED');
const check=`const fs=require('fs'),crypto=require('crypto');const sources=${JSON.stringify(sources)};for(const s of sources)if(crypto.createHash('sha256').update(fs.readFileSync(s.path)).digest('hex')!==s.sha256)throw Error('IMAGE_SOURCE_MISMATCH');console.log('IMAGE_SOURCES_VERIFIED');`;
docker(['run','--rm','--pull','never','--network','none','--read-only','--entrypoint','node',candidate.Id,'-e',check]);
const proof={result:'CANDIDATE_BUILT',image:candidate.Id,tag,baseImage:base,configPreserved:true,migrationsAdded:false,files:sources,productionChanged:false};fs.writeFileSync(path.join(out,'build-proof.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
