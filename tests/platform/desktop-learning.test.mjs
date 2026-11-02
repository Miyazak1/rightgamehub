import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktopLearning } from '../../scripts/build-desktop-learning.mjs';
import { generatedLearningItems } from '../../packages/platform-client/src/generated-learning-items.mjs';
import policy from '../../apps/desktop/electron/policy.cjs';

test('all built-in lessons package entry, module lock and bootstrap from tracked templates', async t => {
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-lessons-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  assert.equal(await buildDesktopLearning(fileURLToPath(new URL('../../',import.meta.url)),output),6);
  const origin='http://127.0.0.1:39001';
  for(const item of generatedLearningItems){
    for(const route of [item.runtimeUrl,item.runtimeUrl.replace('index.html','_mooyu/bootstrap.mjs'),item.runtimeUrl.replace('index.html','mooyu-modules.lock.json')]){
      const response=await policy.assetResponse({url:origin+route,method:'GET'},output,origin,false,null,null,true);
      assert.equal(response.status,200,route);
      assert.equal(response.headers.get('access-control-allow-origin'),'*');
      assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
    }
    const denied=await policy.assetResponse({url:policy.UI+item.runtimeUrl,method:'GET'},output,policy.UI,true);
    assert.equal(denied.status,403);
  }
  const normal=await policy.assetResponse({url:origin+'/missing.html',method:'GET'},output,origin,false);
  assert.doesNotMatch(normal.headers.get('content-security-policy'),/unsafe-inline/);
  const escape=await policy.assetResponse({url:origin+'/learning/%2e%2e%2fsecret',method:'GET'},output,origin,false,null,null,true);
  assert.equal(escape.status,403);
});
