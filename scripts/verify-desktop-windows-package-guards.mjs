import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createFailingBuilderTools} from '../tests/desktop/builder-failure-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==2||process.platform!=='win32')throw Error('LOCAL_WINDOWS_GUARDS_ONLY');
const tools=path.join(root,'.runtime/windows-packaging-tools'),require=createRequire(path.join(tools,'package.json'));
const parent=path.join(root,'.runtime/desktop-windows-package-guards');await fs.mkdir(parent,{recursive:true});const directory=await fs.mkdtemp(path.join(parent,'check-'));
const cases=[],report={passed:false,directory,productionConnected:false,installerBuilt:false,published:false,cases};
try {
  for(const mode of ['build','audit']) {
    const fakeTools=await createFailingBuilderTools(path.join(directory,mode),{mode,tempFileModule:require.resolve('temp-file')});
    const env={...process.env,APP_BUILDER_TMP_DIR:directory};
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'scripts/package-desktop-windows.mjs'),'--tools',fakeTools],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
      child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const timer=setTimeout(()=>{child.kill();reject(Error('PACKAGE_GUARD_TIMEOUT'));},180000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);resolve({code,output});});
    });
    await fs.writeFile(path.join(directory,mode+'.log'),result.output);
    const latest=JSON.parse(await fs.readFile(path.join(root,'.runtime/desktop-windows-package/latest.json')));
    const worker=JSON.parse(await fs.readFile(path.join(latest.directory,'builder-result.json'))),status=JSON.parse(await fs.readFile(path.join(latest.directory,'builder-status.json')));
    assert.equal(result.code,1);assert.equal(latest.passed,false);assert.equal(worker.passed,false);assert.equal(status.code,0);
    assert.match(latest.error,mode==='build'?/TEST_BUILD_FAILURE_AFTER_CLEANUP_HOOK/:/DESKTOP_PAYLOAD_UNEXPECTED_FILE/);
    cases.push({mode,cliExitCode:result.code,workerExitCode:status.code,phase:worker.phase,error:latest.error,passed:true});
  }
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(parent,'latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
