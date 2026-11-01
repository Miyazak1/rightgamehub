const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { restoredWindowState, createWindowStateStore, titleBarPalette, validateAction, windowShortcut } = require('../../apps/desktop/electron/window-state.cjs');
const primary = { x: 0, y: 0, width: 1440, height: 860 };

test('window placement recovers from a disconnected monitor without losing the title area', () => {
  const result = restoredWindowState({ bounds: { x: 2800, y: -200, width: 1800, height: 1200 }, maximized: true }, [primary]);
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 1440, height: 860 });
  assert.equal(result.maximized, true);
  const secondary = { x: -1280, y: 0, width: 1280, height: 800 };
  const saved = { bounds: { x: -1200, y: 20, width: 1100, height: 720 }, maximized: false };
  assert.deepEqual(restoredWindowState(saved, [primary, secondary]).bounds, saved.bounds);
});
test('small displays and corrupted state cannot create an inaccessible oversized window', () => {
  const small = { x: 0, y: 0, width: 800, height: 600 };
  const state = restoredWindowState({ bounds: { x: 'invalid', y: 1, width: -5, height: Infinity } }, [small]);
  assert.deepEqual(state.bounds, { x: 0, y: 0, width: 800, height: 600 });
  assert.equal(state.minWidth, 800); assert.equal(state.minHeight, 600);
});
test('window state persists independently and malformed local records are recoverable', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mooyu-window-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createWindowStateStore(directory);
  assert.equal(store.read(), null);
  const value = { bounds: { x: 30, y: 40, width: 1100, height: 720 }, maximized: false };
  assert.equal(store.write(value), true); assert.deepEqual(store.read(), value);
  await fs.writeFile(path.join(directory, 'window-state.json'), '{broken');
  assert.equal(store.read(), null);
});
test('window IPC accepts only fixed theme and action names', () => {
  for (const mode of ['dark', 'light', 'high-contrast']) assert.equal(titleBarPalette(mode).height, 62);
  for (const mode of ['__proto__', 'constructor', '#fff', {}, null]) assert.throws(() => titleBarPalette(mode), /DESKTOP_WINDOW_THEME_INVALID/);
  for (const action of ['back', 'forward', 'reload', 'toggle-fullscreen', 'quit']) assert.equal(validateAction(action), action);
  for (const action of ['open-file', 'run-command', 'navigate-url', {}, null]) assert.throws(() => validateAction(action), /DESKTOP_WINDOW_ACTION_INVALID/);
});
test('desktop shortcuts leave ordinary typing and modified unrelated keys alone', () => {
  const key = (value, flags = {}) => windowShortcut({ type: 'keyDown', key: value, ...flags });
  assert.equal(key('ArrowLeft', { alt: true }), 'back'); assert.equal(key('ArrowRight', { alt: true }), 'forward');
  assert.equal(key('r', { control: true }), 'reload'); assert.equal(key('Q', { control: true }), 'quit');
  assert.equal(key('F11'), 'toggle-fullscreen');
  assert.equal(key('r'), null); assert.equal(key('ArrowLeft'), null);
  assert.equal(key('R', { control: true, shift: true }), null);
  assert.equal(key('F11', { isAutoRepeat: true }), null);
});
