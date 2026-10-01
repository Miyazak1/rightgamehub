import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';

const iso = value => value?.toISOString?.() ?? value ?? null;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hashRequest = value => sha256(canonicalJson(value));

export class GitHubSourceError extends Error {
  constructor(code, statusCode, message, retryable = false) {
    super(message); this.name = 'GitHubSourceError'; this.code = code; this.statusCode = statusCode; this.retryable = retryable;
  }
}

const connectionView = row => ({
  id: row.id, installationId: String(row.installation_id), accountId: String(row.account_id),
  accountLogin: row.account_login, accountType: row.account_type, repositorySelection: row.repository_selection,
  status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});
const repositoryView = row => ({
  id: row.id, connectionId: row.connection_id, repositoryId: String(row.repository_id), nodeId: row.node_id,
  owner: row.owner_login, name: row.name, defaultBranch: row.default_branch, visibility: row.visibility,
  htmlUrl: row.html_url, accessState: row.access_state, lastSeenAt: iso(row.last_seen_at),
});
const importView = row => ({
  importId: row.id, workId: row.work_id ?? null, repository: row.repository_snapshot, commitSha: row.commit_sha, treeSha: row.tree_sha,
  readmeExcerpt: row.readme_excerpt, readmeSha256: row.readme_sha256,
  license: { status: row.license_status, spdx: row.license_spdx, path: row.license_path, sha256: row.license_sha256 },
  staticSignals: row.static_signals ?? {}, createdAt: iso(row.created_at),
});
const workView = row => ({
  id: row.id, ownerUserId: row.owner_user_id, title: row.title, description: row.description,
  instructions: row.instructions, kind: row.kind, state: row.state, visibility: row.visibility,
  revision: String(row.revision), firstPublishedAt: iso(row.first_published_at), coverUrl: null,
  estimatedMinutes: row.estimated_minutes, tags: row.tags ?? [], agentLabel: row.agent_label,
  repositoryUrl: row.repository_url, licenseSpdx: row.license_spdx, creatorDisplayName: null,
  playCount: 0, saveCount: 0, targets: [],
});
const sourceView = row => ({
  workId: row.work_id, provider: row.provider, repositoryId: String(row.repository_id), repositoryNodeId: row.repository_node_id,
  visibility: row.repository_visibility, owner: row.owner_login, name: row.repository_name,
  repositoryUrl: row.repository_url, defaultBranch: row.default_branch, commitSha: row.commit_sha,
  treeSha: row.tree_sha, status: row.source_status, provenance: row.provenance,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
});

export class PostgresGitHubSourceRepository {
  constructor(pool) { this.pool = pool; }

  async createInstallState({ id, userId, stateHash, expiresAt }) {
    await this.pool.query("DELETE FROM github_source_install_states WHERE expires_at<now()-interval '1 day'");
    await this.pool.query('INSERT INTO github_source_install_states(id,user_id,state_hash,expires_at) VALUES ($1,$2,$3,$4)', [id, userId, Buffer.from(stateHash, 'hex'), expiresAt]);
  }

  async consumeInstallState({ userId, stateHash, installation }) {
    return withTransaction(this.pool, async client => {
      const state = (await client.query(
        `UPDATE github_source_install_states SET consumed_at=now()
          WHERE user_id=$1 AND state_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING id`,
        [userId, Buffer.from(stateHash, 'hex')],
      )).rows[0];
      if (!state) throw new GitHubSourceError('GITHUB_INSTALL_STATE_INVALID', 400, 'GitHub installation state is invalid or expired.');
      const occupied = (await client.query('SELECT user_id FROM github_source_connections WHERE installation_id=$1 FOR UPDATE', [installation.installationId])).rows[0];
      if (occupied && occupied.user_id !== userId) throw new GitHubSourceError('GITHUB_INSTALLATION_IN_USE', 409, 'This GitHub installation is already linked to another account.');
      const row = (await client.query(
        `INSERT INTO github_source_connections(id,user_id,installation_id,account_id,account_login,account_type,repository_selection,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
         ON CONFLICT (installation_id) DO UPDATE SET account_id=EXCLUDED.account_id,account_login=EXCLUDED.account_login,
           account_type=EXCLUDED.account_type,repository_selection=EXCLUDED.repository_selection,status='active',suspended_at=NULL,revoked_at=NULL,updated_at=now()
         RETURNING *`,
        [crypto.randomUUID(), userId, installation.installationId, installation.accountId, installation.accountLogin, installation.accountType, installation.repositorySelection],
      )).rows[0];
      await client.query(
        `INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,action,details)
         VALUES ($1,$2,$3,'connection.completed',$4)`,
        [crypto.randomUUID(), userId, row.id, { installationId: installation.installationId, accountLogin: installation.accountLogin }],
      );
      return connectionView(row);
    });
  }

  async listConnections(userId) {
    return (await this.pool.query('SELECT * FROM github_source_connections WHERE user_id=$1 ORDER BY updated_at DESC', [userId])).rows.map(connectionView);
  }

  async getConnection(userId, connectionId) {
    const row = (await this.pool.query('SELECT * FROM github_source_connections WHERE id=$1 AND user_id=$2', [connectionId, userId])).rows[0];
    if (!row) throw new GitHubSourceError('NOT_FOUND', 404, 'GitHub connection not found.');
    return connectionView(row);
  }

  async revokeConnection(userId, connectionId) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `UPDATE github_source_connections SET status='revoked',revoked_at=now(),updated_at=now()
          WHERE id=$1 AND user_id=$2 RETURNING *`, [connectionId, userId],
      )).rows[0];
      if (!row) throw new GitHubSourceError('NOT_FOUND', 404, 'GitHub connection not found.');
      await client.query("UPDATE github_source_repositories SET access_state='connection_revoked',updated_at=now() WHERE connection_id=$1", [connectionId]);
      await client.query("UPDATE work_sources SET source_status='revoked',updated_at=now() WHERE source_import_id IN (SELECT id FROM github_source_imports WHERE connection_id=$1)", [connectionId]);
      await client.query("INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,action) VALUES ($1,$2,$3,'connection.revoked')", [crypto.randomUUID(), userId, connectionId]);
      return connectionView(row);
    });
  }

  async syncRepositories(userId, connectionId, repositories, complete = true) {
    return withTransaction(this.pool, async client => {
      const connection = (await client.query("SELECT * FROM github_source_connections WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE", [connectionId, userId])).rows[0];
      if (!connection) throw new GitHubSourceError('GITHUB_CONNECTION_UNAVAILABLE', 409, 'GitHub connection is not active.');
      const ids = [];
      for (const repo of repositories) {
        ids.push(repo.repositoryId);
        await client.query(
          `INSERT INTO github_source_repositories(id,connection_id,repository_id,node_id,owner_login,name,default_branch,visibility,html_url,access_state,last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',now())
           ON CONFLICT (connection_id,repository_id) DO UPDATE SET node_id=EXCLUDED.node_id,owner_login=EXCLUDED.owner_login,name=EXCLUDED.name,
             default_branch=EXCLUDED.default_branch,visibility=EXCLUDED.visibility,html_url=EXCLUDED.html_url,access_state='active',last_seen_at=now(),updated_at=now()`,
          [crypto.randomUUID(), connectionId, repo.repositoryId, repo.nodeId, repo.owner, repo.name, repo.defaultBranch, repo.visibility, repo.htmlUrl],
        );
      }
      if (complete && ids.length) await client.query("UPDATE github_source_repositories SET access_state='removed',updated_at=now() WHERE connection_id=$1 AND repository_id<>ALL($2::bigint[]) AND access_state='active'", [connectionId, ids]);
      else if (complete) await client.query("UPDATE github_source_repositories SET access_state='removed',updated_at=now() WHERE connection_id=$1 AND access_state='active'", [connectionId]);
      return (await client.query("SELECT * FROM github_source_repositories WHERE connection_id=$1 AND access_state='active' ORDER BY owner_login,name LIMIT 500", [connectionId])).rows.map(repositoryView);
    });
  }

  async getRepository(userId, connectionId, repositoryId) {
    const row = (await this.pool.query(
      `SELECT r.* FROM github_source_repositories r JOIN github_source_connections c ON c.id=r.connection_id
        WHERE r.connection_id=$1 AND r.repository_id=$2 AND c.user_id=$3 AND c.status='active' AND r.access_state='active'`,
      [connectionId, repositoryId, userId],
    )).rows[0];
    if (!row) throw new GitHubSourceError('GITHUB_REPOSITORY_UNAVAILABLE', 404, 'Authorized GitHub repository not found.');
    return repositoryView(row);
  }

  async savePreview(input) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query(
        `INSERT INTO github_source_imports(id,user_id,connection_id,source_repository_id,commit_sha,tree_sha,status,repository_snapshot,readme_excerpt,readme_sha256,license_status,license_spdx,license_path,license_sha256,static_signals)
         VALUES ($1,$2,$3,$4,$5,$6,'previewed',$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (user_id,source_repository_id,commit_sha) DO UPDATE SET tree_sha=EXCLUDED.tree_sha,repository_snapshot=EXCLUDED.repository_snapshot,
           readme_excerpt=EXCLUDED.readme_excerpt,readme_sha256=EXCLUDED.readme_sha256,license_status=EXCLUDED.license_status,
           license_spdx=EXCLUDED.license_spdx,license_path=EXCLUDED.license_path,license_sha256=EXCLUDED.license_sha256,static_signals=EXCLUDED.static_signals,updated_at=now()
         RETURNING *`,
        [input.id, input.userId, input.connectionId, input.repositoryRowId, input.commitSha, input.treeSha, input.repository,
          input.readmeExcerpt, input.readmeSha256, input.license.status, input.license.spdx, input.license.path, input.license.sha256, input.staticSignals],
      )).rows[0];
      await client.query(
        `INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,source_repository_id,source_import_id,action,details)
         VALUES ($1,$2,$3,$4,$5,'import.previewed',$6)`,
        [crypto.randomUUID(), input.userId, input.connectionId, input.repositoryRowId, row.id, { commitSha: input.commitSha, visibility: input.repository.visibility }],
      );
      return importView(row);
    });
  }

  async createDraft(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`idempotency:${input.actor.userId}:github_source.draft:${input.idempotencyKey}`]);
      const existing = (await client.query("SELECT request_hash,result_json FROM idempotency_keys WHERE actor_id=$1 AND operation='github_source.draft' AND key=$2", [input.actor.userId, input.idempotencyKey])).rows[0];
      if (existing) {
        if (existing.request_hash !== input.requestHash) throw new GitHubSourceError('IDEMPOTENCY_CONFLICT', 409, 'The idempotency key was already used for another request.');
        return existing.result_json;
      }
      const user = (await client.query('SELECT status,can_publish FROM users WHERE id=$1 FOR UPDATE', [input.actor.userId])).rows[0];
      if (!user || user.status !== 'active' || !user.can_publish) throw new GitHubSourceError('PUBLISH_NOT_ENABLED', 403, 'Publishing is not enabled for this account.');
      const sourceImport = (await client.query(
        `SELECT i.*,r.repository_id,r.node_id,r.owner_login,r.name,r.default_branch,r.visibility,r.html_url,r.access_state,c.status AS connection_status
           FROM github_source_imports i JOIN github_source_repositories r ON r.id=i.source_repository_id
           JOIN github_source_connections c ON c.id=i.connection_id
          WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE`, [input.importId, input.actor.userId],
      )).rows[0];
      if (!sourceImport) throw new GitHubSourceError('NOT_FOUND', 404, 'GitHub import preview not found.');
      if (sourceImport.connection_status !== 'active' || sourceImport.access_state !== 'active') throw new GitHubSourceError('GITHUB_SOURCE_ACCESS_LOST', 409, 'GitHub repository access is no longer active.');
      if (sourceImport.work_id) {
        const work = (await client.query('SELECT * FROM works WHERE id=$1 AND owner_user_id=$2', [sourceImport.work_id, input.actor.userId])).rows[0];
        const source = (await client.query('SELECT * FROM work_sources WHERE work_id=$1 AND source_import_id=$2', [sourceImport.work_id, input.importId])).rows[0];
        if (!work || !source) throw new GitHubSourceError('GITHUB_IMPORT_STATE_INVALID', 409, 'The existing imported draft could not be restored.');
        const result = { work: workView(work), source: sourceView(source) };
        await client.query(
          `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
           VALUES ($1,'github_source.draft',$2,$3,200,$4,now()+interval '24 hours')`,
          [input.actor.userId, input.idempotencyKey, input.requestHash, result],
        );
        return result;
      }
      const usage = (await client.query('SELECT work_count FROM creator_usage WHERE user_id=$1 FOR UPDATE', [input.actor.userId])).rows[0];
      if (!usage || usage.work_count >= 5) throw new GitHubSourceError('QUOTA_EXCEEDED', 429, 'The work quota has been reached.');
      const publicEvidence = sourceImport.visibility === 'public' && sourceImport.license_status === 'recognized';
      const work = (await client.query(
        `INSERT INTO works(id,owner_user_id,title,description,instructions,kind,estimated_minutes,tags,repository_url,license_spdx)
         VALUES ($1,$2,$3,$4,'',$5,3,$6,$7,$8) RETURNING *`,
        [input.workId, input.actor.userId, input.title, input.description, input.kind, ['github-import'], publicEvidence ? sourceImport.html_url : null, publicEvidence ? sourceImport.license_spdx : null],
      )).rows[0];
      const provenance = { provider: 'github', importedAt: new Date().toISOString(), repositoryId: String(sourceImport.repository_id), commitSha: sourceImport.commit_sha, treeSha: sourceImport.tree_sha, licenseStatus: sourceImport.license_status };
      const source = (await client.query(
        `INSERT INTO work_sources(id,work_id,source_import_id,repository_id,repository_node_id,repository_visibility,owner_login,repository_name,repository_url,default_branch,commit_sha,tree_sha,provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [crypto.randomUUID(), input.workId, input.importId, sourceImport.repository_id, sourceImport.node_id, sourceImport.visibility, sourceImport.owner_login, sourceImport.name, sourceImport.html_url, sourceImport.default_branch, sourceImport.commit_sha, sourceImport.tree_sha, provenance],
      )).rows[0];
      await client.query("UPDATE github_source_imports SET status='succeeded',work_id=$2,updated_at=now() WHERE id=$1", [input.importId, input.workId]);
      await client.query('UPDATE creator_usage SET work_count=work_count+1,updated_at=now() WHERE user_id=$1', [input.actor.userId]);
      await client.query(
        `INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,source_repository_id,source_import_id,work_id,action,details)
         VALUES ($1,$2,$3,$4,$5,$6,'draft.created',$7)`,
        [crypto.randomUUID(), input.actor.userId, sourceImport.connection_id, sourceImport.source_repository_id, input.importId, input.workId, { commitSha: sourceImport.commit_sha }],
      );
      const result = { work: workView(work), source: sourceView(source) };
      await client.query(
        `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash,result_status,result_json,expires_at)
         VALUES ($1,'github_source.draft',$2,$3,200,$4,now()+interval '24 hours')`,
        [input.actor.userId, input.idempotencyKey, input.requestHash, result],
      );
      return result;
    });
  }

  async getWorkSource(userId, workId) {
    const row = (await this.pool.query('SELECT s.* FROM work_sources s JOIN works w ON w.id=s.work_id WHERE s.work_id=$1 AND w.owner_user_id=$2', [workId, userId])).rows[0];
    if (!row) throw new GitHubSourceError('NOT_FOUND', 404, 'Work source not found.');
    return sourceView(row);
  }

  async beginWebhook({ deliveryId, event, installationId, payloadSha256 }) {
    const result = await this.pool.query(
      `INSERT INTO github_webhook_deliveries(delivery_id,event,installation_id,payload_sha256,status)
       VALUES ($1,$2,$3,$4,'received') ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`,
      [deliveryId, event, installationId || null, payloadSha256],
    );
    return Boolean(result.rows[0]);
  }

  async finishWebhook(deliveryId, status, resultCode) {
    await this.pool.query('UPDATE github_webhook_deliveries SET status=$2,result_code=$3,processed_at=now() WHERE delivery_id=$1', [deliveryId, status, resultCode]);
  }

  async applyInstallationEvent(installationId, action) {
    const status = action === 'suspend' ? 'suspended' : action === 'deleted' ? 'revoked' : 'active';
    const sourceStatus = status === 'suspended' ? 'suspended' : status === 'revoked' ? 'revoked' : 'active';
    await withTransaction(this.pool, async client => {
      const row = (await client.query(
        `UPDATE github_source_connections SET status=$2,suspended_at=CASE WHEN $2='suspended' THEN now() ELSE NULL END,
          revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END,updated_at=now() WHERE installation_id=$1 RETURNING id,user_id`,
        [installationId, status],
      )).rows[0];
      if (!row) return;
      if (status === 'active') await client.query("UPDATE github_source_repositories SET access_state='active',updated_at=now() WHERE connection_id=$1 AND access_state='connection_suspended'", [row.id]);
      else if (status === 'suspended') await client.query("UPDATE github_source_repositories SET access_state='connection_suspended',updated_at=now() WHERE connection_id=$1 AND access_state='active'", [row.id]);
      else await client.query("UPDATE github_source_repositories SET access_state='connection_revoked',updated_at=now() WHERE connection_id=$1", [row.id]);
      if (sourceStatus === 'active') await client.query("UPDATE work_sources SET source_status='active',updated_at=now() WHERE source_import_id IN (SELECT id FROM github_source_imports WHERE connection_id=$1) AND source_status='suspended'", [row.id]);
      else await client.query('UPDATE work_sources SET source_status=$2,updated_at=now() WHERE source_import_id IN (SELECT id FROM github_source_imports WHERE connection_id=$1)', [row.id, sourceStatus]);
      await client.query('INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,action,details) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), row.user_id, row.id, `webhook.installation.${action}`, { installationId: String(installationId) }]);
    });
  }

  async applyRepositorySelectionEvent(installationId, added, removed) {
    await withTransaction(this.pool, async client => {
      const connection = (await client.query('SELECT id,user_id FROM github_source_connections WHERE installation_id=$1', [installationId])).rows[0];
      if (!connection) return;
      for (const repo of added) await client.query(
        `INSERT INTO github_source_repositories(id,connection_id,repository_id,node_id,owner_login,name,default_branch,visibility,html_url,access_state,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',now()) ON CONFLICT (connection_id,repository_id) DO UPDATE SET access_state='active',last_seen_at=now(),updated_at=now()`,
        [crypto.randomUUID(), connection.id, repo.id, repo.node_id, repo.owner?.login, repo.name, repo.default_branch ?? 'main', repo.visibility ?? (repo.private ? 'private' : 'public'), repo.html_url],
      );
      const removedIds = removed.map(repo => String(repo.id));
      if (removedIds.length) {
        await client.query("UPDATE github_source_repositories SET access_state='removed',updated_at=now() WHERE connection_id=$1 AND repository_id=ANY($2::bigint[])", [connection.id, removedIds]);
        await client.query("UPDATE work_sources SET source_status='access_lost',updated_at=now() WHERE source_import_id IN (SELECT i.id FROM github_source_imports i JOIN github_source_repositories r ON r.id=i.source_repository_id WHERE i.connection_id=$1 AND r.repository_id=ANY($2::bigint[]))", [connection.id, removedIds]);
      }
      await client.query('INSERT INTO github_source_audit_events(id,actor_user_id,connection_id,action,details) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), connection.user_id, connection.id, 'webhook.repositories.changed', { added: added.map(repo => String(repo.id)), removed: removedIds }]);
    });
  }

  async adminOverview(actor) {
    if (actor.profile?.role !== 'admin') throw new GitHubSourceError('FORBIDDEN', 403, 'Administrator access is required.');
    const row = (await this.pool.query(`SELECT
      (SELECT count(*) FROM github_source_connections WHERE status='active')::int AS active_connections,
      (SELECT count(*) FROM github_source_repositories WHERE access_state='active')::int AS active_repositories,
      (SELECT count(*) FROM github_source_imports WHERE created_at>now()-interval '24 hours')::int AS imports_24h,
      (SELECT count(*) FROM github_webhook_deliveries WHERE status='failed' AND created_at>now()-interval '24 hours')::int AS failed_webhooks_24h`)).rows[0];
    return { activeConnections: row.active_connections, activeRepositories: row.active_repositories, imports24h: row.imports_24h, failedWebhooks24h: row.failed_webhooks_24h };
  }

  async adminAudit(actor, limit) {
    if (actor.profile?.role !== 'admin') throw new GitHubSourceError('FORBIDDEN', 403, 'Administrator access is required.');
    return (await this.pool.query('SELECT id,actor_user_id,connection_id,source_import_id,work_id,action,details,created_at FROM github_source_audit_events ORDER BY created_at DESC LIMIT $1', [limit])).rows.map(row => ({
      id: row.id, actorUserId: row.actor_user_id, connectionId: row.connection_id, importId: row.source_import_id, workId: row.work_id,
      action: row.action, details: row.details, createdAt: iso(row.created_at),
    }));
  }
}

const cleanReadme = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\((?:javascript:|data:)[^)]*\)/gi, '$1')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);

const licenseEvidence = raw => {
  if (!raw) return { status: 'missing', spdx: null, path: null, sha256: null };
  const spdx = raw.license?.spdx_id && !['NOASSERTION', 'OTHER'].includes(raw.license.spdx_id) ? String(raw.license.spdx_id).slice(0, 80) : null;
  let content = null;
  try { if (raw.encoding === 'base64' && typeof raw.content === 'string') content = Buffer.from(raw.content.replace(/\s/g, ''), 'base64'); } catch {}
  if (content && content.length > 256 * 1024) content = null;
  return { status: spdx ? 'recognized' : 'unknown', spdx, path: raw.path ? String(raw.path).slice(0, 512) : null, sha256: content ? sha256(content) : null };
};

const staticSignals = names => {
  const has = value => names.includes(value);
  return {
    indexHtml: has('index.html'), packageJson: has('package.json'),
    vite: names.some(name => /^vite\.config\./.test(name)), three: names.some(name => name.includes('three')),
    babylon: names.some(name => name.includes('babylon')), unityWebgl: has('build') && has('templateData'.toLowerCase()),
  };
};

export function createGitHubSourceService({ repository, githubClient, enabled, webhookSecret, ids = () => crypto.randomUUID(), now = () => Date.now() }) {
  const assertEnabled = () => { if (!enabled || !githubClient) throw new GitHubSourceError('GITHUB_SOURCE_IMPORT_DISABLED', 503, 'GitHub source import is not enabled.'); };
  const assertWrite = actor => { if (!actor?.scopes?.includes('works:write') || !actor.profile?.canPublish) throw new GitHubSourceError('PUBLISH_NOT_ENABLED', 403, 'Publishing is not enabled for this account.'); };
  return {
    async startInstall(actor) {
      assertEnabled(); assertWrite(actor);
      const state = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(now() + 10 * 60 * 1000);
      await repository.createInstallState({ id: ids(), userId: actor.userId, stateHash: sha256(state), expiresAt });
      return { installUrl: githubClient.installUrl(state), expiresAt: expiresAt.toISOString() };
    },
    async completeInstall(actor, body) {
      assertEnabled(); assertWrite(actor);
      const installation = await githubClient.getInstallation(body.installationId);
      const changedAt = Math.max(Date.parse(installation.createdAt ?? '') || 0, Date.parse(installation.updatedAt ?? '') || 0);
      if (!changedAt || Math.abs(now() - changedAt) > 15 * 60 * 1000) throw new GitHubSourceError('GITHUB_INSTALLATION_NOT_RECENT', 409, 'GitHub installation must be newly installed or updated from this flow.');
      if (installation.suspendedAt) throw new GitHubSourceError('GITHUB_CONNECTION_UNAVAILABLE', 409, 'GitHub installation is suspended.');
      if (installation.permissions?.contents !== 'read' || Object.values(installation.permissions ?? {}).some(value => value === 'write')) {
        throw new GitHubSourceError('GITHUB_APP_PERMISSIONS_INVALID', 409, 'GitHub App permissions must be read-only Metadata and Contents.');
      }
      return repository.consumeInstallState({ userId: actor.userId, stateHash: sha256(body.state), installation });
    },
    async listConnections(actor) { assertEnabled(); assertWrite(actor); return repository.listConnections(actor.userId); },
    async disconnect(actor, connectionId) { assertEnabled(); assertWrite(actor); const result = await repository.revokeConnection(actor.userId, connectionId); githubClient.clearInstallationToken(result.installationId); return result; },
    async listRepositories(actor, connectionId) {
      assertEnabled(); assertWrite(actor);
      const connection = await repository.getConnection(actor.userId, connectionId);
      if (connection.status !== 'active') throw new GitHubSourceError('GITHUB_CONNECTION_UNAVAILABLE', 409, 'GitHub connection is not active.');
      const result = await githubClient.listRepositories(connection.installationId, 500);
      return repository.syncRepositories(actor.userId, connectionId, result.repositories, result.complete);
    },
    async preview(actor, body) {
      assertEnabled(); assertWrite(actor);
      const connection = await repository.getConnection(actor.userId, body.connectionId);
      const repo = await repository.getRepository(actor.userId, body.connectionId, body.repositoryId);
      const preview = await githubClient.previewRepository(connection.installationId, repo.owner, repo.name);
      if (preview.repo.repositoryId !== repo.repositoryId) throw new GitHubSourceError('GITHUB_REPOSITORY_MISMATCH', 409, 'GitHub repository identity changed.');
      const readmeExcerpt = cleanReadme(preview.readme);
      return repository.savePreview({
        id: ids(), userId: actor.userId, connectionId: body.connectionId, repositoryRowId: repo.id,
        commitSha: preview.commitSha, treeSha: preview.treeSha,
        repository: { repositoryId: repo.repositoryId, owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch, visibility: repo.visibility, htmlUrl: repo.htmlUrl, description: preview.repo.description ?? '', topics: preview.repo.topics ?? [] },
        readmeExcerpt, readmeSha256: readmeExcerpt ? sha256(readmeExcerpt) : null,
        license: licenseEvidence(preview.license), staticSignals: staticSignals(preview.rootNames),
      });
    },
    async createDraft(actor, body, idempotencyKey) {
      assertEnabled(); assertWrite(actor);
      if (!/^[\x21-\x7e]{16,128}$/.test(idempotencyKey ?? '')) throw new GitHubSourceError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key is required.');
      return repository.createDraft({ actor, importId: body.importId, title: body.title, description: body.description ?? '', kind: body.kind ?? 'game', workId: ids(), idempotencyKey, requestHash: hashRequest(body) });
    },
    async getWorkSource(actor, workId) { assertEnabled(); assertWrite(actor); return repository.getWorkSource(actor.userId, workId); },
    async handleWebhook(headers, rawBody) {
      assertEnabled();
      const signature = String(headers['x-hub-signature-256'] ?? '');
      const expected = `sha256=${crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
      const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) throw new GitHubSourceError('GITHUB_WEBHOOK_SIGNATURE_INVALID', 401, 'GitHub webhook signature is invalid.');
      const deliveryId = String(headers['x-github-delivery'] ?? '');
      const event = String(headers['x-github-event'] ?? '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId) || !/^[a-z_]{1,80}$/.test(event)) throw new GitHubSourceError('GITHUB_WEBHOOK_HEADERS_INVALID', 400, 'GitHub webhook headers are invalid.');
      let payload; try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw new GitHubSourceError('SCHEMA_INVALID', 400, 'GitHub webhook JSON is invalid.'); }
      const installationId = payload.installation?.id ? String(payload.installation.id) : null;
      const fresh = await repository.beginWebhook({ deliveryId, event, installationId, payloadSha256: sha256(rawBody) });
      if (!fresh) return { accepted: true, replay: true };
      try {
        if (event === 'installation' && ['deleted', 'suspend', 'unsuspend', 'new_permissions_accepted'].includes(payload.action)) {
          await repository.applyInstallationEvent(installationId, payload.action);
          if (payload.action === 'deleted') githubClient.clearInstallationToken(installationId);
        }
        else if (event === 'installation_repositories') await repository.applyRepositorySelectionEvent(installationId, payload.repositories_added ?? [], payload.repositories_removed ?? []);
        else { await repository.finishWebhook(deliveryId, 'ignored', 'EVENT_IGNORED'); return { accepted: true, replay: false }; }
        await repository.finishWebhook(deliveryId, 'processed', 'OK');
        return { accepted: true, replay: false };
      } catch (error) { await repository.finishWebhook(deliveryId, 'failed', error.code ?? 'INTERNAL_ERROR'); throw error; }
    },
    adminOverview: actor => repository.adminOverview(actor),
    adminAudit: (actor, limit = 50) => repository.adminAudit(actor, Math.min(100, Math.max(1, limit))),
  };
}
