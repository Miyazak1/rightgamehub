import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {loadMigrations} from './migrations.mjs';

// Apply all pending additive migrations atomically from a verified baseline.
// Failure must not leave the old API with a partially upgraded inventory.
export async function migratePracticeRelease(pool,directory) {
  const migrations=await loadMigrations(directory);
  assert.equal(migrations.length,163,'This entry point is specific to the agent avatar release');
  const client=await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('gamehub-schema-migrations'))");
    await client.query('BEGIN');
    const rows=(await client.query('SELECT version,checksum_sha256 FROM schema_migrations ORDER BY version')).rows;
    assert.ok([158,160,161,162,163].includes(rows.length),'Expected a verified 158, 160, 161, 162 or 163 migration baseline');
    for(const [index,row] of rows.entries()){
      assert.equal(row.version,migrations[index].version);
      assert.equal(row.checksum_sha256,migrations[index].checksum,'Existing migration checksum changed');
    }
    for(const migration of migrations.slice(rows.length)){
      await client.query(migration.body);
      await client.query('INSERT INTO schema_migrations(version,checksum_sha256) VALUES($1,$2)',[migration.version,migration.checksum]);
    }
    await client.query('COMMIT');
    return {previous:rows.length,total:163,applied:163-rows.length};
  } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {try{await client.query("SELECT pg_advisory_unlock(hashtext('gamehub-schema-migrations'))");}finally{client.release();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  try {console.log(JSON.stringify(await migratePracticeRelease(pool,fileURLToPath(new URL('../migrations/',import.meta.url)))));}
  catch(error){console.error('Practice release migration failed:',error.code??'RELEASE_MIGRATION_REJECTED');process.exitCode=1;}
  finally{await pool.end();}
}
