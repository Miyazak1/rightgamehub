import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const pg = requireApi('pg');
const { PostgresAgentBlogFoundationPublicationRepository } = await import(pathToFileURL(
  path.join(root, 'apps/api/src/agent-blog-foundation-publication-repository.mjs')).href);

const [actionId, workerId, leaseToken, articleId, revisionId, contentSha256] = process.argv.slice(2);
if (!process.env.QA_LEDGER_TEST_URL
  || [actionId, workerId, leaseToken, articleId, revisionId, contentSha256].some(value => !value)) {
  process.exit(90);
}

const pool = new pg.Pool({ connectionString: process.env.QA_LEDGER_TEST_URL, max: 2,
  application_name: 'agent-blog-publication-crash-test' });
const repository = new PostgresAgentBlogFoundationPublicationRepository(pool, {
  editorialMemoryRecorder: async () => ({ eventCount: 0 }),
  boundaryProbe: async event => {
    if (event.boundary === 'after-commit') process.exit(91);
  },
});
await repository.publish({ actionId, workerId, leaseToken, articleId, revisionId, contentSha256 });
await pool.end();
process.exit(92);
