const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('production storage maintenance is bounded and never prunes volumes',()=>{
  const script=fs.readFileSync('deploy/storage-maintenance.sh','utf8');
  const compose=fs.readFileSync('deploy/compose.prod.yml','utf8');
  const deploy=fs.readFileSync('deploy/deploy.sh','utf8');
  const communityUpdate=fs.readFileSync('deploy/update-community-sharing.sh','utf8');
  assert.match(script,/docker container prune -f --filter/);
  assert.match(script,/docker image prune -f --filter/);
  assert.match(script,/docker builder prune -f --filter/);
  assert.doesNotMatch(script,/docker (?:system prune|volume prune)/);
  assert.match(compose,/max-size: "10m"/);
  assert.match(compose,/max-file: "3"/);
  assert.match(deploy,/--wait --wait-timeout/);
  assert.match(deploy,/storage-maintenance\.sh --apply/);
  assert.match(communityUpdate,/PUBLIC_COMMUNITY_RELEASE:-false/);
  assert.match(communityUpdate,/\. deploy\/\.env\.prod/);
});
