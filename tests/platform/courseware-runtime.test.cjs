const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const runtimeUrl = pathToFileURL(path.join(root, 'packages/courseware-runtime/src/index.mjs')).href;
const digest = `sha256:${'a'.repeat(64)}`;

function manifest(overrides = {}) {
  return {
    format: 'mooyu.courseware-module', schemaVersion: 1, id: 'math.functions', version: '1.0.0', kind: 'domain', apiVersion: 1,
    entry: './math-functions.mjs', integrity: digest, hotSwap: 'paused', stateSchemaVersion: 1,
    capabilities: ['observable.function-value'], commands: ['coefficient.set'], dependencies: [], ...overrides,
  };
}

function mathModule(runtime, overrides = {}) {
  return runtime.defineCoursewareModule({
    manifest: manifest(overrides),
    createState: () => ({ coefficient: 1 }),
    reduce: ({ state, command }) => command.name === 'coefficient.set' ? { ...state, coefficient: command.payload.value } : state,
    observe: ({ state, query }) => query?.x === undefined ? state : ({ x: query.x, y: state.coefficient * query.x ** 2 }),
  });
}

test('module registry resolves capability dependencies and keeps optional modules optional', async () => {
  const runtime = await import(runtimeUrl);
  const registry = new runtime.CoursewareModuleRegistry();
  registry.register(mathModule(runtime));
  registry.register(runtime.defineCoursewareModule({
    manifest: manifest({ id: 'instrument.coordinate-probe', version: '1.0.0', kind: 'instrument', entry: './coordinate-probe.mjs', hotSwap: 'live', capabilities: ['instrument.probe'], commands: [], dependencies: [
      { id: 'math.functions', apiVersion: 1, capabilities: ['observable.function-value'] },
      { id: 'component.optional-grid', apiVersion: 1, capabilities: ['view.grid'], optional: true },
    ] }),
    observe: ({ query, context }) => context.observe('math.functions', query),
  }));
  const session = new runtime.CoursewareRuntime({ registry });
  session.activate('instrument.coordinate-probe');
  assert.deepEqual(session.activeModules.map(item => item.id), ['math.functions', 'instrument.coordinate-probe']);
  assert.deepEqual(session.observe('instrument.coordinate-probe', { x: 3 }), { x: 3, y: 9 });
});

test('the same initial state and command sequence produces the same snapshot', async () => {
  const runtime = await import(runtimeUrl);
  const run = () => {
    const session = new runtime.CoursewareRuntime();
    session.register(mathModule(runtime)); session.activate('math.functions'); session.start();
    session.dispatch('math.functions', 'coefficient.set', { value: -2 }); session.advance(250);
    session.pause(); return session.snapshot();
  };
  assert.deepEqual(run(), run());
});

test('runtime snapshots restore the authoritative command branch', async () => {
  const runtime=await import(runtimeUrl),session=new runtime.CoursewareRuntime();
  session.register(mathModule(runtime));session.activate('math.functions');
  session.dispatch('math.functions','coefficient.set',{value:-2});
  const branchPoint=session.snapshot();
  session.dispatch('math.functions','coefficient.set',{value:9});
  session.restore(branchPoint);
  session.dispatch('math.functions','coefficient.set',{value:3});
  const restored=session.snapshot();
  assert.deepEqual(restored.commands.map(command=>command.payload.value),[-2,3]);
  assert.equal(session.observe('math.functions').coefficient,3);
  const fresh=new runtime.CoursewareRuntime();fresh.register(mathModule(runtime));fresh.activate('math.functions');fresh.restore(restored);
  assert.deepEqual(fresh.snapshot().commands,restored.commands);
});

test('live instruments hot swap while running and preserve their isolated state', async () => {
  const runtime = await import(runtimeUrl);
  const session = new runtime.CoursewareRuntime();
  const instrument = version => runtime.defineCoursewareModule({
    manifest: manifest({ id: 'instrument.counter', version, kind: 'instrument', entry: './counter.mjs', hotSwap: 'live', capabilities: ['instrument.counter'], commands: ['increment'], dependencies: [] }),
    createState: () => ({ count: 0 }),
    reduce: ({ state }) => ({ count: state.count + 1 }),
    observe: ({ state }) => ({ ...state, renderer: version }),
  });
  session.register(instrument('1.0.0')); session.activate('instrument.counter'); session.start();
  session.dispatch('instrument.counter', 'increment');
  assert.deepEqual(session.swap(instrument('1.1.0')), { moduleId: 'instrument.counter', fromVersion: '1.0.0', toVersion: '1.1.0' });
  assert.deepEqual(session.observe('instrument.counter'), { count: 1, renderer: '1.1.0' });
});

test('domain swaps require a pause and explicit migration when state schema changes', async () => {
  const runtime = await import(runtimeUrl);
  const session = new runtime.CoursewareRuntime();
  session.register(mathModule(runtime)); session.activate('math.functions'); session.start();
  const upgraded = runtime.defineCoursewareModule({
    manifest: manifest({ version: '2.0.0', stateSchemaVersion: 2 }),
    reduce: ({ state, command }) => command.name === 'coefficient.set' ? { ...state, a: command.payload.value } : state,
    observe: ({ state }) => state,
    migrateState: ({ state }) => ({ a: state.coefficient, family: 'quadratic' }),
  });
  assert.throws(() => session.swap(upgraded), { code: 'COURSEWARE_MODULE_PAUSE_REQUIRED' });
  session.pause(); session.swap(upgraded);
  assert.deepEqual(session.observe('math.functions'), { a: 1, family: 'quadratic' });
});

test('manifest policy rejects unsafe hot swap and missing hard dependencies', async () => {
  const runtime = await import(runtimeUrl);
  assert.throws(() => runtime.defineCoursewareModule({ manifest: manifest({ id: 'embed.host', kind: 'embed', entry: './embed.mjs', hotSwap: 'live', commands: [] }) }), { code: 'COURSEWARE_MODULE_HOT_SWAP_INVALID' });
  const session = new runtime.CoursewareRuntime();
  session.register(runtime.defineCoursewareModule({ manifest: manifest({ id: 'instrument.graph', kind: 'instrument', entry: './graph.mjs', hotSwap: 'live', commands: [], dependencies: [{ id: 'math.functions', apiVersion: 1, capabilities: ['observable.function-value'] }] }) }));
  assert.throws(() => session.activate('instrument.graph'), { code: 'COURSEWARE_MODULE_DEPENDENCY_MISSING' });
});

test('modules cannot inspect an undeclared module through the observation boundary', async () => {
  const runtime = await import(runtimeUrl);
  const session = new runtime.CoursewareRuntime();
  session.register(mathModule(runtime));
  session.register(runtime.defineCoursewareModule({
    manifest: manifest({ id: 'instrument.undeclared', kind: 'instrument', entry: './undeclared.mjs', hotSwap: 'live', capabilities: [], commands: [], dependencies: [] }),
    observe: ({ context }) => context.observe('math.functions', { x: 2 }),
  }));
  session.activate(['math.functions', 'instrument.undeclared']);
  assert.throws(() => session.observe('instrument.undeclared'), { code: 'COURSEWARE_MODULE_ACCESS_DENIED' });
});

test('browser loader verifies locked bytes before registering implementation hooks', async () => {
  const runtime = await import(runtimeUrl);
  const entryBytes = Buffer.from('export default { createState: () => ({ coefficient: 1 }) };\n');
  const moduleManifest = manifest({ integrity:`sha256:${crypto.createHash('sha256').update(entryBytes).digest('hex')}` });
  const manifestBytes = Buffer.from(`${JSON.stringify(moduleManifest, null, 2)}\n`);
  const lock = {
    format:'mooyu.courseware-module-lock',schemaVersion:1,runtimeApiVersion:1,roots:['math.functions'],
    modules:[{ manifest:'modules/math/module.json',entry:'modules/math/index.mjs',manifestIntegrity:`sha256:${crypto.createHash('sha256').update(manifestBytes).digest('hex')}`,module:moduleManifest }],
  };
  const assets = new Map([
    ['https://release.example/dist/mooyu-modules.lock.json', Buffer.from(JSON.stringify(lock))],
    ['https://release.example/modules/math/module.json', manifestBytes],
    ['https://release.example/modules/math/index.mjs', entryBytes],
  ]);
  const fetchImpl = async url => assets.has(String(url)) ? new Response(assets.get(String(url)), { status:200 }) : new Response('', { status:404 });
  const registry = new runtime.CoursewareModuleRegistry();
  const loaded = await runtime.loadCoursewareModuleRelease({
    registry,fetchImpl,releaseBaseUrl:'https://release.example/',lockUrl:'dist/mooyu-modules.lock.json',
    importModule:async () => ({ default:{ createState:() => ({ coefficient:1 }),reduce:({ state }) => state } }),
  });
  assert.deepEqual(loaded.loaded, ['math.functions']);
  assert.equal(registry.has('math.functions'), true);

  assets.set('https://release.example/modules/math/index.mjs', Buffer.from('export default {}; // tampered'));
  await assert.rejects(runtime.loadCoursewareModuleRelease({ registry:new runtime.CoursewareModuleRegistry(),fetchImpl,releaseBaseUrl:'https://release.example/',lockUrl:'dist/mooyu-modules.lock.json',importModule:async () => ({ default:{} }) }), { code:'COURSEWARE_MODULE_INTEGRITY_MISMATCH' });
});

test('module lock rejects dependency cycles and module definitions reject undeclared hooks', async () => {
  const runtime = await import(runtimeUrl);
  assert.throws(() => runtime.defineCoursewareModule({ manifest:manifest(),createState:() => ({}),reduce:({ state }) => state,render:() => null }), { code:'COURSEWARE_MODULE_DEFINITION_INVALID' });
  const left = manifest({ id:'domain.left',entry:'./left.mjs',commands:[],dependencies:[{ id:'domain.right',apiVersion:1,capabilities:[] }] });
  const right = manifest({ id:'domain.right',entry:'./right.mjs',commands:[],dependencies:[{ id:'domain.left',apiVersion:1,capabilities:[] }] });
  assert.throws(() => runtime.validateCoursewareModuleLock({
    format:'mooyu.courseware-module-lock',schemaVersion:1,runtimeApiVersion:1,roots:['domain.left'],
    modules:[
      { manifest:'modules/left.json',entry:'modules/left.mjs',manifestIntegrity:digest,module:left },
      { manifest:'modules/right.json',entry:'modules/right.mjs',manifestIntegrity:digest,module:right },
    ],
  }), { code:'COURSEWARE_MODULE_DEPENDENCY_CYCLE' });
});
