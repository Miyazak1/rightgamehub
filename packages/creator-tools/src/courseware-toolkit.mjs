import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { crc32, deflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const managedDirectory = '.mooyu';
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.gif', 'image/gif'], ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
]);

export class CoursewareToolkitError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = 'CoursewareToolkitError'; this.code = code; this.details = details;
  }
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeRelativePath = value => typeof value === 'string' && value.length > 0 && value.length <= 255
  && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function assertNoSymlinkAncestors(target) {
  const resolved = path.resolve(target); const parsed = path.parse(resolved); let current = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part);
    const stat = await fs.lstat(current).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new CoursewareToolkitError('COURSEWARE_OUTPUT_SYMLINK_FORBIDDEN', `输出路径不能经过符号链接：${current}`);
    if (!stat) break;
  }
}

async function fileRecord(root, relative) {
  if (!safeRelativePath(relative)) throw new CoursewareToolkitError('COURSEWARE_PATH_INVALID', `不安全的课程包路径：${relative}`);
  const absolute = path.join(root, ...relative.split('/')); const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CoursewareToolkitError('COURSEWARE_FILE_INVALID', `${relative} 必须是普通文件。`);
  const bytes = await fs.readFile(absolute);
  return { relative, absolute, bytes, size:bytes.length, sha256:sha256(bytes) };
}

export async function loadCoursewareInventory(root) {
  const projectRoot = path.resolve(root);
  const manifest = await readJson(path.join(projectRoot, 'mooyu-courseware.json'));
  const fixed = ['mooyu-courseware.json', manifest.course, manifest.evidence, manifest.tests];
  const records = [];
  for (const relative of fixed) records.push(await fileRecord(projectRoot, relative));
  const distRoot = path.join(projectRoot, 'dist');
  const walk = async (directory, prefix = 'dist') => {
    for (const entry of (await fs.readdir(directory, { withFileTypes:true })).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new CoursewareToolkitError('COURSEWARE_SYMLINK_FORBIDDEN', `${relative} 是符号链接。`);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) records.push(await fileRecord(projectRoot, relative));
      else throw new CoursewareToolkitError('COURSEWARE_FILE_INVALID', `${relative} 不是普通文件。`);
      if (records.length > 2_000) throw new CoursewareToolkitError('COURSEWARE_FILE_COUNT_EXCEEDED', '课程包文件超过 2000 个。');
    }
  };
  await walk(distRoot);
  const deduplicated = [...new Map(records.map(record => [record.relative, record])).values()].sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
  const totalBytes = deduplicated.reduce((sum, record) => sum + record.size, 0);
  if (totalBytes > 128 * 1024 * 1024) throw new CoursewareToolkitError('COURSEWARE_PROJECT_TOO_LARGE', '课程包超过 128 MiB。');
  const digest = sha256(Buffer.concat(deduplicated.flatMap(record => [Buffer.from(record.relative), Buffer.from([0]), record.bytes, Buffer.from([0])])));
  return { root:projectRoot,manifest,files:deduplicated,totalBytes,projectDigest:digest };
}

export async function describeCoursewareProject(root, inspect) {
  const report = await inspect(root); let inventory = null;
  try { inventory = await loadCoursewareInventory(root); } catch {}
  if (!inventory) return { kind:'interactive-courseware',root:path.resolve(root),ok:false,report };
  const course = await readJson(path.join(inventory.root, ...inventory.manifest.course.split('/')));
  const evidence = await readJson(path.join(inventory.root, ...inventory.manifest.evidence.split('/')));
  const journeys = await readJson(path.join(inventory.root, ...inventory.manifest.tests.split('/')));
  return {
    kind:'interactive-courseware',root:inventory.root,ok:report.ok,id:inventory.manifest.id,title:inventory.manifest.title,
    defaultLocale:inventory.manifest.defaultLocale,locales:inventory.manifest.locales,subjects:inventory.manifest.subjects,
    counts:{ objectives:course.objectives?.length ?? 0,scenes:course.scenes?.length ?? 0,checkpoints:course.checkpoints?.length ?? 0,sources:evidence.sources?.length ?? 0,claims:evidence.claims?.length ?? 0,journeys:journeys.journeys?.length ?? 0,files:inventory.files.length },
    totalBytes:inventory.totalBytes,projectDigest:inventory.projectDigest,report,
  };
}

export async function initializeCoursewareProject({ templateRoot, targetRoot }) {
  const source = path.resolve(templateRoot); const target = path.resolve(targetRoot);
  const sourceStat = await fs.lstat(source).catch(() => null);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new CoursewareToolkitError('COURSEWARE_TEMPLATE_INVALID', '课件模板目录不可用。');
  await assertNoSymlinkAncestors(path.dirname(target));
  const targetStat = await fs.lstat(target).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (targetStat) throw new CoursewareToolkitError('COURSEWARE_TARGET_EXISTS', '目标目录已经存在；为避免覆盖，本地初始化已停止。');
  await fs.cp(source, target, { recursive:true,errorOnExist:true,force:false });
  const manifest = await readJson(path.join(target, 'mooyu-courseware.json'));
  return { action:'created',template:path.basename(source),target,id:manifest.id };
}

async function ensureOutputDirectory(directory) {
  await assertNoSymlinkAncestors(directory);
  const stat = await fs.lstat(directory).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) { await fs.mkdir(directory, { recursive:true }); return; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CoursewareToolkitError('COURSEWARE_OUTPUT_INVALID', '输出位置必须是普通目录。');
  if ((await fs.readdir(directory)).length) throw new CoursewareToolkitError('COURSEWARE_OUTPUT_NOT_EMPTY', '自定义输出目录必须为空，避免覆盖现有文件。');
}

export async function buildCoursewareProject(root, { inspect, outputDirectory } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError('COURSEWARE_DOCTOR_FAILED', 'Doctor 未通过，不能构建课件。', report);
  const inventory = await loadCoursewareInventory(root);
  const defaultOutput = path.join(inventory.root, managedDirectory, 'build', inventory.projectDigest);
  const output = path.resolve(outputDirectory ?? defaultOutput);
  const existingReport = await readJson(path.join(output, 'build-report.json')).catch(() => null);
  if (!outputDirectory && existingReport?.projectDigest === inventory.projectDigest) return { ...existingReport,output,reused:true };
  await ensureOutputDirectory(output);
  for (const file of inventory.files) {
    const destination = path.join(output, ...file.relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive:true }); await fs.copyFile(file.absolute, destination);
  }
  const buildReport = {
    format:'mooyu.courseware-build',version:1,coursewareId:inventory.manifest.id,projectDigest:inventory.projectDigest,
    files:inventory.files.map(({ relative,size,sha256:hash }) => ({ path:relative,bytes:size,sha256:hash })),totalBytes:inventory.totalBytes,
  };
  await fs.writeFile(path.join(output, 'build-report.json'), `${JSON.stringify(buildReport, null, 2)}\n`, { flag:'wx' });
  return { ...buildReport,output,reused:false };
}

function zipBuffer(records) {
  const files = []; const central = []; let offset = 0;
  for (const record of records) {
    const name = Buffer.from(record.relative, 'utf8'); const packed = deflateRawSync(record.bytes, { level:9 }); const checksum = crc32(record.bytes); const flags = 0x800;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(flags,6); local.writeUInt16LE(8,8); local.writeUInt16LE(0,10); local.writeUInt16LE(0x21,12); local.writeUInt32LE(checksum,14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(record.bytes.length,22); local.writeUInt16LE(name.length,26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314,4); header.writeUInt16LE(20,6); header.writeUInt16LE(flags,8); header.writeUInt16LE(8,10); header.writeUInt16LE(0,12); header.writeUInt16LE(0x21,14); header.writeUInt32LE(checksum,16); header.writeUInt32LE(packed.length,20); header.writeUInt32LE(record.bytes.length,24); header.writeUInt16LE(name.length,28); header.writeUInt32LE((0x81a4 << 16) >>> 0,38); header.writeUInt32LE(offset,42);
    files.push(local,name,packed); central.push(header,name); offset += local.length + name.length + packed.length;
  }
  const table = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(records.length,8); end.writeUInt16LE(records.length,10); end.writeUInt32LE(table.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,table,end]);
}

export async function packageCoursewareProject(root, { inspect, outputPath } = {}) {
  const report = await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError('COURSEWARE_DOCTOR_FAILED', 'Doctor 未通过，不能打包课件。', report);
  const inventory = await loadCoursewareInventory(root); const bytes = zipBuffer(inventory.files); const artifactSha256 = sha256(bytes);
  const destination = path.resolve(outputPath ?? path.join(inventory.root, managedDirectory, 'packages', `${inventory.manifest.id}-${inventory.projectDigest.slice(0,12)}.zip`));
  if (path.extname(destination).toLowerCase() !== '.zip') throw new CoursewareToolkitError('COURSEWARE_PACKAGE_EXTENSION_INVALID', '课件包输出必须使用 .zip 扩展名。');
  await assertNoSymlinkAncestors(destination);
  const destinationStat = await fs.lstat(destination).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (destinationStat?.isSymbolicLink() || (destinationStat && !destinationStat.isFile())) throw new CoursewareToolkitError('COURSEWARE_PACKAGE_PATH_INVALID', '课件包输出必须是普通 ZIP 文件，不能是符号链接。');
  const current = destinationStat ? await fs.readFile(destination) : null;
  if (current) {
    if (sha256(current) !== artifactSha256) throw new CoursewareToolkitError('COURSEWARE_PACKAGE_EXISTS', '目标包已存在且内容不同；不会覆盖。');
    return { format:'mooyu.courseware-package',version:1,coursewareId:inventory.manifest.id,projectDigest:inventory.projectDigest,artifactSha256,artifactBytes:bytes.length,path:destination,reused:true };
  }
  await fs.mkdir(path.dirname(destination), { recursive:true }); await fs.writeFile(destination, bytes, { flag:'wx' });
  return { format:'mooyu.courseware-package',version:1,coursewareId:inventory.manifest.id,projectDigest:inventory.projectDigest,artifactSha256,artifactBytes:bytes.length,path:destination,reused:false };
}

const submissionStatePath = root => path.join(path.resolve(root), managedDirectory, 'submission.json');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const localized = (value,locale) => value?.[locale] ?? value?.['zh-CN'] ?? value?.en ?? Object.values(value ?? {})[0] ?? '';
const stableKey = value => `courseware-${sha256(Buffer.from(JSON.stringify(value))).slice(0,48)}`;

async function readSubmissionState(root, expectedOrigin) {
  const state = await readJson(submissionStatePath(root)).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!state) return null;
  if (state.format !== 'mooyu.courseware-submission' || state.version !== 1 || !uuidPattern.test(state.workId ?? '') || (state.uploadId !== null && !uuidPattern.test(state.uploadId ?? '')) || !/^[a-f0-9]{64}$/u.test(state.projectDigest ?? '')) throw new CoursewareToolkitError('COURSEWARE_SUBMISSION_STATE_INVALID','本地课件提交状态无效；为避免覆盖远端作品，操作已停止。');
  if (state.platformOrigin !== expectedOrigin) throw new CoursewareToolkitError('COURSEWARE_PLATFORM_MISMATCH',`该课件已关联 ${state.platformOrigin}，不会静默操作另一个平台。`);
  return state;
}

async function writeSubmissionState(root,state) {
  const target = submissionStatePath(root); await assertNoSymlinkAncestors(target); await fs.mkdir(path.dirname(target),{recursive:true});
  const current = await fs.lstat(target).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (current?.isSymbolicLink() || (current && !current.isFile())) throw new CoursewareToolkitError('COURSEWARE_SUBMISSION_STATE_INVALID','课件提交状态必须是普通文件。');
  await fs.writeFile(target,`${JSON.stringify(state,null,2)}\n`,{encoding:'utf8',mode:0o600,flag:current?'w':'wx'});
}

const normalizePlatformOrigin = value => {
  let origin; try { origin = new URL(value).origin; } catch { throw new CoursewareToolkitError('COURSEWARE_PLATFORM_INVALID','提交平台地址无效。'); }
  if (!/^https:/u.test(origin) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)) throw new CoursewareToolkitError('COURSEWARE_PLATFORM_INVALID','平台地址必须使用 HTTPS，或本机 loopback HTTP。');
  return origin;
};

export async function submitCoursewareProject(root,{inspect,apiClient,platformUrl,releaseLabel='courseware-draft'}={}) {
  if (!apiClient?.createWork || !apiClient?.createUpload || !apiClient?.createUploadGrant || !apiClient?.uploadContentBytes || !apiClient?.completeUpload || !apiClient?.getUpload) throw new CoursewareToolkitError('COURSEWARE_API_REQUIRED','平台 API 客户端缺少课件提交流程。');
  const origin=normalizePlatformOrigin(platformUrl),inventory=await loadCoursewareInventory(root),report=await inspect(root);
  if (!report.ok) throw new CoursewareToolkitError('COURSEWARE_DOCTOR_FAILED','Doctor 未通过，不能提交课件。',report);
  const previous=await readSubmissionState(inventory.root,origin);
  if (previous?.uploadId && previous.projectDigest===inventory.projectDigest) {
    const remote=(await apiClient.getUpload(previous.uploadId)).data;
    if (!['failed','expired'].includes(remote.state)) return { action:'unchanged',workId:previous.workId,upload:remote,projectDigest:inventory.projectDigest,state:previous };
  }
  let workId=previous?.workId;
  if (!workId) {
    const locale=inventory.manifest.defaultLocale,title=localized(inventory.manifest.title,locale),description=localized(inventory.manifest.summary,locale);
    const work=(await apiClient.createWork({ title:title.slice(0,120),description:description.slice(0,4000),instructions:'',kind:'courseware',estimatedMinutes:10,tags:(inventory.manifest.subjects??[]).slice(0,6).map(value=>String(value).slice(0,20)),agentLabel:'Agent-native Courseware',attributionKind:'publisher' },{headers:{'Idempotency-Key':stableKey({origin,coursewareId:inventory.manifest.id,projectDigest:inventory.projectDigest})}})).data;
    workId=work.id;
    await writeSubmissionState(inventory.root,{format:'mooyu.courseware-submission',version:1,platformOrigin:origin,workId,uploadId:null,projectDigest:inventory.projectDigest,artifactSha256:null,updatedAt:new Date().toISOString()});
  }
  const packaged=await packageCoursewareProject(inventory.root,{inspect}); const bytes=await fs.readFile(packaged.path);
  const normalizedReleaseLabel=String(releaseLabel??'').trim().slice(0,64)||'courseware-draft';
  const upload=(await apiClient.createUpload(workId,{fileName:path.basename(packaged.path),declaredBytes:String(bytes.length),sha256:packaged.artifactSha256,releaseLabel:normalizedReleaseLabel,autoPublish:false,targetKey:'web',packageType:'web_zip'},{headers:{'Idempotency-Key':stableKey({workId,projectDigest:inventory.projectDigest,artifactSha256:packaged.artifactSha256})}})).data;
  const state={format:'mooyu.courseware-submission',version:1,platformOrigin:origin,workId,uploadId:upload.id,projectDigest:inventory.projectDigest,artifactSha256:packaged.artifactSha256,updatedAt:new Date().toISOString()};
  await writeSubmissionState(inventory.root,state);
  const grant=(await apiClient.createUploadGrant(upload.id)).data;
  await apiClient.uploadContentBytes(upload.id,bytes,grant.token);
  const queued=(await apiClient.completeUpload(upload.id,{headers:{'Idempotency-Key':stableKey({uploadId:upload.id,action:'complete'})}})).data;
  return { action:previous?'updated':'created',workId,upload:queued,projectDigest:inventory.projectDigest,state };
}

export async function coursewareSubmissionStatus(root,{apiClient,platformUrl}={}) {
  if (!apiClient?.getUpload) throw new CoursewareToolkitError('COURSEWARE_API_REQUIRED','平台 API 客户端缺少课件状态查询能力。');
  const origin=normalizePlatformOrigin(platformUrl),state=await readSubmissionState(root,origin);
  if (!state) throw new CoursewareToolkitError('COURSEWARE_NOT_SUBMITTED','该课件尚未提交。');
  if (!state.uploadId) throw new CoursewareToolkitError('COURSEWARE_UPLOAD_NOT_CREATED','作品已经建立，但课件上传任务尚未建立；请重新执行 submit。');
  const upload=(await apiClient.getUpload(state.uploadId)).data;
  return { state,upload,ready:upload.state==='succeeded'&&upload.publicationOutcome==='draft'&&uuidPattern.test(upload.releaseId??'') };
}

export async function publishCoursewareSubmission(root,{apiClient,platformUrl}={}) {
  if (!apiClient?.publishWorkRelease || !apiClient?.listCreatorWorks) throw new CoursewareToolkitError('COURSEWARE_API_REQUIRED','平台 API 客户端缺少课件发布流程。');
  const status=await coursewareSubmissionStatus(root,{apiClient,platformUrl});
  if (!status.ready) throw new CoursewareToolkitError('COURSEWARE_RELEASE_NOT_READY',status.upload.state==='failed'?`平台验证失败：${status.upload.errorCode??'UNKNOWN'}`:'只有已通过平台验证的私有 Release 才能发布。',status.upload);
  const work=(await apiClient.listCreatorWorks()).data.find(item=>item.id===status.state.workId);
  if (!work) throw new CoursewareToolkitError('COURSEWARE_WORK_NOT_FOUND','平台中找不到本地状态关联的课件作品。');
  const published=(await apiClient.publishWorkRelease(work.id,status.upload.releaseId,work.revision,{headers:{'Idempotency-Key':stableKey({workId:work.id,releaseId:status.upload.releaseId,action:'publish'})}})).data;
  await writeSubmissionState(root,{...status.state,releaseId:status.upload.releaseId,publishedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  return published;
}

export function createCoursewarePreviewHandler(root) {
  const distRoot = path.join(path.resolve(root), 'dist');
  return async (request,response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost'); let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      if (!safeRelativePath(relative)) { response.writeHead(400); response.end('Bad request'); return; }
      let absolute = path.resolve(distRoot, ...relative.split('/'));
      if (absolute !== distRoot && !absolute.startsWith(`${distRoot}${path.sep}`)) { response.writeHead(403); response.end('Forbidden'); return; }
      let stat = await fs.lstat(absolute).catch(() => null);
      if ((!stat || !stat.isFile()) && !path.extname(relative)) { absolute = path.join(distRoot, 'index.html'); stat = await fs.lstat(absolute).catch(() => null); }
      if (!stat?.isFile() || stat.isSymbolicLink()) { response.writeHead(404); response.end('Not found'); return; }
      const content = await fs.readFile(absolute);
      response.writeHead(200, {
        'Content-Type':mimeTypes.get(path.extname(absolute).toLowerCase()) ?? 'application/octet-stream','Content-Length':content.length,
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
      }); response.end(content);
    } catch { response.writeHead(500); response.end('Preview error'); }
  };
}

export async function createCoursewarePreviewServer(root, { inspect, host = '127.0.0.1', port = 0 } = {}) {
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') throw new CoursewareToolkitError('COURSEWARE_PREVIEW_HOST_INVALID', '预览仅允许绑定 loopback 地址。');
  const report = await inspect(root); if (!report.ok) throw new CoursewareToolkitError('COURSEWARE_DOCTOR_FAILED', 'Doctor 未通过，不能启动预览。', report);
  const server = http.createServer(createCoursewarePreviewHandler(root));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host,port }, resolve); });
  const address = server.address(); const url = `http://${host === '::1' ? '[::1]' : host}:${address.port}/`;
  return { server,url,host,port:address.port,close:() => new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())) };
}

export async function testCoursewareProject(root, { inspect, browserModule = process.env.GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH } = {}) {
  if (!browserModule) throw new CoursewareToolkitError('COURSEWARE_BROWSER_DRIVER_MISSING', '真实旅程测试需要 Playwright；通过 --browser-module 或 GAMEHUB_COMMUNITY_PLAYWRIGHT_PATH 提供模块路径。');
  let driver;
  try { driver = require(browserModule); } catch (error) { throw new CoursewareToolkitError('COURSEWARE_BROWSER_DRIVER_INVALID', `无法加载浏览器模块：${error.message}`); }
  if (!driver?.chromium) throw new CoursewareToolkitError('COURSEWARE_BROWSER_DRIVER_INVALID', '浏览器模块没有导出 chromium。');
  const inventory = await loadCoursewareInventory(root); const course = await readJson(path.join(inventory.root, ...inventory.manifest.course.split('/'))); const tests = await readJson(path.join(inventory.root, ...inventory.manifest.tests.split('/')));
  const preview = await createCoursewarePreviewServer(root, { inspect }); let browser; const results = [];
  try {
    browser = await driver.chromium.launch({ headless:true });
    for (const journey of tests.journeys) {
      const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { window.__mooyuLearningMessages = []; window.addEventListener('message', event => { if (event.data?.protocol === 'mooyu.learning.v1') window.__mooyuLearningMessages.push(event.data); }); });
      await page.goto(preview.url, { waitUntil:'load' });
      for (const step of journey.steps) {
        if (step.action === 'enter') await page.locator(`[data-mooyu-scene="${step.target}"]`).waitFor();
        else if (step.action === 'set') await page.locator(`[data-mooyu-target="${step.target}"],#${step.target}`).first().evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles:true })); element.dispatchEvent(new Event('change', { bubbles:true })); }, step.value);
        else if (step.action === 'click') await page.locator(`[data-mooyu-action="${step.target}"],#${step.target}`).first().click();
        else if (step.action === 'answer') await page.locator(`[data-mooyu-checkpoint="${step.target}"] [data-answer="${step.value}"]`).click();
        else if (step.action === 'assert' && step.target === 'assessment.correct') {
          try { await page.waitForFunction(expected => [...window.__mooyuLearningMessages].reverse().find(message => message.type === 'assessment.result')?.payload?.correct === expected,step.expect); }
          catch { throw new CoursewareToolkitError('COURSEWARE_JOURNEY_ASSERTION_FAILED', `${journey.id} 的 assessment.correct 未达到期望 ${step.expect}。`); }
        } else if (step.action === 'complete') {
          try { await page.waitForFunction(required => { const complete=[...window.__mooyuLearningMessages].reverse().find(message => message.type === 'learning.progress')?.payload?.completedCheckpointIds ?? []; return required.every(id => complete.includes(id)); },course.completion.checkpointIds); }
          catch { throw new CoursewareToolkitError('COURSEWARE_JOURNEY_COMPLETION_FAILED', `${journey.id} 未产生完整学习进度。`); }
        }
      }
      if (errors.length) throw new CoursewareToolkitError('COURSEWARE_BROWSER_ERROR', `${journey.id} 发生浏览器错误：${errors.join('; ')}`);
      results.push({ id:journey.id,ok:true,steps:journey.steps.length }); await page.close();
    }
    return { format:'mooyu.courseware-test',version:1,coursewareId:inventory.manifest.id,projectDigest:inventory.projectDigest,ok:true,journeys:results };
  } finally { if (browser) await browser.close(); await preview.close(); }
}
