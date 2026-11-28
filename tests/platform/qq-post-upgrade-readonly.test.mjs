import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { parseQQTimerBus, simulateQQRecovery, collectQQPostUpgrade, qqPostUpgradeReadonlyCommand } from '../../scripts/qq-websocket-post-upgrade-readonly.mjs';
import { decideQQRecovery } from '../../apps/qq-channel/src/recovery-policy.mjs';
import { assertGuardianIdentity, assertGuardianSnapshot, qqIdentityHash } from '../../scripts/qq-plugin-guardian.mjs';
import { wsNewMessageSQL, WS_PATCH_SHA256, WS_STAGE, WS_RELEASE, WS_RECORD } from '../../scripts/qq-websocket-release-common.mjs';

test('pure recovery simulation covers confirmation, limits, QR, stale and partial observations without mutation', () => {
  const report = simulateQQRecovery(decideQQRecovery, 10_000_000);
  assert.equal(report.passed, true); assert.equal(report.liveFaultInjected, false);
  assert.equal(Object.keys(report.checks).length, 12);
  assert.equal(simulateQQRecovery(() => ({ action: 'wait', reason: 'wrong-policy', state: { incident: { samples: 1 } } }), 10_000_000).passed, false);
});

test('stable samples alone cannot pass without a new confirmed reply or working guardian', async () => {
  for (const fault of [null, 'receipt', 'guardian', 'stale', 'read-failed']) {
    let now = 10_000_000;
    const report = await collectQQPostUpgrade({ now: () => now, wait: async ms => { now += ms; },
      context: async () => ({ checksPassed: fault !== 'guardian', gatewayId: 'g', gatewayStartedAt: 'g-start', workerId: 'w', workerStartedAt: 'w-start' }),
      sample: async () => { if (fault === 'read-failed') throw Error('PRIVATE_ERROR_MUST_NOT_PRINT'); return { contractValid: true, runtime: {
        available: true, loggedIn: true, coreReady: true, accountMatches: true, groupReady: true, connected: true,
        observation: 'fresh', restartRequired: false, phase: 'ready', checkedAt: new Date(fault === 'stale' ? 10_000_000 : now).toISOString(), verifiedAt: new Date(fault === 'stale' ? 10_000_000 : now).toISOString(),
      } }; }, receipt: async () => ({ confirmedReplies: fault === 'receipt' ? 0 : 1 }),
    }, decideQQRecovery, () => {});
    assert.equal(report.result, fault ? 'QQ_POST_UPGRADE_READONLY_REVIEW_REQUIRED' : 'QQ_POST_UPGRADE_READONLY_CHECKS_PASSED');
    assert.equal(report.observedMilliseconds, 50000); assert.equal(report.oldTasksRetried, false);
    assert.equal(report.liveDisconnectRecoveryTested, false); assert.equal(report.stateFilesWrittenByAudit, false);
  }
});

test('generated command parses, imports the frozen r2 modules and does not invoke recovery', () => {
  const command = qqPostUpgradeReadonlyCommand();
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  assert.equal(spawnSync(bash, ['-n'], { input: command, encoding: 'utf8' }).status, 0);
  const code = command.split("<<'NODE'\n")[1].split('\nNODE\n')[0];
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: code, encoding: 'utf8' }).status, 0);
  assert(command.includes(WS_STAGE)); assert(command.includes('sha256sum --check SHA256SUMS'));
  assert(!/executeQQRecovery|runGuardian|fs\.(?:write|mkdir|unlink|rename)|flock/.test(command));
});

async function runCommandFixture(fault, { timerOnly = false } = {}) {
  let now = Date.parse('2026-11-28T06:00:00Z');
  const output = [], calls = [], root = '/www/backup/gamehub/qq-independent-guardian-20261124-r1';
  let sqlReads = 0;
  const installed = '/www/backup/gamehub/qq-independent-plugin-release-20261124-r1';
  const runtime = '/root/mooyu-qq-gateway-runtime-20261124-Test12/node';
  const record = WS_RECORD + 'Test12', serviceFile = '/etc/systemd/system/mooyu-qq-guardian.service', timerFile = '/etc/systemd/system/mooyu-qq-guardian.timer';
  const exec = runtime + ' ' + installed + '/scripts/qq-plugin-guardian.mjs recover ' + root + '/config.private.json ' + root;
  const g = { Id: 'g'.repeat(64), Name: '/mooyu-qq-napcat-1', Image: 'sha256:' + 'a'.repeat(64),
    Config: { Env: ['NAPCAT_DISABLE_MULTI_PROCESS=0'] }, HostConfig: {}, Mounts: [{ Type: 'volume', Name: 'retained_login', Destination: '/data' }],
    NetworkSettings: { Networks: {} }, State: { Running: true, Restarting: false, StartedAt: 'gateway-start' } };
  const w = { Id: 'w'.repeat(64), Image: 'same-worker-image', State: { Running: true, Health: { Status: 'healthy' }, StartedAt: 'worker-start' } };
  const config = { version: 1, enabled: true, gateway: 'mooyu-qq-napcat-1', worker: 'mooyu-qq-worker-1',
    image: g.Image, identityHash: qqIdentityHash(g), loginVolume: 'retained_login', botId: '3922489710', groupId: '905757031' };
  const data = new Map([
    [WS_STAGE + '/last-operation.private.json', { releaseId: WS_RELEASE, mode: 'upgrade', record }],
    [record + '/state.private.json', { releaseId: WS_RELEASE, workerBefore: w, databases: { qq: {} }, files: [serviceFile, timerFile].map(p => ({ path: p, sha256: 'audited' })) }],
    [record + '/result.private.json', { mode: 'upgrade', result: 'QQ_WEBSOCKET_UPDATED_SCAN_REQUIRED', image: g.Image, completedAt: '2026-11-28T05:50:20.581Z' }],
    [root + '/config.private.json', config], [root + '/recovery-state.private.json', { version: 1, attempts: [], manualRequired: false }],
  ]);
  const fsFixture = {
    lstatSync: file => ({ isFile: () => true, isSymbolicLink: () => false, uid: 0, mode: data.has(file) ? 0o600 : 0o644, size: 100 }),
    readFileSync: file => {
      if (data.has(file)) return JSON.stringify(data.get(file));
      if (file === '/proc/uptime') return String(now / 1000) + ' 0';
      if (file === serviceFile) return '[Service]\nExecStart=' + exec + '\n';
      if (file === timerFile) return '[Timer]\nOnUnitInactiveSec=20\n';
      if (file === installed + '/scripts/qq-plugin-guardian.mjs' || file === installed + '/apps/qq-channel/src/recovery-policy.mjs') return 'audited';
      throw Error('UNEXPECTED_FILE_READ');
    },
  };
  const spawn = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemctl') {
      assert.equal(args[0], 'show'); const timer = args[1].endsWith('.timer');
      const props = { LoadState: 'loaded', ActiveState: timer ? (fault === 'timer' ? 'inactive' : 'active') : 'inactive',
        SubState: timer ? 'waiting' : 'dead', UnitFileState: 'enabled', Result: 'success', ExecMainStatus: '0',
        FragmentPath: timer ? timerFile : serviceFile, DropInPaths: '',
        ExecStart: '{ path=' + runtime + ' ; argv[]=' + exec + ' ; ignore_errors=no ; }',
        TimersMonotonic: '{ OnUnitInactiveUSec=20sec ; next_elapse=1week 2days ; }', Triggers: 'mooyu-qq-guardian.service',
        LastTriggerUSecMonotonic: '1week 2days 3h' };
      return { status: 0, stdout: Object.entries(props).map(([k, v]) => k + '=' + v).join('\n') };
    }
    if (cmd === 'busctl') {
      assert.equal(args[0], '--system'); assert.equal(args[1], 'get-property');
      assert.equal(args[3], '/org/freedesktop/systemd1/unit/mooyu_2dqq_2dguardian_2etimer');
      if (fault === 'timer-bus-failure') return { status: 1, stdout: '' };
      const value = args.at(-1) === 'TimersMonotonic'
        ? 'a(stt) 2 "OnBootUSec" 90000000 0 "OnUnitInactiveUSec" ' + (fault === 'timer-interval' ? '60000000' : '20000000') + ' 18446744073709551615'
        : args.at(-1) === 'LastTriggerUSec' ? 't ' + String(now * 1000 - (fault === 'timer-stale' ? 121_000_000 : 1_000_000))
          : 's "mooyu-qq-guardian.service"';
      return { status: 0, stdout: value };
    }
    assert.equal(cmd, 'docker'); assert(['inspect', 'exec'].includes(args[0]));
    if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([args[1] === 'mooyu-qq-napcat-1' ? g : w]) };
    assert.equal(args[2], 'node');
    if (args.includes('--input-type=module')) {
      const stamp = new Date(now).toISOString();
      return { status: 0, stdout: JSON.stringify({ binding: { botId: config.botId }, groupId: config.groupId, paperEnabled: false,
        runtime: { snapshotVersion: 2, available: true, loggedIn: true, coreReady: true, accountMatches: true, groupReady: true,
          connected: true, observation: 'fresh', restartRequired: false, phase: 'ready', checkedAt: stamp, verifiedAt: stamp } }) };
    }
    assert(args.at(-1).includes("readFileSync('/app/napcat/napcat.mjs')"));
    return { status: 0, stdout: WS_PATCH_SHA256 };
  };
  const code = qqPostUpgradeReadonlyCommand({ timerOnly }).split("<<'NODE'\n")[1].split('\nNODE\n')[0].replace(/^import .+;\n/gm, '');
  const sandbox = { fs: fsFixture, path: path.posix, spawnSync: spawn,
    Cutover: class { sql(_db, sql) { sqlReads++; assert(sql.startsWith('SELECT ')); return JSON.stringify(fault === 'receipt' ? [] : [{ replyDelivered: true }]); } },
    fileHash: file => fault === 'policy' && file === installed + '/apps/qq-channel/src/recovery-policy.mjs' ? 'unreviewed' : 'audited',
    assertGuardianIdentity, assertGuardianSnapshot, WORKER_SNAPSHOT_PROBE: 'existing-signed-status-only',
    WS_PATCH_SHA256, wsNewMessageSQL, wsRecordPath: p => { assert.equal(p, record); return p; }, decideQQRecovery,
    Date: class extends Date { static now() { return now; } }, structuredClone,
    process: { execPath: runtime, exitCode: undefined },
    setTimeout: (fn, ms) => { now += ms; fn(); }, console: { log: line => output.push(JSON.parse(line)) },
  };
  await new vm.Script('(async()=>{' + code + '})()').runInNewContext(sandbox);
  assert(!output.some(row => row.result === 'QQ_POST_UPGRADE_READONLY_READ_FAILED'), JSON.stringify(output.at(-1)));
  assert(calls.every(([cmd, verb, method]) => cmd === 'docker' ? ['inspect', 'exec'].includes(verb) : cmd === 'systemctl' ? verb === 'show' : cmd === 'busctl' && verb === '--system' && method === 'get-property'));
  if (timerOnly) { assert.equal(sqlReads, 0); assert(!output.some(row => row.section === 'postUpgradeSample')); }
  assert.equal(data.get(root + '/recovery-state.private.json').attempts.length, 0);
  return output.at(-1);
}

test('complete generated command uses read-only adapters and accepts an inactive successful oneshot service', async () => {
  const result = await runCommandFixture();
  assert.equal(result.result, 'QQ_POST_UPGRADE_READONLY_CHECKS_PASSED');
  assert.equal(result.newReplyConfirmed, true); assert.equal(result.liveDisconnectRecoveryTested, false);
});

test('complete generated command fails closed on missing receipt, inactive timer or unreviewed installed policy', async () => {
  for (const fault of ['receipt', 'timer', 'policy', 'timer-stale', 'timer-interval', 'timer-bus-failure']) assert.equal((await runCommandFixture(fault)).result, 'QQ_POST_UPGRADE_READONLY_REVIEW_REQUIRED');
});

test('typed timer values preserve UInt64 sentinel values and reject missing or inconsistent data', () => {
  const now = 10_000_000, values = { timers: 'a(stt) 1 "OnUnitInactiveUSec" 20000000 18446744073709551615', lastTrigger: 't ' + (now * 1000 - 1_000_000), unit: 's "mooyu-qq-guardian.service"' };
  assert.deepEqual(parseQQTimerBus(values, now), { readFailed: false, intervalMatches: true, targetMatches: true, recentlyTriggered: true, lastTriggerAgeSeconds: 1, intervalSeconds: 20 });
  assert.equal(parseQQTimerBus({ ...values, lastTrigger: 't 0' }, now).recentlyTriggered, false);
  assert.equal(parseQQTimerBus({ ...values, lastTrigger: 't ' + (now * 1000 + 1_000_000) }, now).recentlyTriggered, false);
  assert.equal(parseQQTimerBus({ ...values, unit: 's "unreviewed.service"' }, now).targetMatches, false);
  for (const timers of ['a(stt) 2 "OnUnitInactiveUSec" 20000000 0', 'a(stt) 1 "OnUnitInactiveUSec" -1 0', 'a(stt) 1 "OnUnitInactiveUSec" 20000000 18446744073709551616', 'invalid']) assert.throws(() => parseQQTimerBus({ ...values, timers }, now), /INVALID_TIMER_BUS_VALUE/);
  assert.throws(() => parseQQTimerBus({ ...values, lastTrigger: 't 2h 30min' }, now), /INVALID_TIMER_BUS_VALUE/);
});

test('targeted timer recheck reads raw loaded values without repeating message queries or the sample loop', async () => {
  assert.equal((await runCommandFixture(null, { timerOnly: true })).result, 'QQ_RECOVERY_TIMER_READONLY_CONFIRMED');
  for (const fault of ['timer', 'timer-stale', 'timer-interval', 'timer-bus-failure']) assert.equal((await runCommandFixture(fault, { timerOnly: true })).result, 'QQ_RECOVERY_TIMER_READONLY_REVIEW_REQUIRED');
  const command = qqPostUpgradeReadonlyCommand({ timerOnly: true });
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  assert.equal(spawnSync(bash, ['-n'], { input: command, encoding: 'utf8' }).status, 0);
});
