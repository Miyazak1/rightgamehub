import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectCreatorPackage } from '../packages/creator-tools/src/index.mjs';

const args = process.argv.slice(2);
const target = args.find(value => !value.startsWith('--')) ?? 'templates/creator-bingo';
const outputIndex = args.indexOf('--output');
const report = await inspectCreatorPackage(target);
const encoded = `${JSON.stringify(report,null,2)}\n`;

if (outputIndex >= 0 && args[outputIndex + 1]) {
  const output = path.resolve(args[outputIndex + 1]);
  await fs.mkdir(path.dirname(output),{ recursive:true });
  await fs.writeFile(output,encoded);
}

if (args.includes('--json')) process.stdout.write(encoded);
else {
  console.log(`Creator Package: ${report.ok ? 'PASS' : 'FAIL'} · ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.info} info`);
  for (const finding of report.findings) console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${finding.fix ? `\n  修复：${finding.fix}` : ''}`);
}
if (!report.ok) process.exitCode = 1;
