const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'packages/platform-client/src/App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'packages/platform-client/src/styles.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'packages/platform-client/src/i18n.mjs'), 'utf8');

test('native release upload uses a first-class responsive package picker', () => {
  assert.match(app, /function ReleaseTargetPicker/);
  assert.match(app, /className="release-target-picker"/);
  assert.match(app, /upload-page--native/);
  assert.match(app, /className="native-package-note"/);
  assert.doesNotMatch(app, /<select value=\{targetKey\}/);
  assert.match(i18n, /creator\.upload\.windowsTargetHint/);
  assert.match(i18n, /creator\.upload\.windowsTrustTitle/);
  assert.match(css, /\.release-target-picker/);
  assert.match(css, /\.native-package-note/);
  assert.match(css, /@media\(max-width:560px\)[^{]*\{/);
  assert.match(css, /\.upload-page \.check-row input\{[^}]*appearance:none/);
});
