import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const protocol=(await fs.readFile(path.join(root,'packages/web-game-sdk/src/protocol.mjs'),'utf8')).replaceAll('export ','');
const sdkSource=await fs.readFile(path.join(root,'packages/web-game-sdk/src/index.mjs'),'utf8');
const protocolSource=await fs.readFile(path.join(root,'packages/web-game-sdk/src/protocol.mjs'));
const sdkPackage=JSON.parse(await fs.readFile(path.join(root,'packages/web-game-sdk/package.json'),'utf8'));
const sdk=sdkSource.replace(/^import .*?;\r?\n/u,'').replaceAll('export function ','function ').replace(/\r?\nexport \* from .*?;\r?\n?/u,'\n');
const gameSource=(await read('game.js')).toString('utf8');
const game=gameSource.replace(/^import .*?;\r?\n/u,'');
const webEntries=[
  {name:'index.html',data:await read('index.html')},{name:'style.css',data:await read('style.css')},
  {name:'game.js',data:`${protocol}\n${sdk}\n${game}`},{name:'platform.json',data:await read('platform.json')},
];
const sourceEntries=(await walk(templateRoot)).map(entry=>entry.name==='game.js' ? { ...entry,data:gameSource.replace("from '@gamehub/web-game-sdk'","from './vendor/gamehub-sdk.mjs'") } : entry);
sourceEntries.push({name:'vendor/gamehub-sdk.mjs',data:`// Generated from ${sdkPackage.name} ${sdkPackage.version}; do not edit this vendored artifact.\n${sdkSource}`},{name:'vendor/protocol.mjs',data:protocolSource});
sourceEntries.sort((left,right)=>left.name.localeCompare(right.name,'en'));
for (const outputRoot of outputRoots) {
  await fs.mkdir(outputRoot,{recursive:true});
  await fs.writeFile(path.join(outputRoot,'gamehub-multiplayer-starter-web.zip'),makeZip(webEntries));
  await fs.writeFile(path.join(outputRoot,'gamehub-multiplayer-starter-source.zip'),makeZip(sourceEntries));
}
console.log(`Built deterministic multiplayer starter: ${webEntries.length} web files, ${sourceEntries.length} source files.`);
