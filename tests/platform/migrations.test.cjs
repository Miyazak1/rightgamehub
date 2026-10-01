const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDir = path.resolve(__dirname, '../../apps/api/migrations');
const files = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
const migrations = files.map(name => ({ name, sql: fs.readFileSync(path.join(migrationDir, name), 'utf8') }));

test('M1 migrations are sequential, transactional and non-destructive', () => {
  assert.equal(files.length, 34);
  const moderation = fs.readFileSync(path.join(migrationDir, '0020_content_moderation.sql'), 'utf8');
  assert.match(moderation, /CREATE TABLE content_reports/);
  assert.match(moderation, /CREATE TABLE moderation_audit_events/);
  assert.match(moderation, /BEFORE UPDATE ON moderation_audit_events/);
  assert.match(moderation, /BEFORE DELETE ON moderation_audit_events/);
  const social = fs.readFileSync(path.join(migrationDir, '0021_social_foundation.sql'), 'utf8');
  assert.match(social, /CREATE TABLE user_follows/);
  assert.match(social, /CREATE TABLE user_blocks/);
  assert.match(social, /social_visibility IN \('public','followers','private'\)/);
  const loop = fs.readFileSync(path.join(migrationDir, '0022_structured_social_loop.sql'), 'utf8');
  assert.match(loop, /CREATE TABLE guess_baike_reactions/);
  assert.match(loop, /CREATE TABLE social_notifications/);
  assert.match(loop, /CREATE TABLE game_challenges/);
  const completion = fs.readFileSync(path.join(migrationDir, '0023_challenge_completion.sql'), 'utf8');
  assert.match(completion, /CREATE TABLE challenge_participations/);
  const retention = fs.readFileSync(path.join(migrationDir, '0024_retention_preferences.sql'), 'utf8');
  assert.match(retention, /CREATE TABLE user_notification_preferences/);
  const content = fs.readFileSync(path.join(migrationDir, '0025_guess_baike_content_pipeline.sql'), 'utf8');
  assert.match(content, /CREATE TABLE guess_baike_puzzles/);
  assert.match(content, /CREATE TABLE guess_baike_schedule/);
  const automation = fs.readFileSync(path.join(migrationDir, '0026_guess_baike_automation.sql'), 'utf8');
  assert.match(automation, /CREATE TABLE guess_baike_automation_runs/);
  assert.match(automation, /ADD COLUMN origin/);
  const discovery = fs.readFileSync(path.join(migrationDir, '0027_community_discovery.sql'), 'utf8');
  assert.match(discovery, /ADD COLUMN estimated_minutes/);
  assert.match(discovery, /ADD COLUMN repository_url/);
  assert.match(discovery, /works_public_discovery_idx/);
  const analytics = fs.readFileSync(path.join(migrationDir, '0029_analytics_foundation.sql'), 'utf8');
  assert.match(analytics, /CREATE TABLE analytics_events/);
  assert.match(analytics, /download_complete/);
  assert.doesNotMatch(analytics, /\b(ip_address|user_agent|full_url|project_path|prompt)\b/i);
  const multiplayer = fs.readFileSync(path.join(migrationDir, '0030_multiplayer_rooms.sql'), 'utf8');
  assert.match(multiplayer, /CREATE TABLE multiplayer_game_modes/);
  assert.match(multiplayer, /CREATE TABLE multiplayer_rooms/);
  assert.match(multiplayer, /CREATE TABLE multiplayer_room_members/);
  const matches = fs.readFileSync(path.join(migrationDir, '0031_multiplayer_matches.sql'), 'utf8');
  assert.match(matches, /CREATE TABLE multiplayer_matches/);
  assert.match(matches, /CREATE TABLE multiplayer_match_players/);
  assert.match(matches, /CREATE TABLE multiplayer_match_events/);
  assert.match(matches, /CREATE TABLE multiplayer_match_snapshots/);
  const multiplayerOperations = fs.readFileSync(path.join(migrationDir, '0032_multiplayer_operations.sql'), 'utf8');
  assert.match(multiplayerOperations, /CREATE TABLE multiplayer_admin_events/);
  assert.match(multiplayerOperations, /BEFORE UPDATE ON multiplayer_admin_events/);
  assert.match(multiplayerOperations, /BEFORE DELETE ON multiplayer_admin_events/);
  const githubSource = fs.readFileSync(path.join(migrationDir, '0033_github_source_import.sql'), 'utf8');
  assert.match(githubSource, /CREATE TABLE github_source_connections/);
  assert.match(githubSource, /CREATE TABLE github_source_repositories/);
  assert.match(githubSource, /CREATE TABLE github_source_imports/);
  assert.match(githubSource, /CREATE TABLE work_sources/);
  assert.match(githubSource, /CREATE TABLE github_webhook_deliveries/);
  assert.match(githubSource, /BEFORE UPDATE ON github_source_audit_events/);
  assert.match(githubSource, /BEFORE DELETE ON github_source_audit_events/);
  const multiplayerInvites = fs.readFileSync(path.join(migrationDir, '0034_multiplayer_room_invites.sql'), 'utf8');
  assert.match(multiplayerInvites, /CREATE TABLE multiplayer_room_invites/);
  assert.match(multiplayerInvites, /token_digest bytea NOT NULL UNIQUE/);
  files.forEach((name, index) => assert.match(name, new RegExp(`^${String(index + 1).padStart(4, '0')}_`)));
  for (const migration of migrations) {
    assert.match(migration.sql, /^BEGIN;/);
    assert.match(migration.sql, /COMMIT;\s*$/);
    assert.doesNotMatch(migration.sql, /\b(DROP\s+(TABLE|COLUMN)|TRUNCATE)\b/i);
  }
});

test('migration baseline contains every M1 identity, work, upload and queue table', () => {
  const sql = migrations.map(item => item.sql).join('\n');
  const expected = [
    'schema_migrations', 'users', 'user_avatars', 'auth_identities', 'email_challenges', 'device_grants',
    'access_tokens', 'refresh_tokens', 'github_device_challenges', 'github_web_challenges', 'creator_usage', 'works', 'work_targets', 'releases',
    'upload_jobs', 'upload_grants', 'jobs', 'idempotency_keys', 'user_library', 'guess_baike_results', 'user_follows', 'user_blocks',
    'guess_baike_reactions', 'social_notifications', 'game_challenges', 'challenge_participations', 'user_notification_preferences',
    'guess_baike_puzzles', 'guess_baike_schedule', 'guess_baike_automation_runs', 'creator_applications', 'analytics_events',
    'multiplayer_game_modes', 'multiplayer_rooms', 'multiplayer_room_members', 'multiplayer_matches',
    'multiplayer_match_players', 'multiplayer_match_events', 'multiplayer_match_snapshots', 'multiplayer_admin_events',
    'github_source_install_states', 'github_source_connections', 'github_source_repositories', 'github_source_imports',
    'work_sources', 'github_webhook_deliveries', 'github_source_audit_events', 'multiplayer_room_invites',
  ];
  for (const table of expected) assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`, 'i'), table);
});

test('database constraints prevent cross-target release pointers and token disclosure storage', () => {
  const sql = migrations.map(item => item.sql).join('\n');
  assert.match(sql, /FOREIGN KEY \(work_id, target_key, current_release_id\)[\s\S]*REFERENCES releases\(work_id, target_key, id\)/i);
  assert.match(sql, /token_hash bytea NOT NULL UNIQUE/i);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token|upload_token)\s+text\b/i);
  assert.match(sql, /UNIQUE \(family_id, generation\)/i);
});

test('queue and upload indexes support lease recovery and expiry cleanup', () => {
  const sql = migrations.map(item => item.sql).join('\n');
  assert.match(sql, /jobs_ready_idx/i);
  assert.match(sql, /jobs_lease_idx/i);
  assert.match(sql, /upload_jobs_expiry_idx/i);
  assert.match(sql, /idempotency_keys_expiry_idx/i);
  assert.match(sql, /upload_jobs_release_id_unique/i);
  assert.match(sql, /releases_asset_prefix_unique/i);
});
