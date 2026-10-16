import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../',import.meta.url);
const pluginRoot = new URL('plugins/gamehub/',root);
const requireFromHarness = createRequire(new URL('extensions/harness/package.json',root));
const { build } = await import(pathToFileURL(requireFromHarness.resolve('esbuild')).href);
await mkdir(new URL('bin/',pluginRoot),{ recursive:true });
await build({
  entryPoints:[fileURLToPath(new URL('scripts/submit-creator-package.mjs',root))],
  outfile:fileURLToPath(new URL('bin/creator-submit.mjs',pluginRoot)),
  bundle:true,format:'esm',platform:'node',target:['node22'],sourcemap:false,logLevel:'silent',
});
await build({
  entryPoints:[fileURLToPath(new URL('scripts/creator-toolkit-cli.mjs',root))],
  outfile:fileURLToPath(new URL('bin/creator-toolkit.mjs',pluginRoot)),
  bundle:true,format:'esm',platform:'node',target:['node22'],sourcemap:false,logLevel:'silent',
});
const templateRoot = new URL('templates/creator-bingo/',pluginRoot);
await mkdir(new URL('source/',templateRoot),{ recursive:true });
for (const file of ['creator-manifest.json','README.md','.gitignore']) await copyFile(new URL(`templates/creator-bingo/${file}`,root),new URL(file,templateRoot));
await copyFile(new URL('templates/creator-bingo/source/bingo.json',root),new URL('source/bingo.json',templateRoot));
await cp(new URL('templates/courseware/',root),new URL('templates/courseware/',pluginRoot),{ recursive:true,force:true });
await cp(new URL('packages/contracts/courseware/',root),new URL('contracts/courseware/',pluginRoot),{ recursive:true,force:true });
await cp(new URL('curricula/',root),new URL('curricula/',pluginRoot),{ recursive:true,force:true });
console.log('Built the portable MOOYU.FUN creator publisher, local toolkit Doctor, courseware contracts, and curriculum knowledge maps.');
