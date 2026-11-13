import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {migratePracticeRelease} from '../../apps/api/src/practice-release-migrate.mjs';
import {applyMigrations,migrationStatus} from '../../apps/api/src/migrations.mjs';
const url=process.env.MOOYU_RELEASE_TEST_DATABASE_URL;
test('release migration commits both new schemas atomically and leaves the old inventory usable on failure',{skip:!url,timeout:120000},async()=>{
 const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/postgres');
 const {Pool}=createRequire(new URL('../../apps/api/package.json',import.meta.url))('pg');
 const control=new Pool({connectionString:url}),name='release_atomic_'+crypto.randomUUID().replaceAll('-','');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-release-migrate-'));let pool;
 try{
  await control.query('CREATE DATABASE '+name);parsed.pathname='/'+name;pool=new Pool({connectionString:parsed.href});
  const actual=path.resolve('apps/api/migrations'),old=path.join(temp,'old'),broken=path.join(temp,'broken');
  await fs.mkdir(old);await fs.cp(actual,broken,{recursive:true});
  for(const file of (await fs.readdir(actual)).filter(f=>f.endsWith('.sql')).slice(0,158))await fs.copyFile(path.join(actual,file),path.join(old,file));
  await applyMigrations(pool,old);
  const last=path.join(broken,'0160_learning_practice.sql');await fs.writeFile(last,(await fs.readFile(last,'utf8')).replace(/COMMIT;\s*$/u,'SELECT mooyu_release_missing_function();\nCOMMIT;\n'));
  await assert.rejects(migratePracticeRelease(pool,broken),{code:'42883'});
  assert.equal((await pool.query("SELECT to_regclass('public.paper_study_documents') AS name")).rows[0].name,null);
  assert.equal((await migrationStatus(pool,old)).ready,true,'failed upgrade must leave the previous service ready');
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:158,total:160,applied:2});
  assert.equal((await migrationStatus(pool,actual)).ready,true);
  assert.equal((await migrationStatus(pool,old)).reason,'unexpected_version','rollback images need the newer migration inventory');
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:160,total:160,applied:0});
 }finally{
  if(pool)await pool.end();await control.query('DROP DATABASE IF EXISTS '+name);await control.end();await fs.rm(temp,{recursive:true,force:true});
 }
});
