'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const manifest = require('./integration.json');
const { runtimeDirectory, verifyArchive, verifyRuntime } = require('./install.cjs');

function status() {
  verifyArchive();
  const installed = fs.existsSync(runtimeDirectory);
  const verification = installed ? verifyRuntime() : null;
  return {
    schemaVersion: manifest.schemaVersion, applicationVersion: manifest.applicationVersion,
    archiveSha256: manifest.archiveSha256, installed, verification,
    cellCount: manifest.cells, scopeCount: manifest.scopes,
    boundary: 'verified_generation_requires_host_publication', providerCalls: 0, costUsd: 0,
    studentPublicationAllowed: false
  };
}

function catalog() {
  // Keep all archive/runtime integrity gates, but avoid loading historical
  // question inventories into the API just to display availability metadata.
  const verified = status();
  if (!verified.installed) throw Error('math_lab_runtime_not_installed');
  const bytes = fs.readFileSync(path.join(__dirname, 'catalog-summary.json'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.catalogSummarySha256) {
    throw Error('math_lab_catalog_summary_digest_mismatch');
  }
  const summary = JSON.parse(bytes);
  if (summary.schemaVersion !== 'math-lab-catalog-summary-v1'
    || summary.applicationVersion !== manifest.applicationVersion
    || summary.releaseManifestSha256 !== manifest.releaseManifestSha256
    || summary.cells.length !== manifest.cells
    || summary.cells.reduce((sum, cell) => sum + cell.scopes.length, 0) !== manifest.scopes) {
    throw Error('math_lab_catalog_summary_invalid');
  }
  return { ...verified, cells: summary.cells };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['cellId', 'scopeId', 'seed'].includes(key))
    || typeof input.cellId !== 'string' || input.cellId.length > 80
    || typeof input.scopeId !== 'string' || input.scopeId.length > 240
    || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 2147483646) {
    throw Error('math_lab_preview_input_invalid');
  }
  const cell = catalog().cells.find(item => item.id === input.cellId);
  if (!cell || !cell.scopes.some(scope => scope.id === input.scopeId)) throw Error('math_lab_scope_invalid');
  return { cellId: input.cellId, scopeId: input.scopeId, seed: input.seed };
}

let active = false;
function runPreview(input, { timeoutMs = 120000 } = {}) {
  const validated = validateInput(input);
  if (active) return Promise.reject(Error('math_lab_preview_busy'));
  active = true;
  return new Promise((resolve, reject) => {
    // Do not inherit Provider keys, DATABASE_URL, NODE_OPTIONS, preload hooks or NODE_PATH.
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    env.NODE_ENV = 'test';
    const child = fork(path.join(__dirname, 'worker.cjs'), [], {
      cwd: runtimeDirectory, env, execArgv: ['--max-old-space-size=512'],
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; active = false; clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(Error('math_lab_preview_timeout')), timeoutMs);
    child.stderr.resume();
    child.once('message', message => message.ok ? finish(null, message.value) : finish(Error(message.error)));
    child.once('error', error => finish(error));
    child.once('exit', () => finish(Error('math_lab_preview_worker_failed')));
    child.send(validated);
  });
}
let pending = 0;
let queue = Promise.resolve();
function generatePreview(input, options) {
  validateInput(input);
  if (pending >= 4) return Promise.reject(Error('math_lab_preview_busy'));
  pending++;
  const result = queue.then(() => runPreview(input, options));
  queue = result.catch(() => undefined);
  return result.finally(() => { pending--; });
}
module.exports = { status, catalog, validateInput, generateVerifiedQuestion: generatePreview, generatePreview };
