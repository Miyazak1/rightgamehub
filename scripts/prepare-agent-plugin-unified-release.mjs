// Offline assembly of one reviewed source revision; never reads deployment env files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const output=path.resolve(arg('--out-dir')??''),buildRoot=path.resolve('E:/CodexData/build/Right/agent-plugin-unified-release');
if(!args.includes('--out-dir')||!output.startsWith(buildRoot+path.sep)||fs.existsSync(output))throw Error('NEW_E_BUILD_DIRECTORY_REQUIRED');
const run=(cmd,argv,options={})=>{const r=spawnSync(cmd,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:10000000,...options});if(r.status!==0){if(fs.existsSync(output))fs.writeFileSync(path.join(output,'last-command-error.txt'),String(r.stderr??''));throw Error('UNIFIED_'+cmd.toUpperCase()+'_FAILED');}return Buffer.isBuffer(r.stdout)?r.stdout:r.stdout.trim();};
const commit=run('git',['rev-parse','8e5991ca^{commit}']),baseCommit=run('git',['rev-parse','55b2f7e8^{commit}']);
const revision=args.includes('--revision')?arg('--revision'):'r1';if(!/^[a-z0-9-]{1,20}$/u.test(revision))throw Error('RELEASE_REVISION_INVALID');
const prefixes=['apps/api/','apps/qq-channel/','apps/web/','packages/','question-engine/'];
if(run('git',['diff','--name-only',commit,'--',...prefixes,'package.json','pnpm-lock.yaml','pnpm-workspace.yaml']))throw Error('RELEASE_SOURCE_CHANGED');
fs.mkdirSync(output,{recursive:true});
const context=path.join(output,'context');fs.mkdirSync(context);
const tracked=run('git',['ls-tree','-r','--name-only',commit]).split('\n');
const files=tracked.filter(f=>f.startsWith('apps/api/src/')||f.startsWith('apps/api/migrations/')||f.startsWith('apps/qq-channel/src/')||['apps/api/package.json','apps/qq-channel/package.json'].includes(f));
const checksums=[];
const objects=run('git',['cat-file','--batch'],{encoding:null,input:files.map(f=>commit+':'+f).join('\n')+'\n'});let offset=0;
for(const file of files){const end=objects.indexOf(10,offset),header=objects.subarray(offset,end).toString('utf8').split(' ');if(header[1]!=='blob')throw Error('SOURCE_BLOB_REQUIRED');const size=Number(header[2]),bytes=objects.subarray(end+1,end+1+size);offset=end+size+2;const target=path.join(context,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);checksums.push({path:file,sha256:createHash('sha256').update(bytes).digest('hex')});}
const roles=[{role:'api',base:'mooyu-qq-compatible-api:20261120-55b2f7e8',pkg:'apps/api/package.json'},{role:'worker',base:'mooyu-qq-compatible-worker:20261120-55b2f7e8',pkg:'apps/qq-channel/package.json'},{role:'web',base:'mooyu-qq-compatible-web:20261120-55b2f7e8'}],images={};
for(const item of roles){
 item.baseId=run('docker',['image','inspect','--format','{{.Id}}',item.base]);
 if(item.pkg){const expected=JSON.parse(run('git',['show',commit+':'+item.pkg])),installed=JSON.parse(run('docker',['run','--rm','--network','none','--read-only','--entrypoint','cat',item.base,'/app/'+item.pkg]));if(JSON.stringify(expected.dependencies)!==JSON.stringify(installed.dependencies))throw Error('DEPENDENCIES_CHANGED');}
}
// Resolve workspace imports against this exact worktree, not dependency-junction targets.
const webRequire=createRequire(path.join(root,'apps/web/package.json'));
const {build}=await import(pathToFileURL(webRequire.resolve('vite')).href),react=(await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href)).default;
const aliases=[];
for(const dir of fs.readdirSync(path.join(root,'packages'))){const file=path.join(root,'packages',dir,'package.json');if(!fs.existsSync(file))continue;const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(!pkg.name?.startsWith('@gamehub/'))continue;
 const resolve=value=>typeof value==='string'?value:value&&typeof value==='object'?resolve(value.browser??value.import??value.default):null;
 const exports=typeof pkg.exports==='string'?{'.':pkg.exports}:pkg.exports??{'.':pkg.main??'./src/index.mjs'};
 for(const [key,value]of Object.entries(exports)){if(!key.startsWith('.')||key.includes('*'))continue;const target=resolve(value);if(target)aliases.push({find:new RegExp('^'+(pkg.name+(key==='.'?'':key.slice(1))).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'),replacement:path.resolve(path.dirname(file),target)});}
}
const webInputs=new Set();
const assetDirectory=`assets/agent-unified-${commit.slice(0,8)}-${revision}`;
await build({configFile:false,root:path.join(root,'apps/web'),plugins:[react(),{name:'freeze-workspace-inputs',moduleParsed(info){const file=info.id.split('?')[0];if(!path.isAbsolute(file)||file.includes('node_modules'))return;if(!file.startsWith(root+path.sep)&&!file.replaceAll('\\','/').startsWith(root.replaceAll('\\','/')+'/'))throw Error('WORKSPACE_IMPORT_ESCAPED');webInputs.add(path.relative(root,file).replaceAll('\\','/'));}}],resolve:{alias:aliases},build:{target:'es2022',outDir:path.join(context,'web-dist'),assetsDir:assetDirectory,emptyOutDir:false,copyPublicDir:false,sourcemap:false,chunkSizeWarningLimit:2000},logLevel:'warn'});
for(const file of webInputs){if(!tracked.includes(file))throw Error('UNTRACKED_WEB_INPUT');const actual=fs.readFileSync(path.join(root,file)),frozen=run('git',['show',commit+':'+file],{encoding:null});if(!actual.equals(frozen)&&(actual.includes(0)||frozen.includes(0)||actual.toString('utf8').replaceAll('\r\n','\n')!==frozen.toString('utf8').replaceAll('\r\n','\n')))throw Error('WEB_INPUT_CHANGED_'+file);checksums.push({path:file,sha256:createHash('sha256').update(actual).digest('hex'),gitSourceSha256:createHash('sha256').update(frozen).digest('hex')});}
for(const item of roles){const tag=`mooyu-agent-unified-${item.role}:20261121-${commit.slice(0,8)}-${revision}`,dockerfile=path.join(context,'Dockerfile.'+item.role);
 const copy=item.role==='web'?'COPY web-dist/ /srv/gamehub/\n':`COPY apps/api/src/ /app/apps/api/src/\nCOPY apps/qq-channel/src/ /app/apps/qq-channel/src/\n${item.role==='api'?'COPY apps/api/migrations/ /app/apps/api/migrations/\n':''}`;
 fs.writeFileSync(dockerfile,`FROM ${item.base}\nLABEL org.opencontainers.image.revision="${commit}" org.mooyu.release="agent-unified-v1"\n${copy}`);
 run('docker',['build','--pull=false','--network=none','-f',dockerfile,'-t',tag,context]);
 if(run('docker',['image','inspect','--format','{{.Id}}',item.base])!==item.baseId)throw Error('BASE_IMAGE_CHANGED');
 images[item.role]={tag,id:run('docker',['image','inspect','--format','{{.Id}}',tag]),baseTag:item.base,baseImageId:item.baseId,dependenciesReused:true};
}
// Keep historical source history outside the artifact; this patch is for review,
// not a command to rewrite the server checkout.
fs.writeFileSync(path.join(output,'source.patch'),run('git',['diff','--binary',baseCommit,commit],{encoding:null}));
const manifest={schemaVersion:'agent-unified-release-v1',sourceCommit:commit,releaseRevision:revision,assetDirectory,reviewBaseCommit:baseCommit,images,files:checksums,webWorkspaceInputsVerified:true,webStaticResourcesPreservedFromBase:true,protocols:{plugin:1,channel:1,articleImage:1,pluginAdmin:1},requiredMigration:'0166_agent_plugin_tasks.sql',gatewayChanged:false,credentialsIncluded:false,configurationIncluded:false,loginDataIncluded:false,productionChanged:false,paperEnabled:false};
fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));
run('docker',['image','save','--output',path.join(output,'images.tar'),...Object.values(images).map(i=>i.tag)]);
const hashFile=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const sums=[];for(const name of ['images.tar','release-manifest.json','source.patch'])sums.push(`${await hashFile(path.join(output,name))}  ${name}`);
fs.writeFileSync(path.join(output,'SHA256SUMS'),sums.join('\n')+'\n');
console.log(JSON.stringify({sourceCommit:commit,images,artifact:output,productionChanged:false,paperEnabled:false}));
