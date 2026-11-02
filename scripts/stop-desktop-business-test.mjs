import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, '.runtime/desktop-business-test/latest.json');
const report = JSON.parse(await fs.readFile(file, 'utf8'));
if (!/^mooyu-business-check-\d+$/.test(report.project) || !/^(?:npipe:\/\/\/\/\.\/pipe\/|unix:\/\/\/)/.test(report.dockerEndpoint ?? '') ||
  report.productionConnected !== false || !report.keptRunning) throw Error('No verified local test project to stop');
const result = spawnSync('docker', ['--host', report.dockerEndpoint, 'compose', '-p', report.project,
  '--env-file', report.envFile, '-f', path.join(report.source, 'deploy/compose.desktop-business-test.yml'), 'down', '--volumes', '--remove-orphans'],
  { cwd: root, windowsHide: true, encoding: 'utf8' });
if (result.status !== 0) throw Error('Failed to stop the isolated local test project');
report.keptRunning = false; report.cleanedUp = true;
await fs.writeFile(file, JSON.stringify(report, null, 2));
await fs.writeFile(path.join(report.directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ project: report.project, cleanedUp: true, productionConnected: false }));
