import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {makeZip} from './zip-fixture.cjs';
const root = fileURLToPath(new URL('../',import.meta.url));
const source = path.join(root,'samples/adarkroom');
const lock = JSON.parse(await fs.readFile(path.join(source,'upstream.lock.json'),'utf8'));
const files = new Map();
for(const file of lock.files) {
  const bytes = await fs.readFile(path.join(source,'upstream',file.path));
  if(crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Upstream integrity mismatch: '+file.path);
  if(/^(script|css|lib|audio)\//.test(file.path) && file.path!=='script/dropbox.js' ||
     /^(favicon.ico|img\/adr.png|lang\/zh_cn\/(?:strings.js|main.css))$/.test(file.path)) files.set(file.path,bytes);
}
function replaceOnce(text, from, to) {
  if(!text.includes(from)) throw new Error('Pinned upstream patch did not match: '+from.slice(0,100));
  return text.replace(from,()=>to);
}
function method(text, name, body, indent) {
  const start = text.indexOf(indent+name+': function(');
  const open = text.indexOf('{',start), end = text.indexOf('\n'+indent+'},',open);
  if(start<0 || open<0 || end<0) throw new Error('Pinned method not found: '+name);
  return text.slice(0,open+1)+'\n'+body+'\n'+text.slice(end);
}
let engine = files.get('script/engine.js').toString().replaceAll('\r\n','\n');
engine = replaceOnce(engine,"$(function() {\n  Engine.init();\n});",'// GameHub bootstrap loads the approved cloud state before Engine.init().');
engine = method(engine,'saveGame','      window.GameHubADR.save();','    ');
engine = method(engine,'loadGame','      window.State = window.GameHubADR.loadedState;\n      $SM.updateOldState();','    ');
engine = method(engine,'generateExport64','      return Base64.encode(JSON.stringify(State));','    ');
engine = method(engine,'import64','      return window.GameHubADR.importCode(string64);','    ');
engine = method(engine,'deleteSave','      return window.GameHubADR.restart(noReload);','    ');
engine = method(engine,'saveLanguage','      // Language stays in the allowlisted URL, never opaque-origin storage.','    ');
engine = method(engine,'browserValid','      return true;','    ');
engine = method(engine,'isMobile','      return false;','    ');
if(engine.includes('localStorage')) throw new Error('Unpatched localStorage use');
engine = replaceOnce(engine,"_('if the code is invalid, all data will be lost.')", "'导入前会校验格式；当前进度需先得到保存确认。'");
engine = replaceOnce(engine,"_('this is irreversible.')", "'建议先复制当前进度的导出码。'");
files.set('script/engine.js',engine);
let manager = files.get('script/state_manager.js').toString().replaceAll('\r\n','\n');
manager = method(manager,'createState',"\t\treturn window.GameHubADR.set(State, stateName, value);",'\t');
manager = method(manager,'set',"\t\tif (typeof value === 'number' && value > $SM.MAX_STORE) value = $SM.MAX_STORE;\n\t\tif (stateName.indexOf('stores') === 0 && value < 0) value = 0;\n\t\twindow.GameHubADR.set(State, stateName, value);\n\t\tif (!noEvent) { Engine.saveGame(); $SM.fireUpdate(stateName); }",'\t');
manager = method(manager,'get',"\t\tvar value = window.GameHubADR.get(State, stateName);\n\t\treturn !value && requestZero ? 0 : value;",'\t');
manager = method(manager,'setget',"\t\t$SM.set(stateName,value,noEvent);\n\t\treturn $SM.get(stateName);",'\t');
manager = method(manager,'remove',"\t\twindow.GameHubADR.remove(State,stateName);\n\t\tif (!noEvent) { Engine.saveGame(); $SM.fireUpdate(stateName); }",'\t');
if(/\beval\s*\(/.test(manager)) throw new Error('Unpatched eval use');
files.set('script/state_manager.js',manager);
const requireFromHarness = createRequire(path.join(root,'extensions/harness/package.json'));
const {build} = await import(pathToFileURL(requireFromHarness.resolve('esbuild')).href);
const result = await build({entryPoints:[path.join(source,'bootstrap.mjs')],bundle:true,format:'iife',platform:'browser',target:['chrome110'],write:false,logLevel:'silent'});
files.set('gamehub/boot.js',result.outputFiles[0].text);
files.set('gamehub/platform.css',await fs.readFile(path.join(source,'platform.css')));
const original = await fs.readFile(path.join(source,'upstream/index.html'),'utf8');
const scripts = [...original.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m=>m[1]).filter(p=>files.has(p));
const css = [...original.matchAll(/<link rel="stylesheet" type="text\/css" href="([^"]+)" \/>/g)].map(m=>m[1]);
const header = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A Dark Room · GameHub</title><link rel="icon" href="favicon.ico">'
 + '<script src="lib/jquery.min.js"></script>'
 + '<script>var oldIE=false;var lang=new URLSearchParams(location.search).get("lang")==="en"?"en":"zh_cn";var langs={en:"English",zh_cn:"简体中文"};</script>';
const ordered = scripts.filter(p=>p!=='lib/jquery.min.js').map(p=>'<script src="'+p+'"></script>'+(p==='lib/translate.js'?'<script>if(lang==="zh_cn")document.write(\'<script src="lang/zh_cn/strings.js"><\\/script>\');</script>':'')).join('\n');
const localeCss = '<script>if(lang==="zh_cn")document.write(\'<link rel="stylesheet" href="lang/zh_cn/main.css">\');</script>';
const controls = '<section id="adr-save-bar" aria-label="云存档"><span id="adr-save-status" role="status">正在连接存档</span><button id="adr-save" disabled>立即保存</button><button id="adr-export" disabled>导出当前进度</button><button id="adr-retry" hidden>重试原保存</button><button id="adr-compare" hidden>比较冲突进度</button><button id="adr-reload" hidden>重新读取</button><span id="adr-save-message"></span></section>'
 + '<dialog id="adr-save-dialog"><h2>保留与恢复进度</h2><p>复制导出码可保留这份进度。关闭页面前，未确认的修改只存在于本页。</p><label for="adr-local-code">本页进度</label><p id="adr-local-summary"></p><textarea id="adr-local-code" readonly></textarea><section id="adr-cloud-section" hidden><p id="adr-conflict-revision"></p><label for="adr-cloud-code">云端进度</label><p id="adr-cloud-summary"></p><textarea id="adr-cloud-code" readonly></textarea></section><footer id="adr-choices" hidden><button id="adr-keep-local">确认保留本页并更新云端</button><button id="adr-use-cloud">确认放弃本页，使用云端</button></footer><footer><button id="adr-close-dialog">返回游戏</button></footer></dialog>';
const body = '<div id="wrapper"><div id="saveNotify"></div><div id="content"><div id="outerSlider"><div id="main"><div id="header"></div></div></div></div></div>';
files.set('index.html',header+ordered+css.map(p=>'<link rel="stylesheet" href="'+p+'">').join('')+localeCss+'<link rel="stylesheet" href="gamehub/platform.css"></head><body>'+controls+body
 + '<footer class="adr-credit"><a href="https://github.com/doublespeakgames/adarkroom">A Dark Room — doublespeak games</a> · <a href="LICENSE.txt">MPL-2.0</a></footer><script src="gamehub/boot.js"></script></body></html>');
files.set('LICENSE.txt',await fs.readFile(path.join(source,'upstream/LICENSE.md')));
files.set('NOTICE.txt','A Dark Room by doublespeak games and contributors. MPL-2.0.\nUpstream: '+lock.repository+'\nPinned commit: '+lock.commit+'\nGameHub adaptation: state access without eval; scoped online cloud saves; startup waits for cloud read; analytics removed; bundled local dependencies.\nModified engine/state-manager sources are included in script/. Adapter source is included in source/.\nInternal S1 reference package; production capability is not enabled by this manifest.\n');
for(const name of ['state.mjs','save-adapter.mjs','bootstrap.mjs']) files.set('source/'+name,await fs.readFile(path.join(source,name)));
files.set('platform.json',JSON.stringify({version:1,entry:'index.html',capabilities:['cloudSave']}));
const output = path.join(root,'.runtime/adarkroom-web');
await fs.mkdir(output,{recursive:true});
for(const [name,data] of files) { await fs.mkdir(path.dirname(path.join(output,name)),{recursive:true}); await fs.writeFile(path.join(output,name),data); }
await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
await fs.writeFile(path.join(root,'artifacts/adarkroom-cloud-save-internal.zip'),makeZip([...files].map(([name,data])=>({name,data}))));
console.log('Built A Dark Room '+lock.commit.slice(0,12)+': '+files.size+' files. Internal cloudSave approval required.');
