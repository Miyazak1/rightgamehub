import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import config from '../../scripts/desktop-windows-builder.cjs';
import {installedDesktopConfig} from '../../apps/desktop/src/installed-configuration.mjs';
import {auditDesktopArchive} from '../../scripts/lib/desktop-package-audit.mjs';
const root=new URL('../../',import.meta.url);
test('installed profiles stay outside the install tree and survive relocation or version upgrade',()=>{
  const data=path.resolve('test-user-data'),v1=installedDesktopConfig(data,path.resolve('installed-v1')),v2=installedDesktopConfig(data,path.resolve('installed-v2'));
  assert.equal(v1.profileRoot,v2.profileRoot);assert.notEqual(v1.assetRoot,v2.assetRoot);
  assert.ok(v1.profileRoot.startsWith(path.join(data,'MooyuWorkshop','profiles','production-')));
  assert.equal(v1.accountApiOrigin,'https://mooyu.fun');assert.equal(v1.accountEnvironment,'production');assert.deepEqual(v1.businessRuntime,{scheme:'https',domain:'runtime.mooyu.fun',port:443});
  assert.equal(installedDesktopConfig(path.resolve('different-user'),path.resolve('installed-v1')).profileRoot===v1.profileRoot,false);
});
test('installed entry refuses local launch configs, profile imports and endpoint overrides',()=>{
  for(const args of [['--config','private.json'],['--test-account-api','https://desktop-test.mooyu.fun'],['--profile-root','C:\\private'],['--production-api','https://evil.test']])assert.throws(()=>installedDesktopConfig(path.resolve('data'),path.resolve('app'),args),/DESKTOP_INSTALLED_OPTIONS_INVALID/);
  assert.doesNotThrow(()=>installedDesktopConfig(path.resolve('data'),path.resolve('app'),['--updated']));
  assert.throws(()=>installedDesktopConfig(path.resolve('data'),path.resolve('app'),['--updated','--config','private.json']),/INVALID/);
  assert.throws(()=>installedDesktopConfig('relative',path.resolve('app')),/INVALID/);
});
test('NSIS identity is stable across versions and acceptance never replaces the real application',()=>{
  const v1=config({version:'0.2.0-preview.1'}),v2=config({version:'0.2.0-preview.2'}),local=config({version:'0.2.0-preview.2',acceptance:true});
  assert.equal(v1.appId,v2.appId);assert.equal(v1.executableName,v2.executableName);assert.notEqual(v1.appId,local.appId);assert.notEqual(v1.executableName,local.executableName);
  assert.equal(v2.nsis.deleteAppDataOnUninstall,false);assert.equal(v2.nsis.perMachine,false);assert.equal(v2.nsis.allowElevation,false);assert.equal(v2.nsis.runAfterFinish,false);assert.equal(v2.nsis.createDesktopShortcut,false);assert.equal(v2.publish,null);
});
test('packaging exports the fixed base with an explicit small overlay and allows no user data files',async()=>{
  const spec=JSON.parse(await fs.readFile(new URL('scripts/desktop-windows-package.json',root)));
  assert.equal(spec.sourceCommit,'76b97a0761c18a1389d6e1d1faa4d1a636dbbdc2');assert.equal(new Set(spec.overlay).size,spec.overlay.length);
  for(const file of spec.overlay)assert.doesNotMatch(file,/(?:\.runtime|\.env|agent-paper|paper-review|MooyuWorkbench|desktop-d1)/);
  const c=config({});assert.deepEqual(c.files,['main.cjs','preload.cjs','web/**/*','build-info.json','package.json','update-runner.exe']);assert.equal(c.asar,true);
  const entry=await fs.readFile(new URL('apps/desktop/electron/installed.cjs',root),'utf8');assert.doesNotMatch(entry,/readFile|--acceptance-config|process\.env|launch\.json.*read/);
});
test('archive audit normalizes Windows paths and rejects credentials, local configuration and test entries',()=>{
  const fake=(files,code='')=>({listPackage:()=>files,statFile:(_archive,file)=>{assert.ok(!file.startsWith('\\'));return {};},extractFile:()=>Buffer.from(code)});
  assert.equal(auditDesktopArchive(fake(['\\main.cjs','\\web\\index.html']),'unused').archiveFiles,2);
  for(const file of ['\\launch.json','\\account-vault\\a.dpapi','\\web\\source.map','\\instance.env'])assert.throws(()=>auditDesktopArchive(fake(['\\main.cjs',file]),'unused'),/PRIVATE_OR_TEST/);
  assert.throws(()=>auditDesktopArchive(fake(['\\main.cjs'],'--acceptance-config'),'unused'),/TEST_ENTRY/);
  assert.throws(()=>auditDesktopArchive(fake(['\\main.cjs'],'C:\\Users\\test\\private.json'),'unused'),/MACHINE_PATH_OR_SECRET/);
  assert.throws(()=>auditDesktopArchive(fake(['\\main.cjs','\\web\\install-save-probe.js']),'unused'),/TEST_ENTRY/);
  assert.throws(()=>auditDesktopArchive(fake(['\\main.cjs'],'DESKTOP_UPDATE_HELPER_INTEGRITY'),'unused'),/HELPER_MISSING/);
});
