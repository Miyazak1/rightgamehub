import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CoursewareToolkitError,
  buildCoursewareProject,
  createCoursewarePreviewServer,
  describeCoursewareProject,
  initializeCoursewareProject,
  inspectCoursewareProject,
  inspectStaticWebProject,
  packageCoursewareProject,
  testCoursewareProject,
} from '../packages/creator-tools/src/index.mjs';

async function loadCatalog() {
  const candidates = [new URL('../plugins/gamehub/toolkits/catalog.json', import.meta.url),new URL('../toolkits/catalog.json', import.meta.url)];
  for (const candidate of candidates) try { return JSON.parse(await fs.readFile(candidate, 'utf8')); } catch {}
  throw new Error('墨鱼工坊创作工具目录缺失，请重新安装或更新墨鱼工坊 Agent 插件。');
}

function parseArguments(values) {
  const positionals = []; const options = {};
  for (let index=0;index<values.length;index+=1) {
    const value = values[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const key = value.slice(2); const next = values[index+1];
    if (next !== undefined && !next.startsWith('--')) { options[key] = next; index += 1; }
    else options[key] = true;
  }
  return { positionals,options };
}

function printDoctor(report,label) {
  console.log(`${label}: ${report.ok ? 'PASS' : 'FAIL'} · ${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.info} info`);
  for (const finding of report.findings) console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}${finding.fix ? `\n  修复：${finding.fix}` : ''}`);
}

function output(value,asJson,formatter) {
  if (asJson) process.stdout.write(`${JSON.stringify(value,null,2)}\n`); else if (formatter) formatter(value); else console.log(value);
}

async function findTemplate(name) {
  if (!['concept-explorer','causal-simulation','algorithm-stepper'].includes(name)) throw new CoursewareToolkitError('COURSEWARE_TEMPLATE_UNKNOWN', `未知课件模板：${name || '(missing)'}`);
  const candidates = [new URL(`../templates/courseware/${name}/`,import.meta.url),new URL(`../plugins/gamehub/templates/courseware/${name}/`,import.meta.url)];
  for (const candidate of candidates) try { if ((await fs.stat(candidate)).isDirectory()) return path.resolve(fileURLToPath(candidate)); } catch {}
  throw new CoursewareToolkitError('COURSEWARE_TEMPLATE_MISSING', `已安装插件缺少 ${name} 模板，请更新墨鱼工坊插件。`);
}

const catalog = await loadCatalog();
const [command='list',...rawArguments] = process.argv.slice(2);
const { positionals,options } = parseArguments(rawArguments);
const asJson = options.json === true;
const keyOrPath = positionals[0];
const findToolkit = key => catalog.toolkits.find(toolkit => toolkit.key === key);

function printToolkit(toolkit) {
  if (asJson) return process.stdout.write(`${JSON.stringify(toolkit,null,2)}\n`);
  console.log(`${toolkit.name} (${toolkit.key}) · ${toolkit.status}`);
  console.log(`适合：${toolkit.bestFor.join('、')}`);
  console.log(`本地源码：${toolkit.sourceFormat} · 产出：${toolkit.output}`);
  console.log(`\n交给 Agent 的任务：\n${toolkit.agentPrompt}`);
  if (toolkit.template) console.log(`\n官方模板：${toolkit.template}`);
  if (toolkit.upstream) console.log(`\n上游：${toolkit.upstream.project} · ${toolkit.upstream.license} · ${toolkit.upstream.source}`);
}

try {
  if (command === 'list') {
    if (asJson) process.stdout.write(`${JSON.stringify(catalog,null,2)}\n`);
    else {
      console.log(`墨鱼工坊 Agent 创作工具 · ${catalog.version}`);
      for (const toolkit of catalog.toolkits) console.log(`- ${toolkit.key.padEnd(22)} ${toolkit.name} · ${toolkit.status} · ${toolkit.bestFor.join(' / ')}`);
      console.log('\n使用 show <key> 查看任务；课件使用 init/inspect/doctor/test/preview/build/package。');
    }
  } else if (command === 'show' || command === 'prompt') {
    const toolkit = findToolkit(keyOrPath);
    if (!toolkit) throw new CoursewareToolkitError('TOOLKIT_UNKNOWN', `未知工具：${keyOrPath || '(missing)'}`);
    if (command === 'prompt') process.stdout.write(`${toolkit.agentPrompt}\n`); else printToolkit(toolkit);
  } else if (command === 'init') {
    const [template,target] = positionals;
    if (!template || !target) throw new CoursewareToolkitError('COURSEWARE_INIT_USAGE', '用法：creator-toolkit init <concept-explorer|causal-simulation|algorithm-stepper> <新目录> [--json]');
    const result = await initializeCoursewareProject({ templateRoot:await findTemplate(template),targetRoot:target });
    output(result,asJson,value => console.log(`已从 ${value.template} 创建 ${value.target}\n下一步：creator-toolkit doctor "${value.target}"`));
  } else if (command === 'inspect') {
    if (!keyOrPath) throw new CoursewareToolkitError('COURSEWARE_INSPECT_USAGE', '用法：creator-toolkit inspect <课件目录> [--json]');
    const result = await describeCoursewareProject(path.resolve(keyOrPath));
    output(result,asJson,value => console.log(`${value.id} · ${value.ok ? 'READY' : 'NEEDS FIX'} · ${value.counts.scenes} scene · ${value.counts.checkpoints} checkpoint · ${value.totalBytes} bytes\nDigest: ${value.projectDigest}`));
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'doctor') {
    if (!keyOrPath) throw new CoursewareToolkitError('DOCTOR_USAGE', '用法：creator-toolkit doctor <本地项目目录> [--json]');
    const target = path.resolve(keyOrPath); const isCourseware = await fs.access(path.join(target,'mooyu-courseware.json')).then(() => true,() => false);
    const report = isCourseware ? await inspectCoursewareProject(target) : await inspectStaticWebProject(target);
    output(report,asJson,value => printDoctor(value,isCourseware ? 'Interactive Courseware' : 'Local Web Project'));
    if (!report.ok) process.exitCode = 1;
  } else if (command === 'test') {
    if (!keyOrPath) throw new CoursewareToolkitError('COURSEWARE_TEST_USAGE', '用法：creator-toolkit test <课件目录> [--browser-module <path>] [--json]');
    if (options['browser-module'] === true) throw new CoursewareToolkitError('COURSEWARE_TEST_USAGE', '--browser-module 后必须提供已安装模块的绝对路径或包名。');
    const result = await testCoursewareProject(path.resolve(keyOrPath),{ browserModule:options['browser-module'] });
    output(result,asJson,value => console.log(`Browser journeys: PASS · ${value.journeys.length} journey · ${value.journeys.reduce((sum,item) => sum+item.steps,0)} steps`));
  } else if (command === 'preview') {
    if (!keyOrPath) throw new CoursewareToolkitError('COURSEWARE_PREVIEW_USAGE', '用法：creator-toolkit preview <课件目录> [--port <端口>]');
    if (options.port === true) throw new CoursewareToolkitError('COURSEWARE_PREVIEW_PORT_INVALID', '--port 后必须提供端口号。');
    const parsedPort = options.port === undefined ? 4173 : Number(options.port);
    if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) throw new CoursewareToolkitError('COURSEWARE_PREVIEW_PORT_INVALID', '预览端口必须是 0 到 65535 的整数。');
    const preview = await createCoursewarePreviewServer(path.resolve(keyOrPath),{ port:parsedPort });
    console.log(`MOOYU.FUN courseware preview: ${preview.url}\n按 Ctrl+C 停止。`);
    const close = async () => { await preview.close(); process.exit(0); };
    process.once('SIGINT',close); process.once('SIGTERM',close);
  } else if (command === 'build') {
    if (!keyOrPath) throw new CoursewareToolkitError('COURSEWARE_BUILD_USAGE', '用法：creator-toolkit build <课件目录> [--output <空目录>] [--json]');
    if (options.output === true) throw new CoursewareToolkitError('COURSEWARE_BUILD_USAGE', '--output 后必须提供空目录。');
    const result = await buildCoursewareProject(path.resolve(keyOrPath),{ outputDirectory:typeof options.output === 'string' ? path.resolve(options.output) : undefined });
    output(result,asJson,value => console.log(`Build ${value.reused ? 'reused' : 'created'}: ${value.output}\n${value.files.length} files · ${value.totalBytes} bytes · ${value.projectDigest}`));
  } else if (command === 'package') {
    if (!keyOrPath) throw new CoursewareToolkitError('COURSEWARE_PACKAGE_USAGE', '用法：creator-toolkit package <课件目录> [--output <zip>] [--json]');
    if (options.output === true) throw new CoursewareToolkitError('COURSEWARE_PACKAGE_USAGE', '--output 后必须提供 ZIP 路径。');
    const result = await packageCoursewareProject(path.resolve(keyOrPath),{ outputPath:typeof options.output === 'string' ? path.resolve(options.output) : undefined });
    output(result,asJson,value => console.log(`Package ${value.reused ? 'reused' : 'created'}: ${value.path}\n${value.artifactBytes} bytes · SHA-256 ${value.artifactSha256}`));
  } else throw new CoursewareToolkitError('CLI_USAGE', '用法：creator-toolkit <list|show|prompt|init|inspect|doctor|test|preview|build|package> [...args]');
} catch (error) {
  const payload = { ok:false,error:{ code:error.code ?? 'CREATOR_TOOLKIT_FAILED',message:error.message,details:error.details ?? undefined } };
  if (asJson) process.stderr.write(`${JSON.stringify(payload,null,2)}\n`); else console.error(`${payload.error.code}: ${payload.error.message}`);
  process.exitCode = error.code?.endsWith('_USAGE') || error.code === 'CLI_USAGE' ? 2 : 1;
}
