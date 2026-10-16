import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInLearningItems } from '../packages/platform-client/src/learning-catalog.mjs';
import { loadCoursewareInventory } from '../packages/creator-tools/src/courseware-toolkit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetRoot = path.join(root, 'apps', 'web', 'public', 'learning', 'courseware');
const templates = [...new Set(builtInLearningItems.map(item => item.template).filter(Boolean))];

for (const name of templates) {
  const target = path.join(targetRoot, name);
  const inventory=await loadCoursewareInventory(path.join(root,'templates','courseware',name));
  for(const file of inventory.files){
    const destination=path.join(target,...file.relative.split('/'));
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,file.bytes);
  }
  await writeFile(path.join(target,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./dist/index.html"><title>Opening courseware…</title><p><a href="./dist/index.html">Open courseware</a></p>\n`);
}

console.log(`Prepared ${templates.length} locked learning courseware releases.`);
