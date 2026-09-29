import fs from 'node:fs/promises';
import path from 'node:path';
import { createDatabase } from '../apps/api/src/database.mjs';

const baseUrl = process.env.GAMEHUB_API_URL ?? 'http://127.0.0.1:3090';
const mailboxPath = path.resolve(process.cwd(), process.env.DEV_MAILBOX_PATH ?? '.runtime/platform/dev-mailbox.json');

const request = async (pathname, { method = 'GET', body, token } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${payload.error?.code ?? 'UNKNOWN'} ${payload.error?.message ?? ''}`);
  return payload.data;
};

const login = async (email, label) => {
  const challenge = await request('/v1/auth/email/challenges', { method: 'POST', body: { email, clientKind: 'browser' } });
  const mailbox = JSON.parse(await fs.readFile(mailboxPath, 'utf8'));
  if (mailbox.email !== email || !/^\d{6}$/.test(mailbox.code ?? '')) throw new Error(`Verification mailbox did not receive ${email}.`);
  return request('/v1/auth/email/verify', { method: 'POST', body: { challengeId: challenge.challengeId, code: mailbox.code, deviceLabel: label } });
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };

const ready = await request('/ready');
assert(ready.status === 'ready' && ready.migrations?.ready, 'API or database migrations are not ready.');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const alice = await login(`social-alice-${suffix}@gamehub.local`, 'Social E2E Alice');
const bob = await login(`social-bob-${suffix}@gamehub.local`, 'Social E2E Bob');
const admin = await login(`content-admin-${suffix}@gamehub.local`, 'Content Pipeline E2E Admin');
const validationDatabase = createDatabase({ databaseUrl: process.env.DATABASE_URL ?? 'postgres://gamehub:local-gamehub-only@127.0.0.1:54329/gamehub', databaseSsl: false });
try { await validationDatabase.pool.query("UPDATE users SET role='admin' WHERE id=$1", [admin.profile.id]); }
finally { await validationDatabase.close(); }
const aliceId = alice.profile.id;
const bobId = bob.profile.id;

await request('/v1/me', { method: 'PATCH', token: alice.accessToken, body: { displayName: '像素玩家 Alice' } });
await request('/v1/me', { method: 'PATCH', token: bob.accessToken, body: { displayName: '像素玩家 Bob' } });
await request('/v1/me/social', { method: 'PATCH', token: alice.accessToken, body: { bio: '只在编译间隙玩一局。', visibility: 'public' } });
await request('/v1/me/social', { method: 'PATCH', token: bob.accessToken, body: { bio: '猜百科练习生。', visibility: 'public' } });

const daily = await request('/v1/games/guess-baike/daily');
const puzzleId = daily.puzzle.id;
const officialPuzzles = await request('/v1/admin/games/guess-baike/puzzles', { token: admin.accessToken });
assert(officialPuzzles.length >= 6 && officialPuzzles.every(item => item.introHanCount >= 180), 'Official puzzle bank did not pass the complete-lead quality gate.');
const automationStatus = await request('/v1/admin/games/guess-baike/automation', { token: admin.accessToken });
assert(automationStatus.enabled && automationStatus.readyCount >= 6 && automationStatus.scheduleDays >= 3, 'Automatic puzzle supply is not enabled or observable.');
assert(automationStatus.lastRun && automationStatus.scheduledCount >= automationStatus.scheduleDays, 'Automatic puzzle supply did not fill the configured schedule horizon.');
const alternatePuzzle = officialPuzzles.find(item => item.id !== puzzleId && item.status === 'ready');
assert(alternatePuzzle, 'Official puzzle bank has no alternate ready puzzle.');
await request(`/v1/admin/games/guess-baike/puzzles/${alternatePuzzle.id}`, { method: 'PATCH', token: admin.accessToken, body: { status: 'disabled' } });
await request(`/v1/admin/games/guess-baike/puzzles/${alternatePuzzle.id}`, { method: 'PATCH', token: admin.accessToken, body: { status: 'ready' } });
await request('/v1/games/guess-baike/results', { method: 'POST', token: alice.accessToken, body: { puzzleDate: daily.date, puzzleId, guessedCount: 8, elapsedSeconds: 41, hints: 0 } });
await request('/v1/games/guess-baike/results', { method: 'POST', token: bob.accessToken, body: { puzzleDate: daily.date, puzzleId, guessedCount: 10, elapsedSeconds: 55, hints: 1 } });

const followed = await request(`/v1/users/${bobId}/follow`, { method: 'PUT', token: alice.accessToken });
assert(followed.id === bobId && followed.isFollowing, 'Following did not become visible on the player card.');
const followingBoard = await request(`/v1/games/guess-baike/leaderboard?date=${daily.date}&scope=following`, { token: alice.accessToken });
assert(followingBoard.some(entry => entry.player.id === bobId), 'Followed player is missing from the following leaderboard.');

await request(`/v1/users/${aliceId}/follow`, { method: 'PUT', token: bob.accessToken });
await request(`/v1/games/guess-baike/reactions/${aliceId}`, { method: 'PUT', token: bob.accessToken, body: { puzzleDate: daily.date, reaction: 'spark' } });
const reactedBoard = await request(`/v1/games/guess-baike/leaderboard?date=${daily.date}&scope=global`, { token: bob.accessToken });
const aliceScore = reactedBoard.find(entry => entry.player.id === aliceId);
assert(aliceScore?.myReaction === 'spark' && aliceScore.reactions.spark >= 1, 'Reaction is missing from the leaderboard.');
const notifications = await request('/v1/me/notifications', { token: alice.accessToken });
assert(notifications.some(item => item.type === 'follow' && item.actor.id === bobId), 'Follow notification is missing.');
assert(notifications.some(item => item.type === 'reaction' && item.actor.id === bobId && item.reaction === 'spark'), 'Reaction notification is missing.');
const marked = await request('/v1/me/notifications/read', { method: 'POST', token: alice.accessToken });
assert(marked.updated >= 2, 'Unread notifications were not marked read.');
const challenge = await request('/v1/games/guess-baike/challenges', { method: 'POST', token: alice.accessToken, body: { puzzleDate: daily.date } });
const challengeDetail = await request(`/v1/challenges/${challenge.code}`, { token: bob.accessToken });
assert(challengeDetail.creator.id === aliceId && challengeDetail.score.elapsedSeconds === 41, 'Challenge does not preserve the creator score.');
const accepted = await request(`/v1/challenges/${challenge.code}/accept`, { method: 'POST', token: bob.accessToken });
assert(accepted.accepted && !accepted.completed, 'Challenge was not accepted.');
const comparison = await request(`/v1/challenges/${challenge.code}/complete`, { method: 'POST', token: bob.accessToken });
assert(comparison.outcome === 'loss' && comparison.creator.elapsedSeconds === 41 && comparison.participant.elapsedSeconds === 55, 'Challenge comparison is incorrect.');
const repeated = await request(`/v1/challenges/${challenge.code}/complete`, { method: 'POST', token: bob.accessToken });
assert(repeated.outcome === 'loss', 'Challenge completion is not idempotent.');
const aliceChallenges = await request('/v1/me/challenges', { token: alice.accessToken });
const bobChallenges = await request('/v1/me/challenges', { token: bob.accessToken });
assert(aliceChallenges.some(item => item.code === challenge.code && item.outcome === 'win'), 'Creator challenge history is missing.');
assert(bobChallenges.some(item => item.code === challenge.code && item.outcome === 'loss'), 'Participant challenge history is missing.');
const completionNotifications = await request('/v1/me/notifications', { token: alice.accessToken });
assert(completionNotifications.some(item => item.type === 'challenge_complete' && item.challengeCode === challenge.code && item.outcome === 'win'), 'Challenge completion notification is missing.');
const retention = await request('/v1/me/retention', { token: alice.accessToken });
assert(retention.totalDays >= 1 && retention.badges.some(item => item.key === 'first_break' && item.unlocked), 'Retention summary or first badge is missing.');
const defaultPreferences = await request('/v1/me/notification-preferences', { token: alice.accessToken });
assert(defaultPreferences.follow && defaultPreferences.reaction && defaultPreferences.challenge, 'Notification preferences do not default on.');
const mutedPreferences = await request('/v1/me/notification-preferences', { method: 'PUT', token: alice.accessToken, body: { follow: true, reaction: false, challenge: true } });
assert(!mutedPreferences.reaction, 'Reaction notifications were not muted.');
const mutedNotifications = await request('/v1/me/notifications', { token: alice.accessToken });
assert(!mutedNotifications.some(item => item.type === 'reaction'), 'Muted reaction notifications remain visible.');
await request('/v1/me/notification-preferences', { method: 'PUT', token: alice.accessToken, body: { follow: true, reaction: true, challenge: true } });

await request(`/v1/users/${bobId}/block`, { method: 'PUT', token: alice.accessToken });
const blockedBoard = await request(`/v1/games/guess-baike/leaderboard?date=${daily.date}&scope=global`, { token: alice.accessToken });
assert(!blockedBoard.some(entry => entry.player.id === bobId), 'Blocked player is still visible in the leaderboard.');
const blockedProfile = await fetch(`${baseUrl}/v1/users/${bobId}`, { headers: { Authorization: `Bearer ${alice.accessToken}` } });
assert(blockedProfile.status === 404, 'Blocked player profile should be hidden.');

await request(`/v1/users/${bobId}/block`, { method: 'DELETE', token: alice.accessToken });
const restored = await request(`/v1/users/${bobId}`, { token: alice.accessToken });
assert(restored.id === bobId && !restored.isFollowing, 'Unblocking should restore visibility without restoring the follow relation.');

process.stdout.write(JSON.stringify({
  ok: true,
  migration: `${ready.migrations.applied}/${ready.migrations.expected}`,
  date: daily.date,
  automation: { status: automationStatus.lastRun.status, fetched: automationStatus.lastRun.fetchedCount, accepted: automationStatus.lastRun.acceptedCount, scheduledCoverage: `${automationStatus.scheduledCount}/${automationStatus.scheduleDays}`, errorCode: automationStatus.lastRun.errorCode },
  verified: ['automatic Wikipedia supply status', 'official puzzle quality gate', 'emergency puzzle disable and restore', 'profile', 'follow', 'global leaderboard', 'following leaderboard', 'fixed reaction', 'notifications', 'challenge accept', 'challenge completion', 'challenge history', 'streak and badges', 'notification preferences', 'block', 'unblock'],
  testUsers: [aliceId, bobId],
}, null, 2) + '\n');
