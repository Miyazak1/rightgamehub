// Electron-builder owns process-wide exit hooks. Keep them in this disposable
// worker; a successful exit code alone is never its success contract.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {auditDesktopPayload} from './desktop-package-audit.mjs';
const [requestFile,resultFile]=process.argv.slice(2);
if(!path.isAbsolute(requestFile??'')||!path.isAbsolute(resultFile??''))throw Error('BUILDER_WORKER_ARGUMENTS_INVALID');
const report={passed:false,phase:'initialize'};
try {
  const request=JSON.parse(await fs.readFile(requestFile,'utf8')),require=createRequire(path.join(request.tools,'package.json'));
  if(require('electron-builder/package.json').version!==request.builderVersion)throw Error('BUILDER_VERSION_MISMATCH');
  const {build,Platform}=require('electron-builder'),{Arch}=require('builder-util'),asar=require('@electron/asar');
  process.env.CSC_IDENTITY_AUTO_DISCOVERY='false';process.env.ELECTRON_BUILDER_CACHE=path.join(request.tools,'cache');
  const validProxy=value=>{try{return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}};
  const httpsProxy=process.env.HTTPS_PROXY??process.env.https_proxy;
  if(validProxy(httpsProxy)&&process.env.HTTP_PROXY&&!validProxy(process.env.HTTP_PROXY)){process.env.HTTP_PROXY=httpsProxy;report.toolingProxyNormalized=true;}
  const config=request.config;
  config.afterPack=async context=>{report.phase='payload-audit';report.preArchiveAudit=await auditDesktopPayload(asar,context.appOutDir,request.audit);report.phase='build';};
  report.phase='build';
  for(let attempt=0;;attempt++) {
    try{await build({projectDir:config.directories.app,targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),config,publish:'never'});break;}
    catch(error){if(attempt>=1||!['EPERM','EBUSY','UNKNOWN'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  if(!report.preArchiveAudit?.payloadAuditPassed)throw Error('DESKTOP_PRE_ARCHIVE_GATE_NOT_EXECUTED');
  report.phase='final-payload-audit';report.finalAudit=await auditDesktopPayload(asar,path.join(config.directories.output,'win-unpacked'),request.audit);
  report.passed=true;report.phase='complete';
}catch(error){report.error=error.message;process.exitCode=1;}
await fs.writeFile(resultFile,JSON.stringify(report,null,2)+'\n');
// A tool cleanup hook can turn even this worker's exitCode into 0. Parent checks
// both the OS status AND the report, and never imports the tool's exit hooks.
