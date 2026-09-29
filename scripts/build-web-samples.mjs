import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { makeZip } from './zip-fixture.cjs';

const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
for (const [kind, title] of [['canvas', '星星收集'], ['webgl', '旋转立方体']]) {
  const original = await readFile(new URL(`poc/m0/${kind}.html`, root), 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(original)[1];
  const game = /<script>([\s\S]*?)<\/script>/.exec(original)[1];
  const html = original.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
    .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="assets/style.css">')
    .replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="assets/game.js"></script>')
    .replace('</body>', '<p id="resource-check" role="status">正在加载 ZIP 内的模块、数据、图片与 WASM…</p><img alt="包内星星图片" src="assets/star.svg" width="32" height="32"><p id="isolation-check" role="status"></p></body>');
  const bootstrap = `import { label } from './module.js';
const data = await (await fetch('./assets/data.json')).json();
const binary = await (await fetch('./assets/empty.wasm')).arrayBuffer();
await WebAssembly.compile(binary);
document.getElementById('resource-check').textContent = label + ' · ' + data.message + ' · WASM 已编译';
let blocked = 0;
try { void parent.document.body; } catch { blocked++; }
try { void localStorage.length; } catch { blocked++; }
document.getElementById('isolation-check').textContent = blocked === 2 ? '隔离检查通过：无法读取宿主页和本地存储' : '隔离检查未通过';
`;
  const entries = [
    { name: 'index.html', data: html }, { name: 'assets/style.css', data: style },
    { name: 'assets/game.js', data: bootstrap + '\n' + game }, { name: 'assets/module.js', data: 'export const label = "独立模块已加载";' },
    { name: 'assets/data.json', data: JSON.stringify({ message: 'JSON 资源已加载' }) },
    { name: 'assets/empty.wasm', data: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) },
    { name: 'assets/star.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path fill="#ffd66b" d="m20 2 5 12 13 1-10 9 3 14-11-7-11 7 3-14-10-9 13-1z"/></svg>' },
  ];
  await writeFile(new URL(`artifacts/${title}-web.zip`, root), makeZip(entries));
  console.log(`Built artifacts/${title}-web.zip: ${entries.length} independent resources.`);
}
