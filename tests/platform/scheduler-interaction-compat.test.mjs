import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {MODULE_HASHES,patchSchedulerModules,verifyCompatGraph} from '../../scripts/scheduler-interaction-compat.mjs';
test('unknown base modules and invented protocol proof fail closed',()=>{
 assert.throws(()=>patchSchedulerModules({}),/EXACT_ORIGINAL_MODULE_SET_REQUIRED/);
 assert.throws(()=>patchSchedulerModules(Object.fromEntries(Object.keys(MODULE_HASHES).map(f=>[f,'unreviewed source']))),/PINNED_ORIGINAL_MODULE_REQUIRED/);
 assert.throws(()=>verifyCompatGraph({modules:70,hash:'claimed',rows:[]},{}),/ORIGINAL_GRAPH_REQUIRED/);
});
test('actual pinned original modules receive only the isolation filter and heartbeat advertisement',{skip:!process.env.MOOYU_TEST_ORIGINAL_SCHEDULER_SOURCE},()=>{
 const original=Object.fromEntries(Object.keys(MODULE_HASHES).map(f=>[f,fs.readFileSync(path.join(process.env.MOOYU_TEST_ORIGINAL_SCHEDULER_SOURCE,path.basename(f)),'utf8')])),patched=patchSchedulerModules(original);
 const schedule='apps/api/src/agent-blog-public-schedule.mjs',requests='apps/api/src/agent-blog-public-request-repository.mjs';
 assert.equal(patched[schedule].replace(",'interactionProtocolVersion',1",''),original[schedule]);
 assert.equal(patched[requests].replace("      AND coalesce(snapshot_json->>'executionSource','public-runtime')<>'agent-interaction-v1'\n",''),original[requests]);
 for(const f of Object.keys(original))assert.throws(()=>patchSchedulerModules({...original,[f]:original[f]+'\n'}),/PINNED_ORIGINAL_MODULE_REQUIRED/);
 assert.throws(()=>patchSchedulerModules(patched),/PINNED_ORIGINAL_MODULE_REQUIRED/);
});
