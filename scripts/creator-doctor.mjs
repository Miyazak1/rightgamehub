import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectMultiplayerProject } from '../packages/creator-tools/src/index.mjs';
import { validateWebZip } from '../apps/api/src/web-zip-validator.mjs';

const args = process.argv.slice(2);
const target = args.find(value => !value.startsWith('--')) ?? 'templates/multiplayer-turn-based';
const outputIndex = args.indexOf('--output');
let report = await inspectMultiplayerProject(target);
const zipIndex = args.indexOf('--web-zip');
if (zipIndex >= 0 && args[zipIndex + 1]) {
  const output = await fs.mkdtemp(path.join(os.tmpdir(),'gamehub-creator-doctor-'));
  try {
    const validation = await validateWebZip(path.resolve(args[zipIndex + 1]),path.join(output,'expanded'));
    report = { ...report,findings:[...report.findings,{severity:'info',code:'WEB_ZIP_VALID',message:`Web ZIP 通过生产 Validator：${validation.fileCount} 个文件，${validation.totalBytes} 字节。`}],summary:{...report.summary,info:report.summary.info+1} };
  } catch (error) {
    report = { ...report,ok:false,findings:[...report.findings,{severity:'error',code:error.code ?? 'WEB_ZIP_INVALID',message:`Web ZIP 校验失败：${error.message}`}],summary:{...report.summary,errors:report.summary.errors+1} };
  } finally { await fs.rm(output,{recursive:true,force:true}); }
}
const encoded = `${JSON.stringify(report,null,2)}\n`;
if (outputIndex >= 0 && args[outputIndex + 1]) {
  const output = path.resolve(args[outputIndex + 1]);
  await fs.mkdir(path.dirname(output),{ recursive:true }); await fs.writeFile(output,encoded);
}
if (args.includes('--json')) process.stdout.write(encoded);
else {
  console.log(`Creator Doctor: ${report.ok ? 'PASS' : 'FAIL'} · ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.info} info`);
  for (const finding of report.findings) console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${finding.fix ? `\n  修复：${finding.fix}` : ''}`);
}
if (!report.ok) process.exitCode = 1;
