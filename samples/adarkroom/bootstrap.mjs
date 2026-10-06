import {createGameHubClient} from '../../packages/web-game-sdk/src/index.mjs';
import {createAdrSaveAdapter} from './save-adapter.mjs';
import {getStatePath,setStatePath,removeStatePath,stateSnapshot,describeState} from './state.mjs';

const bar = document.getElementById('adr-save-bar'), status = document.getElementById('adr-save-status');
const message = document.getElementById('adr-save-message'), dialog = document.getElementById('adr-save-dialog');
new ResizeObserver(() => document.documentElement.style.setProperty("--adr-save-offset",(bar.offsetHeight + 20) + "px")).observe(bar);
const client = createGameHubClient();
let ready = false, adapter;
const text = {
  loading:'正在读取云存档', ready:'云存档已读取', pending:'有进度等待保存', syncing:'正在保存',
  cloud:'云端保存已确认', conflict:'云端进度已变化', unconfirmed:'保存尚未确认', blocked:'云存档暂不可用',
};
function showStatus(value) {
  status.textContent = text[value.state] ?? value.state;
  bar.dataset.state = value.state;
  document.getElementById('adr-retry').hidden = !['unconfirmed','blocked'].includes(value.state) || value.code === 'BRIDGE_CLOSED';
  document.getElementById('adr-compare').hidden = value.state !== 'conflict';
  message.textContent = value.message ?? (value.state === 'pending' ? '每分钟自动保存；离开前请点“立即保存”。' :
    value.state === 'cloud' ? '修订 ' + value.revision + (value.historyDegraded ? ' · 历史备份受限' : '') :
    value.state === 'conflict' ? '请比较双方进度后选择，当前进度仍保留在本页。' :
    value.state === 'unconfirmed' ? '请保持页面打开，重试会继续确认原保存。' : '当前为在线存档内部验证版。');
}
function showError(error) { message.textContent = error.code === 'SAVE_CONFLICT' ? '云端已有新进度，请先比较双方进度再选择。' : error.message || '操作失败，请保留本页进度。'; }
const action = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(showError);
const exportCode = state => window.Base64.encode(stateSnapshot(state));
function showCodes(local, cloud) {
  document.getElementById('adr-local-summary').textContent = describeState(local);
  document.getElementById('adr-cloud-summary').textContent = cloud ? describeState(cloud) : '';
  document.getElementById('adr-local-code').value = exportCode(local);
  document.getElementById('adr-cloud-code').value = cloud ? exportCode(cloud) : '';
  document.getElementById('adr-cloud-section').hidden = !cloud;
  document.getElementById('adr-choices').hidden = !cloud;
  dialog.showModal();
}
adapter = createAdrSaveAdapter({cloudSave:client.cloudSave, onStatus:showStatus, onReplace:(state,reload) => {
  window.State = state;
  if (reload) { ready = false; adapter.close(); client.close(); location.reload(); }
}});
window.GameHubADR = {
  get:getStatePath, set:setStatePath, remove:removeStatePath, loadedState:null,
  save() { if (ready) { try { adapter.queue(window.State); } catch(error) { showError(error); } } },
  restart:action(async (noReload) => {
    await adapter.saveNow();
    const previous = JSON.parse(JSON.stringify(window.Prestige.get()));
    return adapter.replace({version:1.3, previous}, {reload:!noReload});
  }),
};
window.GameHubADR.importCode = string64 => action(async () => {
  const cleaned = string64.replace(/[\s.]/g,'');
  if (cleaned.length > 350000) throw new Error('导入码太长。');
  const state = JSON.parse(window.Base64.decode(cleaned));
  stateSnapshot(state); // Validate before any current-state write or replacement.
  await adapter.saveNow();
  await adapter.replace(state);
})();
document.getElementById('adr-save').onclick = action(async () => { adapter.queue(window.State); await adapter.saveNow(); });
document.getElementById('adr-retry').onclick = action(() => adapter.retry());
document.getElementById('adr-export').onclick = action(() => showCodes(window.State || adapter.exportState()));
document.getElementById('adr-compare').onclick = action(async () => {
  adapter.queue(window.State);
  const pair = await adapter.compare();
  document.getElementById('adr-conflict-revision').textContent = '云端修订：' + (pair.revision ?? '空存档');
  showCodes(pair.local, pair.cloud);
});
document.getElementById('adr-keep-local').onclick = action(async () => { adapter.queue(window.State); await adapter.keepLocal(); dialog.close(); });
document.getElementById('adr-use-cloud').onclick = action(() => adapter.useCloud());
document.getElementById('adr-close-dialog').onclick = () => dialog.close();
client.on('bridge.closed', () => { ready = false; adapter.close(); document.getElementById('wrapper').inert = true; });
window.addEventListener('pagehide', () => { ready = false; adapter.close(); client.close(); }, {once:true});
window.addEventListener('beforeunload', event => {
  if (adapter.getStatus().pending || adapter.getStatus().inFlight) { event.preventDefault(); event.returnValue = ''; }
});
async function start() {
  const capabilities = await client.connect();
  if (!capabilities.includes('cloudSave')) throw new Error('当前宿主尚未批准本游戏的云存档能力。');
  window.GameHubADR.loadedState = await adapter.load();
  window.Engine.init();
  ready = true;
  adapter.queue(window.State);
  window.Engine.switchLanguage = dom => action(async () => {
    const next = window.$(dom).data('language');
    if (!['en','zh_cn'].includes(next)) return;
    await adapter.saveNow();
    const url = new URL(location.href); url.searchParams.set('lang',next); location.href = url.href;
  })();
  document.getElementById('adr-save').disabled = false;
  document.getElementById('adr-export').disabled = false;
}
start().catch(error => {
  ready = false; document.getElementById('wrapper').inert = true;
  showStatus({state:'blocked', code:error.code, message:error.message + ' 原云端进度未被覆盖。'});
  document.getElementById('adr-retry').hidden = true;
  document.getElementById('adr-reload').hidden = false;
});
document.getElementById('adr-reload').onclick = () => location.reload();
