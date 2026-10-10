"use strict";
// Generates a self-contained setup.html at the project root by embedding the
// runner template (base64-encoded) into the editable src/setup.html source.
//
// Why base64: the runner template is itself an HTML document containing
// </script> tags. Inlining it as raw text would prematurely close the wizard's
// own <script> block. Base64 uses only [A-Za-z0-9+/=], so it can sit safely
// inside a JS string and is decoded back to UTF-8 in the browser at run time.
//
// Run with: node src/build-setup.js   (or: npm run build:setup)

const fs   = require('fs');
const path = require('path');

function projectRoot() { return path.resolve(__dirname, '..'); }

function main() {
  const runnerPath = path.join(projectRoot(), 'src', 'runner.html');
  const sourcePath = path.join(projectRoot(), 'src', 'setup.html');
  const outPath    = path.join(projectRoot(), 'setup.html');

  if (!fs.existsSync(runnerPath)) { console.error('Missing src/runner.html'); process.exit(1); }
  if (!fs.existsSync(sourcePath)) { console.error('Missing src/setup.html'); process.exit(1); }

  const runnerHtml = fs.readFileSync(runnerPath, 'utf8');
  const b64 = Buffer.from(runnerHtml, 'utf8').toString('base64');

  let setupHtml = fs.readFileSync(sourcePath, 'utf8');
  if (!setupHtml.includes('{{RUNNER_TEMPLATE_B64}}')) {
    console.error('src/setup.html does not contain the {{RUNNER_TEMPLATE_B64}} placeholder.');
    process.exit(1);
  }
  // split/join (not replace) so nothing in the base64 is treated as a regex or
  // a $-replacement pattern.
  setupHtml = setupHtml.split('{{RUNNER_TEMPLATE_B64}}').join(b64);

  fs.writeFileSync(outPath, setupHtml, 'utf8');
  const kb = (Buffer.byteLength(setupHtml, 'utf8') / 1024).toFixed(0);
  console.log('✓ Built self-contained setup.html (' + kb + ' KB, runner template embedded)');
  console.log('  Double-click it, or push it with the repo to GitHub Pages.');
}

main();
