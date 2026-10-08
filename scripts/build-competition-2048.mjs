import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {createZipBuffer} from '../apps/api/src/zip-buffer-writer.mjs';
import {validateWebZip} from '../apps/api/src/web-zip-validator.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),{build}=require('../extensions/harness/node_modules/esbuild');
const source=path.resolve(process.argv[2]??path.join(root,'.runtime/competition-2048-upstream')),output=path.join(root,'.runtime/competition-2048-package');
const commit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
if(commit!=='478b6ec346e3787f589e4af751378d06ded4cbbc')throw new Error('Use the pinned, reviewed upstream commit 478b6ec346e3787f589e4af751378d06ded4cbbc.');
await fs.mkdir(output,{recursive:true});
const files=[];
for(const directory of ['js','style','meta']){
  async function collect(folder){for(const item of await fs.readdir(path.join(source,folder),{withFileTypes:true})){const name=folder+'/'+item.name;if(item.isDirectory())await collect(name);else if(!/\.(scss|map)$/.test(name))files.push({name,data:await fs.readFile(path.join(source,name))});}}
  await collect(directory);
}
const bundle=await build({entryPoints:[path.join(root,'samples/competition-2048/adapter.mjs')],bundle:true,write:false,format:'iife',platform:'browser',minify:true});
const application=files.find(file=>file.name==='js/application.js');application.data=bundle.outputFiles[0].contents;
files.push({name:'favicon.ico',data:await fs.readFile(path.join(source,'favicon.ico'))});
let html=await fs.readFile(path.join(source,'index.html'),'utf8');
html=html.replace('</head>','<link rel="stylesheet" href="style/gamehub-competition.css"></head>');
// Keep creator attribution, while removing the upstream claim that this derivative is the official site.
html=html.replace(/<p>\s*<strong class="important">Note:<\/strong>[\s\S]*?<\/p>/,'<p>GameHub 2048：自由模式与规则回放验证的排行挑战。</p>');
files.push({name:'index.html',data:Buffer.from(html)},{name:'style/gamehub-competition.css',data:await fs.readFile(path.join(root,'samples/competition-2048/adapter.css'))},{name:'platform.json',data:await fs.readFile(path.join(root,'samples/competition-2048/platform.json'))},{name:'LICENSE.txt',data:await fs.readFile(path.join(source,'LICENSE.txt'))});
const artifact=path.join(root,'artifacts/gamehub-2048-competition-v1.zip');await fs.mkdir(path.dirname(artifact),{recursive:true});await fs.writeFile(artifact,createZipBuffer(files));
const checked=await fs.mkdtemp(path.join(output,'validation-'));const report=await validateWebZip(artifact,path.join(checked,'expanded'));
await fs.writeFile(path.join(output,'provenance.json'),JSON.stringify({repository:'https://github.com/Miyazak1/2048',commit,artifact,license:'MIT',boards:report.competition.boards.map(board=>board.key)},null,2));
const bundledDirectory=path.join(root,'apps/api/bundled');await fs.mkdir(bundledDirectory,{recursive:true});
await fs.copyFile(artifact,path.join(bundledDirectory,'2048-competition-v1.zip'));
await fs.writeFile(path.join(bundledDirectory,'2048-competition-v1.json'),JSON.stringify({repository:'https://github.com/Miyazak1/2048',commit,license:'MIT',sha256:crypto.createHash('sha256').update(await fs.readFile(artifact)).digest('hex')},null,2)+'\n');
console.log(JSON.stringify({artifact,commit,files:report.fileCount,boards:report.competition.boards.length}));
