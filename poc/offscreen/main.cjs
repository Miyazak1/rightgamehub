'use strict';

// This entry is never imported by npm test or by the installed Harness plugin.
// An explicit test controller must opt in and create an isolated profile/control pipe.
const path = require('node:path');
if (process.env.GAMEHUB_OFFSCREEN_EXPERIMENT !== '1' ||
    !path.isAbsolute(process.env.GAMEHUB_OFFSCREEN_PROFILE || '') ||
    !/^\\\\\.\\pipe\\gamehub-offscreen-[a-f0-9-]{36}$/.test(process.env.GAMEHUB_OFFSCREEN_PIPE || '') ||
    !/^[a-f0-9]{64}$/.test(process.env.GAMEHUB_OFFSCREEN_TOKEN || '')) {
  process.stderr.write('Offscreen experiment requires explicit opt-in, an absolute test profile and an authenticated pipe.\n');
  process.exit(2);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const { createOffscreenSession } = require('./session.cjs');
const { createLineReader, createOutputWriter } = require('./transport.cjs');
const { randomUUID } = require('node:crypto');
const { appendFileSync } = require('node:fs');
const { connect } = require('node:net');
app.setPath('userData', process.env.GAMEHUB_OFFSCREEN_PROFILE);
function lifecycle(event, detail) {
  appendFileSync(path.join(process.env.GAMEHUB_OFFSCREEN_PROFILE, 'probe-lifecycle.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), event, detail }) + '\n');
}
lifecycle('entry-loaded', { electron: process.versions.electron });

let session, writer, stopping = false, lastCommand = Date.now();
const control = connect(process.env.GAMEHUB_OFFSCREEN_PIPE);
const started = Date.now();
function stop(reason = 'requested') {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  lifecycle('stop', reason);
  if (session) session.stop(reason);
  const code = ['requested', 'control-closed', 'window-closed'].includes(reason) ? 0 : 2;
  const exitTimer = setTimeout(() => app.exit(code), 250);
  control.end(() => { clearTimeout(exitTimer); app.exit(code); });
}
writer = createOutputWriter(control, () => stop('output-failed'));
const reader = createLineReader(command => {
  lastCommand = Date.now();
  if (!session) {
    if (command.type === 'stop') return stop();
    if (command.type === 'ping') return writer.send({ type: 'pong' });
    throw new Error('Session not created');
  }
  session.accept(command);
}, () => stop('invalid-command'));
const watchdog = setInterval(() => {
  if (Date.now() - lastCommand > 15000) stop('controller-timeout');
  else if (Date.now() - started > 5 * 60 * 1000) stop('experiment-time-limit');
}, 1000);
control.on('data', chunk => reader.push(chunk));
control.on('end', () => stop('control-closed'));
control.on('close', () => stop('control-closed'));
control.on('error', () => stop('control-error'));
function diagnostic(error) {
  const detail = String(error?.stack || error).slice(0, 4096);
  lifecycle('error', detail); process.stderr.write(detail + '\n');
}
process.on('uncaughtException', error => { diagnostic(error); stop('uncaught-error'); });
process.on('unhandledRejection', error => { diagnostic(error); stop('unhandled-error'); });
// The session owns teardown. Do not turn a failure into a successful exit while
// destroy() synchronously emits window-all-closed during failure cleanup.
app.on('window-all-closed', () => {});
control.once('connect', () => {
  control.write(JSON.stringify({ type: 'hello', token: process.env.GAMEHUB_OFFSCREEN_TOKEN }) + '\n');
  app.whenReady().then(async () => {
  if (stopping) return;
  let renderer;
  if (process.env.GAMEHUB_OFFSCREEN_PACKAGE_DIR) {
    const { verifyInstalledPackage } = await import('../../extensions/harness/src/offscreen-install.mjs');
    renderer = await verifyInstalledPackage(process.env.GAMEHUB_OFFSCREEN_PACKAGE_DIR);
  }
  if (stopping) return;
  lifecycle('app-ready');
  session = createOffscreenSession({ BrowserWindow, ipcMain,
    entry: renderer?.entry || path.join(__dirname, 'fixture.html'), preload: path.join(__dirname, 'preload.cjs'),
    ...(renderer ? { allowedFiles: renderer.allowedFiles } : {}),
    partition: 'gamehub-offscreen-' + randomUUID(), emit: message => writer.send(message), onStop: stop,
  });
  writer.send({ type: 'runtime', electron: process.versions.electron, platform: process.platform,
    sample: renderer ? renderer.manifest.id : 'platform-owned-fixture', originalExe: false });
  }).catch(error => { diagnostic(error); stop('startup-failed'); });
});
