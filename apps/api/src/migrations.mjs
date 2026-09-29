import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const migrationPattern = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function loadMigrations(directory) {
  const names = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name, index) => {
    const match = migrationPattern.exec(name);
    assert.ok(match, `invalid migration file name: ${name}`);
    assert.equal(Number(match[1]), index + 1, `migration sequence gap at ${name}`);
    const sql = await fs.readFile(path.join(directory, name), 'utf8');
    assert.match(sql, /^BEGIN;\s*/i, `${name} must begin a transaction`);
    assert.match(sql, /\s*COMMIT;\s*$/i, `${name} must commit its transaction`);
    return {
      version: match[1], name,
      body: sql.replace(/^BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, ''),
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
    };
  }));
}

async function tableExists(client) {
  const result = await client.query("SELECT to_regclass('public.schema_migrations') AS name");
  return result.rows[0]?.name === 'schema_migrations';
}

export async function applyMigrations(pool, directory) {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('gamehub-schema-migrations'))");
    const existing = new Map();
    if (await tableExists(client)) {
      const result = await client.query('SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version');
      for (const row of result.rows) existing.set(row.version, row.checksum_sha256);
    }
    for (const migration of migrations) {
      if (existing.has(migration.version)) {
        assert.equal(existing.get(migration.version), migration.checksum, `checksum changed for applied migration ${migration.name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.body);
        await client.query('INSERT INTO schema_migrations(version, checksum_sha256) VALUES ($1, $2)', [migration.version, migration.checksum]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied, total: migrations.length };
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('gamehub-schema-migrations'))"); } finally { client.release(); }
  }
}

export async function migrationStatus(pool, directory) {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  try {
    if (!(await tableExists(client))) return { ready: false, expected: migrations.length, applied: 0, reason: 'schema_missing' };
    const result = await client.query('SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version');
    const rows = new Map(result.rows.map(row => [row.version, row.checksum_sha256]));
    for (const migration of migrations) {
      if (!rows.has(migration.version)) return { ready: false, expected: migrations.length, applied: rows.size, reason: 'migration_pending' };
      if (rows.get(migration.version) !== migration.checksum) return { ready: false, expected: migrations.length, applied: rows.size, reason: 'checksum_mismatch' };
    }
    return { ready: rows.size === migrations.length, expected: migrations.length, applied: rows.size, reason: rows.size === migrations.length ? null : 'unexpected_version' };
  } finally { client.release(); }
}
