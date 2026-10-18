const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('retired lounge has no active page route or leaderboard entry',()=>{
  const app=fs.readFileSync('packages/platform-client/src/App.jsx','utf8');
  const leaderboard=fs.readFileSync('packages/platform-client/src/WorkLeaderboard.jsx','utf8');
  const competition=fs.readFileSync('apps/api/src/competition-service.mjs','utf8');
  assert.doesNotMatch(app,/route === '\/games\/guess-baike\/players'/);
  assert.doesNotMatch(app,/parts\[0\] === 'challenge'/);
  assert.match(leaderboard,/definition\.playerCenter==='\/games\/guess-baike\/players'\?null/);
  assert.doesNotMatch(competition,/playerCenter:'\/games\/guess-baike\/players'/);
});
