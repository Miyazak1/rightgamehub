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
test('162 to 163 preserves existing avatars and immutable audit history even when upgrade fails',{skip:!url,timeout:120000},async()=>{
 const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/postgres');
 const {Pool}=createRequire(new URL('../../apps/api/package.json',import.meta.url))('pg');
 const control=new Pool({connectionString:url}),name='release_avatar_'+crypto.randomUUID().replaceAll('-','');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-avatar-migrate-'));let pool;
 try{
  await control.query('CREATE DATABASE '+name);parsed.pathname='/'+name;pool=new Pool({connectionString:parsed.href});
  const actual=path.resolve('apps/api/migrations'),baseline=path.join(temporary,'baseline'),broken=path.join(temporary,'broken');
  await fs.mkdir(baseline);await fs.cp(actual,broken,{recursive:true});
  for(const file of (await fs.readdir(actual)).filter(file=>file.endsWith('.sql')).sort().slice(0,162))await fs.copyFile(path.join(actual,file),path.join(baseline,file));
  await applyMigrations(pool,baseline);
  const user=crypto.randomUUID(),operator=crypto.randomUUID(),seed=await pool.connect();
  try{
   await seed.query('BEGIN');
   await seed.query("INSERT INTO users(id,display_name,role) VALUES($1,'Avatar operator','admin')",[operator]);
   await seed.query("INSERT INTO users(id,display_name,account_type,can_publish) VALUES($1,'Retained bot','agent',false)",[user]);
   await seed.query("INSERT INTO user_avatars(user_id,kind,preset_key) VALUES($1,'preset','xiaomoyu')",[user]);
   await seed.query("INSERT INTO agent_accounts(user_id,provision_key,provision_digest,operator_user_id,badge_label,operator_label) VALUES($1,'avatar-migration-test',$2,$3,'AI 助手','Retained operator')",[user,'a'.repeat(64),operator]);
   await seed.query("INSERT INTO agent_account_events(agent_user_id,operator_user_id,action) VALUES($1,$2,'provision')",[user,operator]);
   await seed.query('COMMIT');
  }catch(error){await seed.query('ROLLBACK');throw error;}finally{seed.release();}
  const before=(await pool.query('SELECT * FROM user_avatars WHERE user_id=$1',[user])).rows;
  const history=(await pool.query('SELECT * FROM agent_account_events WHERE agent_user_id=$1',[user])).rows;
  const last=path.join(broken,'0163_agent_avatar_audit.sql');
  await fs.writeFile(last,(await fs.readFile(last,'utf8')).replace(/COMMIT;\s*$/u,'SELECT missing_avatar_migration_function();\nCOMMIT;\n'));
  await assert.rejects(migratePracticeRelease(pool,broken),{code:'42883'});
  assert.equal((await migrationStatus(pool,baseline)).ready,true);
  assert.deepEqual((await pool.query('SELECT * FROM agent_account_events WHERE agent_user_id=$1',[user])).rows,history);
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:162,total:163,applied:1});
  assert.deepEqual((await pool.query('SELECT * FROM user_avatars WHERE user_id=$1',[user])).rows,before);
  const upgraded=(await pool.query('SELECT * FROM agent_account_events WHERE agent_user_id=$1',[user])).rows.map(({metadata_json,...event})=>{assert.deepEqual(metadata_json,{});return event;});
  assert.deepEqual(upgraded,history);
  await assert.rejects(pool.query('UPDATE agent_account_events SET action=action WHERE agent_user_id=$1',[user]),/append only/);
 }finally{await pool?.end();await control.query('DROP DATABASE IF EXISTS '+name);await control.end();await fs.rm(temporary,{recursive:true,force:true});}
});
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
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:158,total:163,applied:5});
  assert.equal((await migrationStatus(pool,actual)).ready,true);
  assert.equal((await migrationStatus(pool,old)).reason,'unexpected_version','rollback images need the newer migration inventory');
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:163,total:163,applied:0});
 }finally{
  if(pool)await pool.end();await control.query('DROP DATABASE IF EXISTS '+name);await control.end();await fs.rm(temp,{recursive:true,force:true});
 }
});

test('160 to 161 preserves existing data and failed input-artifact migration rolls back completely',{skip:!url,timeout:120000},async()=>{
 const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/postgres');
 const {Pool}=createRequire(new URL('../../apps/api/package.json',import.meta.url))('pg');
 const control=new Pool({connectionString:url}),name='release_input_'+crypto.randomUUID().replaceAll('-','');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-input-migrate-'));let pool;
 try{
  await control.query('CREATE DATABASE '+name);parsed.pathname='/'+name;pool=new Pool({connectionString:parsed.href});
  const actual=path.resolve('apps/api/migrations'),baseline=path.join(temporary,'baseline'),broken=path.join(temporary,'broken');
  await fs.mkdir(baseline);await fs.cp(actual,broken,{recursive:true});
  for(const file of (await fs.readdir(actual)).filter(file=>file.endsWith('.sql')).sort().slice(0,160))await fs.copyFile(path.join(actual,file),path.join(baseline,file));
  await applyMigrations(pool,baseline);
  const existing=crypto.randomUUID();await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Retained release fixture')",[existing]);
  const last=path.join(broken,'0161_agent_provider_input_artifacts.sql');
  await fs.writeFile(last,(await fs.readFile(last,'utf8')).replace(/COMMIT;\s*$/u,'SELECT missing_input_migration_function();\nCOMMIT;\n'));
  await assert.rejects(migratePracticeRelease(pool,broken),{code:'42883'});
  assert.equal((await migrationStatus(pool,baseline)).ready,true);
  assert.equal((await pool.query("SELECT to_regclass('public.agent_provider_input_artifacts') AS name")).rows[0].name,null);
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:160,total:163,applied:3});
  assert.equal((await pool.query('SELECT display_name FROM users WHERE id=$1',[existing])).rows[0].display_name,'Retained release fixture');
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:163,total:163,applied:0});
 }finally{await pool?.end();await control.query('DROP DATABASE IF EXISTS '+name);await control.end();await fs.rm(temporary,{recursive:true,force:true});}
});

test('161 to 162 installs recovery atomically and retains prior users and migration checksums',{skip:!url,timeout:120000},async()=>{
 const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/postgres');
 const {Pool}=createRequire(new URL('../../apps/api/package.json',import.meta.url))('pg');
 const control=new Pool({connectionString:url}),name='release_recovery_'+crypto.randomUUID().replaceAll('-','');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-recovery-migrate-'));let pool;
 try{
  await control.query('CREATE DATABASE '+name);parsed.pathname='/'+name;pool=new Pool({connectionString:parsed.href});
  const actual=path.resolve('apps/api/migrations'),baseline=path.join(temporary,'baseline'),broken=path.join(temporary,'broken');
  await fs.mkdir(baseline);await fs.cp(actual,broken,{recursive:true});
  for(const file of (await fs.readdir(actual)).filter(file=>file.endsWith('.sql')).sort().slice(0,161))await fs.copyFile(path.join(actual,file),path.join(baseline,file));
  await applyMigrations(pool,baseline);
  const before=(await pool.query('SELECT version,checksum_sha256 FROM schema_migrations ORDER BY version')).rows;
  const user=crypto.randomUUID();await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Recovery retained user')",[user]);
  const last=path.join(broken,'0162_agent_blog_public_recovery.sql');
  await fs.writeFile(last,(await fs.readFile(last,'utf8')).replace(/COMMIT;\s*$/u,'SELECT missing_recovery_migration_function();\nCOMMIT;\n'));
  await assert.rejects(migratePracticeRelease(pool,broken),{code:'42883'});
  assert.equal((await migrationStatus(pool,baseline)).ready,true);
  assert.equal((await pool.query("SELECT to_regclass('public.agent_blog_public_requests') AS name")).rows[0].name,null);
  assert.deepEqual(await migratePracticeRelease(pool,actual),{previous:161,total:163,applied:2});
  assert.deepEqual((await pool.query("SELECT version,checksum_sha256 FROM schema_migrations WHERE version<'0162' ORDER BY version")).rows,before);
  assert.equal((await pool.query('SELECT display_name FROM users WHERE id=$1',[user])).rows[0].display_name,'Recovery retained user');
 }finally{await pool?.end();await control.query('DROP DATABASE IF EXISTS '+name);await control.end();await fs.rm(temporary,{recursive:true,force:true});}
});
