import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {renderReleasePlan,checkWindow} from '../../scripts/agent-plugin-release-plan.mjs';
const digest='sha256:'+'a'.repeat(64),target='sha256:'+'b'.repeat(64);
const rescue='sha256:'+'c'.repeat(64),manifest={schemaVersion:'agent-unified-release-v1',paperEnabled:false,images:{api:{id:target,baseImageId:digest},web:{id:target},worker:{id:target}},rollbackImages:{api:{id:rescue}}};
const inventory=()=>({schemaVersion:'agent-unified-inventory-v1',configurationFiles:[{path:'/example/config',sha256:'a'.repeat(64)}],backups:[{path:'/example/backup',sha256:'a'.repeat(64)}],gateway:{},databases:{api:{},qq:{}},evidence:{backupsVerified:true,configurationAligned:true,secretMountsAligned:true,loginMountsVerified:true,allExecutionServicesInventoried:true},roles:['api','web','worker','executor','scheduler'].map(role=>({role,container:'test-'+role,project:'original-project',service:role,imageId:digest,mountsSha256:'a'.repeat(64),environmentSha256:'b'.repeat(64),running:role!=='scheduler',directory:'/www/original app',files:['/www/base.yml','/www/first.json','/www/second.json'],envFiles:['/www/original.env']}))});
test('release plan preserves Compose ordering, old images and originally stopped schedules',()=>{
 const p=renderReleasePlan(inventory(),manifest);assert(p.ready);assert.deepEqual(p.originallyStopped,['test-scheduler']);
 for(const script of Object.values(p.scripts)){assert(script.indexOf('/www/first.json')<script.indexOf('/www/second.json'));assert(!script.includes('down'));assert(!script.includes('restore'));assert(!script.includes("'scheduler' up"));assert(!script.includes("never 'scheduler'"));assert(script.includes('flock -n'));assert.equal(script.split('--check-window').length-1,2);assert(script.includes('--pull never'));}
 assert(p.scripts['upgrade.sh'].includes('bootstrap-cli.mjs'));assert(!p.scripts['rollback.sh'].includes('migrate-cli.mjs'));assert.equal(p.overlays['original-0.json'].services.api.image,rescue);assert.equal(p.overlays['target-0.json'].services.api.image,target);
});
test('missing executor or unverified scene produces blockers and no runnable scripts',()=>{
 const i=inventory();i.roles=i.roles.filter(r=>r.role!=='executor');i.evidence.secretMountsAligned=false;const p=renderReleasePlan(i,manifest);assert(!p.ready);assert(p.blockers.includes('missing-executor'));assert(p.blockers.includes('secretMountsAligned'));assert.equal(p.scripts,undefined);
});
test('floating image tags and incomplete Compose metadata cannot produce commands',()=>{
 const i=inventory();i.roles[0].imageId='latest';assert.throws(()=>renderReleasePlan(i,manifest),/RELEASE_ROLE_INVALID/);assert.throws(()=>renderReleasePlan(inventory(),{...manifest,paperEnabled:true}),/RELEASE_PLAN_INPUT_INVALID/);
});
test('completed root replies cannot hide unsettled task receipts or failed image pages from rollback checks',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-release-gate-')),file=path.join(dir,'fixture.txt');fs.writeFileSync(file,'synthetic-only');t.after(()=>{fs.unlinkSync(file);fs.rmdirSync(dir);});
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),sha=createHash('sha256').update('synthetic-only').digest('hex');
 const container={Image:digest,Config:{Env:[]},Mounts:[]},gateway={...container,State:{StartedAt:'2026-11-21T00:00:00Z'}};
 const scene={roles:[{container:'api',imageId:digest,mountsSha256:hash([]),environmentSha256:hash([])}],gateway:{container:'gateway',imageId:digest,startedAt:gateway.State.StartedAt,mountsSha256:hash([])},configurationFiles:[{path:file,sha256:sha}],backups:[{path:file,sha256:sha}],databases:{api:{container:'db',user:'fixture',database:'fixture'},qq:{container:'db',user:'fixture',database:'fixture'}}};
 let unsettled=0,unfinished=0;const dockerRead=args=>{if(args[0]==='inspect')return JSON.stringify([args[1]==='gateway'?gateway:container]);const sql=args.at(-1);if(sql.includes('to_regclass'))return '1';if(sql.includes('FROM mooyu_qq.agent_links'))return String(unsettled);if(sql.includes('FROM mooyu_qq.agent_image_pages'))return String(unfinished);return '0';};
 assert.equal(checkWindow(scene,{dockerRead}).ready,true);unsettled=1;assert.throws(()=>checkWindow(scene,{dockerRead}),/RELEASE_WINDOW_BUSY/);unsettled=0;unfinished=1;assert.throws(()=>checkWindow(scene,{dockerRead}),/RELEASE_WINDOW_BUSY/);
});
test('an unknown old API image without proven migration compatibility blocks command generation',()=>{
 const i=inventory();i.roles[0].imageId='sha256:'+'d'.repeat(64);assert(renderReleasePlan(i,manifest).blockers.includes('rollback-schema-unverified-api'));
});
