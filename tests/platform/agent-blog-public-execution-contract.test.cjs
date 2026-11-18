const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const load = name => import('../../apps/api/src/' + name);
const manifest = { stages: [{ maxAttempts: 3 }, { maxAttempts: 1 }], defaultBudget: { wallClockSeconds: 10 } };

test('a committed run resumes without executing any stage again',async()=>{
  const {executeAgentBlogPublicRun}=await load('agent-blog-public-runtime-manual-run.mjs');
  const runId=crypto.randomUUID(),durable={id:runId,status:'succeeded',outputType:'blog.article',outputId:crypto.randomUUID()};
  let stopped=0;
  assert.equal(await executeAgentBlogPublicRun({runId,workflow:manifest,outputType:'blog.article',readRun:async()=>durable,
    worker:{runOnce:async()=>assert.fail('completed stages must not dispatch'),stop:async()=>{stopped++;}}}),durable);
  assert.equal(stopped,1);
});

test('recovery runs even before the schedule heartbeat row exists',async()=>{
  const {runAgentBlogPublicScheduleCycle}=await load('agent-blog-public-schedule-cycle.mjs');
  let ran=false;const errors=[];
  const result=await runAgentBlogPublicScheduleCycle({controller:{heartbeat:async()=>{throw Error('schedule missing');},
    runOnce:async()=>{ran=true;return {status:'recovered'};}},onHeartbeatError:error=>errors.push(error.message)});
  assert.equal(result.status,'recovered');assert.equal(ran,true);assert.equal(errors.length,2);
});

test('lost final acknowledgements reconcile only an exact durable success without running another stage', async () => {
  const { executeAgentBlogPublicRun } = await load('agent-blog-public-runtime-manual-run.mjs');
  const runId = crypto.randomUUID(), outputId = crypto.randomUUID();
  const durable = { id: runId, status: 'succeeded', outputType: 'blog.article', outputId };
  for (const thrown of [false, true]) {
    let calls = 0, stopped = 0, reads=0;
    const result = await executeAgentBlogPublicRun({ runId, workflow: manifest, outputType: 'blog.article',
      readRun: async id => { assert.equal(id, runId); return reads++?durable:null; }, worker: {
        runOnce: async () => { calls++; if(thrown)throw Error('commit acknowledgement lost'); return { status: 'lease-lost' }; },
        stop: async () => { stopped++; },
      } });
    assert.equal(result, durable); assert.equal(calls, 1); assert.equal(stopped, 1);
  }
  for (const observed of [null, { ...durable, id: crypto.randomUUID() }, { ...durable, status: 'uncertain' },
    { ...durable, outputType: 'blog.private-draft' }, { ...durable, outputId: 'invalid' }]) {
    let reads=0;
    await assert.rejects(executeAgentBlogPublicRun({ runId, workflow: manifest, outputType: 'blog.article',
      readRun: async () => reads++?observed:null, worker: { runOnce: async () => ({ status: 'lease-lost' }), stop: async () => {} } }),
    error => error.code === (observed?.status==='uncertain'?'AGENT_BLOG_PUBLIC_RUNTIME_TERMINAL_FAILURE':'AGENT_BLOG_PUBLIC_RUNTIME_STAGE_INCOMPLETE'));
  }
});

test('public execution waits for durable retry and idle backoff without counting a retry as a completed stage', async () => {
  const { executeAgentBlogPublicRun } = await load('agent-blog-public-runtime-manual-run.mjs');
  const runId = crypto.randomUUID(), outputId = crypto.randomUUID();
  let now = 1000, stopped = 0;
  const sleeps = [], queue = [
    { status: 'retry-scheduled', stage: { status: 'queued', availableAt: new Date(2000).toISOString() } },
    { status: 'idle' }, { status: 'completed' },
    { status: 'completed', run: { id: runId, status: 'succeeded', outputType: 'blog.article', outputId } },
  ];
  const result = await executeAgentBlogPublicRun({ runId, workflow: manifest, outputType: 'blog.article',
    now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; },
    worker: { runOnce: async () => queue.shift(), stop: async () => { stopped++; } } });
  assert.equal(result.outputId, outputId);
  assert.deepEqual(sleeps, [1000, 250]);
  assert.equal(stopped, 1);
  assert.equal(queue.length, 0);
});

test('public execution never retries uncertain outcomes and always releases its worker', async () => {
  const { executeAgentBlogPublicRun } = await load('agent-blog-public-runtime-manual-run.mjs');
  for (const status of ['uncertain', 'failed', 'lease-lost', 'waiting', 'idle', 'retry-scheduled']) {
    let calls = 0, stopped = 0;
    await assert.rejects(executeAgentBlogPublicRun({ runId: crypto.randomUUID(), workflow: manifest,
      outputType: 'blog.article', worker: { runOnce: async () => { calls++; return { status,
        error: { uncertain: true }, stage: { status: 'queued' } }; }, stop: async () => { stopped++; } } }),
    error => error.code === 'AGENT_BLOG_PUBLIC_RUNTIME_STAGE_INCOMPLETE');
    assert.equal(calls, 1); assert.equal(stopped, 1);
  }
});

test('public execution honors the frozen attempt and wall-clock limits', async () => {
  const { executeAgentBlogPublicRun } = await load('agent-blog-public-runtime-manual-run.mjs');
  for (const idle of [false, true]) {
    let now = 0, stopped = 0, calls = 0;
    await assert.rejects(executeAgentBlogPublicRun({ runId: crypto.randomUUID(), workflow: manifest,
      outputType: 'blog.article', now: () => now, sleep: async ms => { now += ms; },
      worker: { runOnce: async () => ({ status: idle && calls++ ? 'idle' : 'retry-scheduled',
        stage: { status: 'queued', availableAt: new Date(now + 1000).toISOString() } }),
      stop: async () => { stopped++; } } }), error => error.code === 'AGENT_BLOG_PUBLIC_RUNTIME_EXECUTION_LIMIT');
    assert.equal(stopped, 1);
  }
});

test('long public cycles keep heartbeats live and stop the timer before recording final state', async t => {
  const { runAgentBlogPublicScheduleCycle } = await load('agent-blog-public-schedule-cycle.mjs');
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish;
  const events = [], result = { status: 'failed', fire: { scheduleSuspended: true } };
  const cycle = runAgentBlogPublicScheduleCycle({ controller: {
    heartbeat: async ({ state }) => { events.push(state); },
    runOnce: () => new Promise(resolve => { finish = resolve; }),
  }, heartbeatMilliseconds: 1000 });
  await Promise.resolve();
  t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.filter(x => x === 'busy').length, 3);
  finish(result); assert.equal(await cycle, result);
  assert.equal(events.at(-1), 'suspended');
  const count = events.length;
  t.mock.timers.tick(10000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, count);
});

test('heartbeat failure cannot replace a completed publication result or leave a late busy heartbeat', async t => {
  const { runAgentBlogPublicScheduleCycle } = await load('agent-blog-public-schedule-cycle.mjs');
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish, count = 0;
  const errors = [], result = { status: 'succeeded' };
  const cycle = runAgentBlogPublicScheduleCycle({ controller: {
    heartbeat: async () => { if (++count > 1) throw Error('database temporarily unavailable'); },
    runOnce: () => new Promise(resolve => { finish = resolve; }),
  }, heartbeatMilliseconds: 1000, onHeartbeatError: error => errors.push(error.message) });
  await Promise.resolve(); t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve));
  finish(result); assert.equal(await cycle, result);
  assert.equal(errors.length, 2);
  const last = count; t.mock.timers.tick(10000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, last);
});
