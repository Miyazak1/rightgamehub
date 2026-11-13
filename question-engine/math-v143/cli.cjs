'use strict';
const fs = require('node:fs');
const runtime = require('./runtime.cjs');

async function main() {
  const command = process.argv[2] || 'status';
  if (command === 'status') return runtime.status();
  if (command === 'catalog') return runtime.catalog();
  if (command === 'preview') {
    const supplied = process.argv[3];
    if (!supplied) throw Error('usage: preview <input.json>');
    return runtime.generatePreview(JSON.parse(fs.readFileSync(supplied, 'utf8')));
  }
  throw Error('math_lab_command_invalid');
}
main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
