// Offline image assembly only. Does not inspect services, mount credentials, migrate or deploy.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),out=args[args.indexOf('--out-dir')+1];
if(!args.includes('--out-dir')||!out)throw Error('OUTPUT_DIRECTORY_REQUIRED');const output=path.resolve(out);
const buildRoot=path.resolve('E:/CodexData/build/Right/agent-plugin-release');if(!output.startsWith(buildRoot+path.sep)||fs.existsSync(output))throw Error('NEW_TASK_BUILD_DIRECTORY_REQUIRED');
const run=(cmd,argv,options={})=>{const r=spawnSync(cmd,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:5000000,...options});if(r.status!==0){if(fs.existsSync(output))fs.writeFileSync(path.join(output,'last-command-error.txt'),String(r.stderr??''));throw Error('RELEASE_'+cmd.toUpperCase()+'_FAILED');}return Buffer.isBuffer(r.stdout)?r.stdout:r.stdout.trim();};
const commit=run('git',['rev-parse',args.includes('--source-commit')?args[args.indexOf('--source-commit')+1]:'1553c613']);if(!commit.startsWith('1553c613'))throw Error('VERIFIED_RELEASE_BASE_REQUIRED');
fs.mkdirSync(output,{recursive:true});const files=run('git',['ls-tree','-r','--name-only',commit]).split('\n').filter(f=>f.startsWith('apps/api/src/')||f.startsWith('apps/api/migrations/')||f.startsWith('apps/qq-channel/src/'));
const checksums=[];
for(const file of files){const bytes=run('git',['show',commit+':'+file],{encoding:null});const target=path.join(output,'context',file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);checksums.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});}
// Images reuse existing installed dependencies only if their manifests exactly match this source.
const roles=[{role:'api',base:'mooyu-qq-compatible-api:20261120-55b2f7e8',pkg:'apps/api/package.json'},{role:'worker',base:'mooyu-qq-compatible-worker:20261120-55b2f7e8',pkg:'apps/qq-channel/package.json'}],images={};
for(const item of roles){
 const baseId=run('docker',['image','inspect','--format','{{.Id}}',item.base]);
 const source=JSON.parse(run('git',['show',commit+':'+item.pkg]));
 const installed=JSON.parse(run('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--entrypoint','cat',item.base,'/app/'+item.pkg]));
 if(JSON.stringify(source.dependencies)!==JSON.stringify(installed.dependencies))throw Error('RELEASE_DEPENDENCY_MANIFEST_MISMATCH');
 const context=path.join(output,'context'),dockerfile=path.join(context,'Dockerfile.'+item.role),tag=`mooyu-agent-plugins-${item.role}:20261121-${commit.slice(0,8)}`;
 fs.writeFileSync(dockerfile,`FROM ${item.base}\nLABEL org.opencontainers.image.revision="${commit}"\nCOPY apps/api/src/ /app/apps/api/src/\n${item.role==='api'?'COPY apps/api/migrations/ /app/apps/api/migrations/\n':''}COPY apps/qq-channel/src/ /app/apps/qq-channel/src/\n`);
 run('docker',['build','--pull=false','--network=none','-f',dockerfile,'-t',tag,context]);
 if(run('docker',['image','inspect','--format','{{.Id}}',item.base])!==baseId)throw Error('RELEASE_BASE_IMAGE_CHANGED');
 images[item.role]={tag,id:run('docker',['image','inspect','--format','{{.Id}}',tag]),baseImageId:baseId,dependenciesVerified:true};
}
const manifest={schemaVersion:'agent-plugin-release-v1',sourceCommit:commit,images,files:checksums,protocols:{plugin:1,channel:1,articleImage:1},migration:'0166_agent_plugin_tasks.sql',qqAdditiveTable:'mooyu_qq.agent_image_pages',gatewayImageChanged:false,configurationIncluded:false,credentialsIncluded:false,loginDataIncluded:false,deployPerformed:false,paperEnabled:false};
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({sourceCommit:commit,images,manifest:path.join(output,'release-manifest.json'),deployPerformed:false}));
