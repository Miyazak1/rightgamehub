import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareDesktopRuntime,runtimeFiles} from '../../scripts/lib/desktop-runtime.mjs';
import {auditDesktopPayload} from '../../scripts/lib/desktop-package-audit.mjs';
import {createFailingBuilderTools} from '../desktop/builder-failure-fixture.mjs';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const fakeAsar={listPackage:()=>['\\main.cjs'],statFile:()=>({}),extractFile:()=>Buffer.from('public application code')};
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mooyu-package-'));t.after(async()=>{if(!path.resolve(directory).startsWith(path.join(path.resolve(os.tmpdir()),'mooyu-package-')))throw Error('TEST_CLEANUP_PATH_INVALID');await fs.rm(directory,{recursive:true,force:true});});return directory;}
async function archiveFixture(directory){const host=path.join(directory,'host');await fs.mkdir(host);await fs.writeFile(path.join(host,'electron-v44.4.5-win32-x64.zip'),'public archive fixture');const manifest={electronVersion:'44.4.5',electronArchiveSha256:digest('public archive fixture'),electronExecutableSha256:digest('public executable fixture')};return {host,manifest,extract:async(_zip,to)=>{await fs.mkdir(path.join(to,'resources'));await fs.writeFile(path.join(to,'electron.exe'),'public executable fixture');await fs.writeFile(path.join(to,'LICENSE'),'public license');await fs.writeFile(path.join(to,'resources/default_app.asar'),'development loader');}};}
test('runtime preparation consumes only the pinned archive and omits nearby machine files and the development loader',async t=>{
  const directory=await fixture(t),data=await archiveFixture(directory);
  await fs.writeFile(path.join(data.host,'machine-private.env'),'synthetic, not a credential');await fs.mkdir(path.join(data.host,'resources'));await fs.writeFile(path.join(data.host,'resources/local-config.json'),'{}');
  const result=await prepareDesktopRuntime({runtime:data.host,destination:path.join(directory,'clean-runtime'),manifest:data.manifest,extract:data.extract});
  assert.deepEqual(result.files.map(row=>row.file),['electron.exe','LICENSE']);assert.equal(await fs.readFile(path.join(data.host,'machine-private.env'),'utf8'),'synthetic, not a credential');
  await assert.rejects(fs.access(path.join(result.directory,'resources/default_app.asar')));await assert.rejects(fs.access(path.join(result.directory,'machine-private.env')));
});
test('a changed archive is rejected before extraction, even when a nearby executable has the expected hash',async t=>{
  const directory=await fixture(t),data=await archiveFixture(directory);await fs.writeFile(path.join(data.host,'electron.exe'),'public executable fixture');await fs.writeFile(path.join(data.host,'electron-v44.4.5-win32-x64.zip'),'changed archive');let extracted=false;
  await assert.rejects(prepareDesktopRuntime({runtime:data.host,destination:path.join(directory,'clean'),manifest:data.manifest,extract:async()=>{extracted=true;}}),/ELECTRON_ARCHIVE_HASH_MISMATCH/);assert.equal(extracted,false);
});
test('archive extraction must still produce the pinned executable',async t=>{
  const directory=await fixture(t),data=await archiveFixture(directory);
  await assert.rejects(prepareDesktopRuntime({runtime:data.host,destination:path.join(directory,'clean'),manifest:data.manifest,extract:async(_zip,to)=>fs.writeFile(path.join(to,'electron.exe'),'wrong executable')}),/ELECTRON_HASH_MISMATCH/);
});
async function payloadFixture(directory){const runtime=path.join(directory,'runtime'),payload=path.join(directory,'payload');await fs.mkdir(runtime);await fs.writeFile(path.join(runtime,'electron.exe'),'executable');await fs.writeFile(path.join(runtime,'LICENSE'),'license');await fs.mkdir(path.join(payload,'resources'),{recursive:true});await fs.copyFile(path.join(runtime,'electron.exe'),path.join(payload,'MooyuWorkshop.exe'));await fs.copyFile(path.join(runtime,'LICENSE'),path.join(payload,'LICENSE.electron.txt'));await fs.writeFile(path.join(payload,'resources/app.asar'),'application');return {payload,options:{runtime:{files:await runtimeFiles(runtime)},executableName:'MooyuWorkshop'}};}
test('whole-payload gate rejects extra root files, resources and profile directories before archiving',async t=>{
  const data=await payloadFixture(await fixture(t));assert.equal((await auditDesktopPayload(fakeAsar,data.payload,data.options)).payloadAuditPassed,true);
  for(const name of ['machine-private.env','resources/local-config.json']){await fs.writeFile(path.join(data.payload,name),'synthetic sentinel');await assert.rejects(auditDesktopPayload(fakeAsar,data.payload,data.options),/DESKTOP_PAYLOAD_UNEXPECTED_FILE/);await fs.rm(path.join(data.payload,name));}
  await fs.mkdir(path.join(data.payload,'user-data'));await assert.rejects(auditDesktopPayload(fakeAsar,data.payload,data.options),/DESKTOP_PAYLOAD_UNEXPECTED_DIRECTORY/);
});
test('whole-payload gate checks runtime bytes, missing files and links rather than just file names',async t=>{
  const directory=await fixture(t),data=await payloadFixture(directory),license=path.join(data.payload,'LICENSE.electron.txt');await fs.writeFile(license,'changed');await assert.rejects(auditDesktopPayload(fakeAsar,data.payload,data.options),/HASH_MISMATCH/);await fs.rm(license);await assert.rejects(auditDesktopPayload(fakeAsar,data.payload,data.options),/MISSING_FILE/);
  const target=path.join(directory,'outside');await fs.mkdir(target);await fs.symlink(target,path.join(data.payload,'resources/linked'),'junction');await assert.rejects(auditDesktopPayload(fakeAsar,data.payload,data.options),/LINK_DENIED/);
});
for(const mode of ['build','audit'])test(`parent CLI exits nonzero for ${mode} failure even when the worker cleanup hook exits zero`,async t=>{
  const directory=await fixture(t),tools=await createFailingBuilderTools(path.join(directory,'tools'),{mode}),request={tools,builderVersion:'26.18.1',config:{directories:{app:directory,output:path.join(directory,'output')}},audit:{runtime:{files:[{file:'electron.exe',sha256:digest('exe')}]},executableName:'MooyuWorkshop'}};
  const runner=fileURLToPath(new URL('../../scripts/lib/desktop-builder-runner.mjs',import.meta.url)),parent=path.join(directory,'parent.mjs');
  await fs.writeFile(parent,`import {runDesktopBuilder} from ${JSON.stringify(pathToFileURL(runner).href)};try{await runDesktopBuilder(${JSON.stringify(request)},${JSON.stringify(directory)})}catch(error){console.error(error.message);process.exitCode=1;}`);
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[parent],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',b=>output+=b);child.stdout.on('data',b=>output+=b);child.once('error',reject);child.once('exit',code=>resolve({code,output}));});
  assert.equal(result.code,1,result.output);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'builder-status.json'))).code,0);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'builder-result.json'))).passed,false);
  assert.match(result.output,mode==='build'?/TEST_BUILD_FAILURE_AFTER_CLEANUP_HOOK/:/DESKTOP_PAYLOAD_UNEXPECTED_FILE/);
});
