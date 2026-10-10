import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectStaticWebProject } from '../packages/creator-tools/src/index.mjs';

async function loadCatalog() {
  const candidates = [
    new URL('../plugins/gamehub/toolkits/catalog.json', import.meta.url),
    new URL('../toolkits/catalog.json', import.meta.url),
  ];
  for (const candidate of candidates) {
    try { return JSON.parse(await fs.readFile(candidate, 'utf8')); } catch {}
  }
  throw new Error('GameHub creator toolkit catalog is missing. Reinstall or update the GameHub Agent plugin.');
}

const catalog = await loadCatalog();
const [command = 'list', keyOrPath, ...flags] = process.argv.slice(2);
const asJson = flags.includes('--json') || process.argv.includes('--json');
const findToolkit = key => catalog.toolkits.find(toolkit => toolkit.key === key);

function printToolkit(toolkit) {
  if (asJson) return process.stdout.write(`${JSON.stringify(toolkit, null, 2)}\n`);
  console.log(`${toolkit.name} (${toolkit.key}) · ${toolkit.status}`);
  console.log(`适合：${toolkit.bestFor.join('、')}`);
  console.log(`本地源码：${toolkit.sourceFormat} · 产出：${toolkit.output}`);
  console.log(`\n交给 Agent 的任务：\n${toolkit.agentPrompt}`);
  if (toolkit.template) console.log(`\n官方模板：${toolkit.template}`);
  if (toolkit.upstream) console.log(`\n上游：${toolkit.upstream.project} · ${toolkit.upstream.license} · ${toolkit.upstream.source}`);
}

if (command === 'list') {
  if (asJson) process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
  else {
    console.log(`GameHub Agent 创作工具 · ${catalog.version}`);
    for (const toolkit of catalog.toolkits) console.log(`- ${toolkit.key.padEnd(14)} ${toolkit.name} · ${toolkit.status} · ${toolkit.bestFor.join(' / ')}`);
    console.log('\n使用 show <key> 查看交给 Agent 的本地制作任务。');
  }
} else if (command === 'show' || command === 'prompt') {
  const toolkit = findToolkit(keyOrPath);
  if (!toolkit) {
    console.error(`未知工具：${keyOrPath || '(missing)'}`);
    console.error(`可用工具：${catalog.toolkits.map(item => item.key).join(', ')}`);
    process.exitCode = 2;
  } else if (command === 'prompt') process.stdout.write(`${toolkit.agentPrompt}\n`);
  else printToolkit(toolkit);
} else if (command === 'doctor') {
  if (!keyOrPath) {
    console.error('用法：creator-toolkit doctor <本地网页项目目录> [--json]');
    process.exitCode = 2;
  } else {
    const report = await inspectStaticWebProject(path.resolve(keyOrPath));
    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      console.log(`Local Web Project: ${report.ok ? 'PASS' : 'FAIL'} · ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.info} info`);
      for (const finding of report.findings) console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${finding.fix ? `\n  修复：${finding.fix}` : ''}`);
    }
    if (!report.ok) process.exitCode = 1;
  }
} else {
  console.error('用法：creator-toolkit <list|show|prompt|doctor> [key|directory] [--json]');
  process.exitCode = 2;
}
