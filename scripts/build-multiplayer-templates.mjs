import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makeZip } from './zip-fixture.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const templateRoot = path.join(root,'templates/multiplayer-turn-based');
const outputRoots = [path.join(root,'artifacts'),path.join(root,'apps/web/public/downloads')];
const read = relative => fs.readFile(path.join(templateRoot,relative));
async function walk(directory,prefix='') {
  const output=[];
  for (const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    const name=prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await walk(path.join(directory,entry.name),name)); else output.push({name,data:await fs.readFile(path.join(directory,entry.name))});
  }
  return output;
}
const sdkRoot=path.join(root,'packages/web-game-sdk/src');
const gameSource=(await read('game.js')).toString('utf8');
const requireFromHarness=createRequire(path.join(root,'extensions/harness/package.json'));
const {build}=await import(pathToFileURL(requireFromHarness.resolve('esbuild')).href);
// Bundle the real module graph; regex concatenation loses transitive imports.
const bundled=await build({
  absWorkingDir:root,stdin:{contents:gameSource,sourcefile:'game.js',resolveDir:templateRoot},
  alias:{'@gamehub/web-game-sdk':path.join(sdkRoot,'index.mjs')},
  bundle:true,format:'esm',platform:'browser',target:['chrome110'],write:false,logLevel:'silent',
});
const game=bundled.outputFiles[0].text;
const webEntries=[
  {name:'index.html',data:await read('index.html')},{name:'style.css',data:await read('style.css')},
  {name:'game.js',data:game},{name:'platform.json',data:await read('platform.json')},
];
const sourceEntries=(await walk(templateRoot)).map(entry=>entry.name==='game.js' ? { ...entry,data:gameSource.replace("from '@gamehub/web-game-sdk'","from './vendor/gamehub-sdk.mjs'") } : entry);
for(const name of (await fs.readdir(sdkRoot)).filter(name=>name.endsWith('.mjs')).sort()) {
  const source=await fs.readFile(path.join(sdkRoot,name));
  sourceEntries.push({name:'vendor/'+(name==='index.mjs'?'gamehub-sdk.mjs':name),data:source});
}

sourceEntries.sort((left,right)=>left.name.localeCompare(right.name,'en'));
for (const outputRoot of outputRoots) {
  await fs.mkdir(outputRoot,{recursive:true});
  await fs.writeFile(path.join(outputRoot,'gamehub-multiplayer-starter-web.zip'),makeZip(webEntries));
  await fs.writeFile(path.join(outputRoot,'gamehub-multiplayer-starter-source.zip'),makeZip(sourceEntries));
}
console.log(`Built deterministic multiplayer starter: ${webEntries.length} web files, ${sourceEntries.length} source files.`);
