import { loadConfig } from './config.mjs';
import { createDatabase } from './database.mjs';

const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL is required');
const database = createDatabase(loadConfig());
try {
  const result = await database.pool.query(
    `UPDATE users SET role='admin',can_publish=true,updated_at=now()
      WHERE id=(SELECT user_id FROM auth_identities WHERE provider='email' AND subject=$1)
      RETURNING id,display_name,role,can_publish`, [email],
  );
  if (!result.rowCount) throw new Error('Account not found. Sign in once with this email before promoting it.');
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
} finally {
  await database.close();
}
