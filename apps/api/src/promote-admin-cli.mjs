import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';

const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const githubId = String(process.env.ADMIN_GITHUB_ID ?? '').trim();
if (!email && !/^\d+$/.test(githubId)) throw new Error('ADMIN_EMAIL or numeric ADMIN_GITHUB_ID is required');
if (email && githubId) throw new Error('Set only one of ADMIN_EMAIL or ADMIN_GITHUB_ID');
const provider = email ? 'email' : 'github';
const subject = email || githubId;
const database = createDatabase(loadConfig());
try {
  const result = await database.pool.query(
    `UPDATE users SET role='admin',can_publish=true,updated_at=now()
      WHERE id=(SELECT user_id FROM auth_identities WHERE provider=$1 AND subject=$2)
      RETURNING id,display_name,role,can_publish`, [provider, subject],
  );
  if (!result.rowCount) throw new Error('Account not found. Sign in once with this identity before promoting it.');
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
} finally {
  await database.close();
}
