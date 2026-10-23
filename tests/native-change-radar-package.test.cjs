const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'native/change-radar/ChangeRadarNode.cs'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts/build-change-radar-native.mjs'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'native/change-radar/app.manifest'), 'utf8');

test('Change Radar native node keeps secrets local and launches a fixed embedded worker', () => {
  assert.match(source, /ProtectedData\.Protect\([^)]*DataProtectionScope\.CurrentUser/);
  assert.match(source, /RESEARCHER_NODE_TOKEN/);
  assert.match(source, /RESEARCHER_DEEPSEEK_API_KEY/);
  assert.match(source, /UseShellExecute = false/);
  assert.match(source, /CreateNoWindow = true/);
  assert.match(source, /EmbeddedRuntime\.WorkerPath/);
  assert.match(source, /\/apps\/change-radar/);
  assert.match(source, /UseShellExecute = true/);
  assert.doesNotMatch(source, /ProcessStartInfo\([^,]+,\s*(nodeToken|apiKey)/);
  assert.match(manifest, /requestedExecutionLevel level="asInvoker"/);
});

test('native build emits the exact GameHub standalone Windows package contract', () => {
  assert.match(build, /packageType: 'windows_standalone_exe'/);
  assert.match(build, /targetKey: 'windows-x64'/);
  assert.match(build, /requiresAdmin: false/);
  assert.match(build, /opensInboundPort: false/);
  assert.match(build, /distributionStatus: 'developer-preview'/);
  assert.match(build, /authenticodeSigned: false/);
  assert.match(build, /bundled-runtime-license-notices/);
  assert.match(build, /\/target:winexe/);
  assert.match(build, /Mooyu\.ChangeRadar\.node\.exe/);
  assert.match(build, /Mooyu\.ChangeRadar\.worker\.mjs/);
});
