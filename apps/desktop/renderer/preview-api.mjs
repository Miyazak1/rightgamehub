export const fixtureWork = Object.freeze({ id: 'desktop-fixture-game', title: '桌面兼容测试样本',
  description: '本地自有交互样本，用于核对 iframe 隔离与操作；不是线上目录。', instructions: '点击样本中的按钮，确认计数发生变化。',
  kind: 'game', state: 'published', visibility: 'public', revision: '1', art: 'violet', official: true,
  creatorDisplayName: '本地开发预览', creatorHandle: null, tags: ['本地样本'], estimatedMinutes: 1,
  targets: [{ targetKey: 'web', state: 'published', currentReleaseId: 'desktop-fixture-release' }],
  ingestionMethod: 'platform', attributionKind: 'publisher', openSource: false, remixable: false, claimEligible: false,
});
const unavailable = () => Object.assign(new Error('本地开发预览未连接服务器，此功能尚未接通。'), { code: 'DESKTOP_PREVIEW_OFFLINE', status: 503 });
export function createPreviewApi({ fixtureOrigin }) {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/u.test(fixtureOrigin)) throw Error('DESKTOP_FIXTURE_ORIGIN_INVALID');
  const methods = {
    async listWorks() { return { data: [structuredClone(fixtureWork)] }; },
    async listLibrary() { return { data: [] }; },
    async getWork(id) { if (id !== fixtureWork.id) throw unavailable(); return { data: structuredClone(fixtureWork) }; },
    async getLaunch(id) { if (id !== fixtureWork.id) throw unavailable(); return { data: {
      apiVersion: 1, entryUrl: fixtureOrigin + '/index.html', runtimeOrigin: fixtureOrigin, capabilities: {},
    } }; },
    async recordPlay() { return { data: { recorded: false, previewOnly: true } }; },
    async trackAnalytics() { return { data: { recorded: false, previewOnly: true } }; },
    async listDiscoveryCampaigns() { return { data: [] }; },
  };
  // A local fixture API has no credentials or network transport. Unimplemented business calls fail explicitly.
  return new Proxy(methods, { get(target, key) { return Object.hasOwn(target, key) ? target[key] : async () => { throw unavailable(); }; } });
}
