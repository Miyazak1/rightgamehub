import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupTask} from '../../apps/desktop/src/startup-task.cjs';

test('startup work is lazy and concurrent bridge calls wait for the same authenticated result', async () => {
  let release, calls = 0;
  const task = createStartupTask(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  assert.equal(calls, 0);
  const first = task.run(), second = task.run();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  let exposed = false;
  first.then(() => { exposed = true; });
  await Promise.resolve();assert.equal(exposed, false);
  const account = { authenticated: true };release(account);
  assert.equal(await first, account);assert.equal(await task.run(), account);
});

test('failed initialization fails closed for every waiter and does not retry credentials implicitly', async () => {
  let calls = 0;const events = [], failure = Error('isolated failure');
  const task = createStartupTask(() => { calls++; throw failure; }, value => events.push(value));
  await assert.rejects(task.run(), error => error === failure);
  await assert.rejects(task.run(), error => error === failure);
  assert.equal(calls, 1);assert.deepEqual(events, ['started', 'failed']);
});

test('closing during credential recovery rejects pending callers and ignores late readiness', async () => {
  let release;const events = [];
  const task = createStartupTask(() => new Promise(resolve => { release = resolve; }), value => events.push(value));
  const pending = task.run();await Promise.resolve();task.dispose();
  await assert.rejects(pending, {code:'DESKTOP_STARTUP_CLOSED'});
  release({authenticated:true});await Promise.resolve();await Promise.resolve();
  await assert.rejects(task.run(), {code:'DESKTOP_STARTUP_CLOSED'});
  assert.deepEqual(events, ['started']);
});

test('closing before first use never starts credential recovery', async () => {
  let calls = 0;const task = createStartupTask(() => calls++);
  task.dispose();task.dispose();await assert.rejects(task.run(), {code:'DESKTOP_STARTUP_CLOSED'});
  assert.equal(calls, 0);
});

test('hung recovery times out without exposing a late account result', async () => {
  let release;const events = [];
  const task = createStartupTask(() => new Promise(resolve => { release = resolve; }), state => events.push(state), {timeoutMs:15});
  await assert.rejects(task.run(), {code:'DESKTOP_STARTUP_TIMEOUT'});
  release({authenticated:true});await Promise.resolve();await Promise.resolve();
  await assert.rejects(task.run(), {code:'DESKTOP_STARTUP_TIMEOUT'});
  assert.deepEqual(events, ['started','failed']);
});
