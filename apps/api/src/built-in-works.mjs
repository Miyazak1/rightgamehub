export const GUESS_BAIKE_WORK_ID = 'gamehub-guess-baike';

export const guessBaikeWork = Object.freeze({
  id: GUESS_BAIKE_WORK_ID,
  ownerUserId: '00000000-0000-4000-8000-000000000000',
  title: '猜百科',
  description: '从完整的中文维基百科导言中逐字揭开线索，猜出隐藏的词条标题。',
  instructions: '输入中文、英文字母或数字来揭开正文，英文不区分大小写；也可以直接猜词条标题。每天一题，支持两次提示。',
  kind: 'game', state: 'published', visibility: 'public', revision: '1',
  firstPublishedAt: '2026-09-28T00:00:00.000Z',
  coverUrl: null,
  estimatedMinutes: 5, tags: ['推理', '每日一题'], agentLabel: null,
  repositoryUrl: null, licenseSpdx: null, creatorDisplayName: 'GameHub', creatorHandle: null, playCount: 0, saveCount: 0,
  ingestionMethod: 'platform', attributionKind: 'publisher', sourceCommitSha: null, openSource: false, remixable: false, claimStatus: 'publisher', claimEligible: false,
  targets: [{ targetKey: 'web', state: 'published', currentReleaseId: null, revision: '1' }],
});
