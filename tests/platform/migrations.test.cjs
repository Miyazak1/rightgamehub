const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationDir = path.resolve(__dirname, '../../apps/api/migrations');
const files = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
const migrations = files.map(name => ({ name, sql: fs.readFileSync(path.join(migrationDir, name), 'utf8') }));

test('M1 migrations are sequential, transactional and non-destructive', () => {
  assert.equal(files.length, 54);
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
  const profiles = fs.readFileSync(path.join(migrationDir, '0039_public_user_profiles.sql'), 'utf8');
  assert.match(profiles, /CREATE UNIQUE INDEX users_profile_handle_unique_idx/);
  assert.match(profiles, /CREATE TABLE user_profile_links/);
  assert.match(profiles, /CREATE TABLE user_featured_works/);
  const profileLibrary = fs.readFileSync(path.join(migrationDir, '0040_public_profile_library.sql'), 'utf8');
  assert.match(profileLibrary, /ADD COLUMN profile_library_visibility/);
  const profileGitHub = fs.readFileSync(path.join(migrationDir, '0041_public_profile_github_repositories.sql'), 'utf8');
  assert.match(profileGitHub, /CREATE TABLE user_profile_github_repositories/);
  const profilePhaseTwo = fs.readFileSync(path.join(migrationDir, '0042_public_profile_phase_two.sql'), 'utf8');
  assert.match(profilePhaseTwo, /ADD COLUMN profile_collaboration_status/);
  assert.match(profilePhaseTwo, /ADD COLUMN profile_skills/);
  assert.match(profilePhaseTwo, /ADD COLUMN profile_activity_visibility/);
  assert.match(profilePhaseTwo, /ADD COLUMN profile_achievements_visibility/);
  const creatorFeedback = fs.readFileSync(path.join(migrationDir, '0043_creator_feedback.sql'), 'utf8');
  assert.match(creatorFeedback, /CREATE TABLE creator_feedback/);
  assert.match(creatorFeedback, /CREATE TABLE creator_feedback_events/);
  assert.match(creatorFeedback, /BEFORE UPDATE ON creator_feedback_events/);
  assert.match(creatorFeedback, /BEFORE DELETE ON creator_feedback_events/);
  const contributionTasks = fs.readFileSync(path.join(migrationDir, '0044_contribution_tasks.sql'), 'utf8');
  assert.match(contributionTasks, /CREATE TABLE contribution_tasks/);
  assert.match(contributionTasks, /CREATE TABLE contribution_task_events/);
  assert.match(contributionTasks, /最多|status IN \('claimed','submitted','completed'\)/);
  assert.match(contributionTasks, /BEFORE UPDATE ON contribution_task_events/);
  assert.match(contributionTasks, /BEFORE DELETE ON contribution_task_events/);
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
  const ruleSubmissions = fs.readFileSync(path.join(migrationDir, '0035_multiplayer_rule_submissions.sql'), 'utf8');
  assert.match(ruleSubmissions, /CREATE TABLE multiplayer_rule_submissions/);
  assert.match(ruleSubmissions, /CREATE TABLE multiplayer_rule_submission_grants/);
  assert.match(ruleSubmissions, /CREATE TABLE multiplayer_rule_submission_events/);
  assert.match(ruleSubmissions, /BEFORE UPDATE ON multiplayer_rule_submission_events/);
  assert.match(ruleSubmissions, /BEFORE DELETE ON multiplayer_rule_submission_events/);
  const sourceBuilds = fs.readFileSync(path.join(migrationDir, '0036_github_source_builds.sql'), 'utf8');
  assert.match(sourceBuilds, /CREATE TABLE source_revisions/);
  assert.match(sourceBuilds, /CREATE TABLE build_jobs/);
  assert.match(sourceBuilds, /CREATE TABLE release_provenance/);
  const sourceBuildImageIdentity = fs.readFileSync(path.join(migrationDir, '0037_source_build_image_identity.sql'), 'utf8');
  assert.match(sourceBuildImageIdentity, /build_jobs_revision_config_image_unique/);
  const ruleBuilds = fs.readFileSync(path.join(migrationDir, '0038_multiplayer_rule_builds.sql'), 'utf8');
  assert.match(ruleBuilds, /CREATE TABLE multiplayer_rule_builds/);
  assert.match(ruleBuilds, /CREATE TABLE multiplayer_rule_build_events/);
  assert.match(ruleBuilds, /BEFORE UPDATE ON multiplayer_rule_build_events/);
  assert.match(ruleBuilds, /BEFORE DELETE ON multiplayer_rule_build_events/);
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
    'multiplayer_rule_submissions', 'multiplayer_rule_submission_grants', 'multiplayer_rule_submission_events',
    'source_revisions', 'build_jobs', 'release_provenance', 'multiplayer_rule_builds', 'multiplayer_rule_build_events',
    'creator_feedback', 'creator_feedback_events',
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
