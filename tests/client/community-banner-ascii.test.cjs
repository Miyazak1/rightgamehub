const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'../..');
const shell=fs.readFileSync(path.join(root,'packages/platform-client/src/CommunityShell.jsx'),'utf8');
const styles=fs.readFileSync(path.join(root,'packages/platform-client/src/styles.css'),'utf8');

test('community banner bundles earthrise as a restrained decorative layer',()=>{
  assert.match(shell,/from 'ascii\.rest\/pieces\/earthrise'/);
  assert.match(shell,/mount\(visual\.current,earthrise,\{fps:8\}\)/);
  assert.match(shell,/return <canvas ref=\{visual\}\/>/);
  assert.match(shell,/<div className="community-hub-hero__ascii" aria-hidden="true">/);
  assert.doesNotMatch(shell,/https?:\/\/ascii\.rest/);
  assert.match(styles,/\.community-hub-hero__ascii\s*\{[\s\S]*?opacity:\s*\.36/);
  assert.match(styles,/mask-image:\s*linear-gradient\(90deg,transparent 0,#000 30%,#000 100%\)/);
  assert.match(styles,/@container\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.community-hub-hero__ascii\s*\{[\s\S]*?display:\s*none/);
});
