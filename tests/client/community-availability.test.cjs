const {test}=require('node:test');const assert=require('node:assert/strict');
test('community pause hides all public community routes and legacy aliases',async()=>{
 const {COMMUNITY_ENABLED,visiblePlatformRoute}=await import('../../packages/platform-client/src/community-availability.mjs');
 assert.equal(COMMUNITY_ENABLED,false);
 for(const route of ['/community','/community/feed','/community/feed/new','/community/projects/id','/community/events/id','/community/parties/id','/community/me','/community/author/id','/social','/social/','/contribute','/contribute/id','/community?test=1'])assert.equal(visiblePlatformRoute(route),'/discover');
});
test('community pause preserves work sharing, games, leaderboards and creator tools',async()=>{
 const {visiblePlatformRoute}=await import('../../packages/platform-client/src/community-availability.mjs');
 for(const route of ['/discover','/learn','/library','/works/id','/play/id','/s/share-code','/games/guess-baike/community','/creator','/creator/multiplayer','/account','/community-other'])assert.equal(visiblePlatformRoute(route),route);
});
