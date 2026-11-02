import fs from 'node:fs/promises';
import path from 'node:path';
// Deliberately reproduces the tool cleanup hook's exit(0), using the real
// temp-file dependency in opt-in integration checks and a local stand-in in units.
export async function createFailingBuilderTools(directory,{mode,tempFileModule}={}) {
  if(!['build','audit'].includes(mode))throw Error('FIXTURE_MODE_INVALID');
  const modules=path.join(directory,'node_modules');
  for(const name of ['electron-builder','builder-util','@electron/asar'])await fs.mkdir(path.join(modules,name),{recursive:true});
  await fs.writeFile(path.join(directory,'package.json'),'{}');
  await fs.writeFile(path.join(modules,'electron-builder/package.json'),JSON.stringify({name:'electron-builder',version:'26.18.1',main:'index.cjs'}));
  const hook=tempFileModule?`await new (require(${JSON.stringify(tempFileModule)}).TmpDir)().getTempFile({prefix:'failure-regression'});`:`process.on('beforeExit',()=>process.exit(0));`;
  await fs.writeFile(path.join(modules,'electron-builder/index.cjs'),`
const fs=require('node:fs/promises'),path=require('node:path');
exports.Platform={WINDOWS:{createTarget:()=>new Map()}};
exports.build=async({config})=>{
 ${hook}
 if(${JSON.stringify(mode)}==='build')throw Error('TEST_BUILD_FAILURE_AFTER_CLEANUP_HOOK');
 const appOutDir=path.join(config.directories.output,'win-unpacked');await fs.mkdir(appOutDir,{recursive:true});
 await fs.writeFile(path.join(appOutDir,'machine-private.env'),'REVIEW_ONLY_SENTINEL=not-a-credential');
 await config.afterPack({appOutDir});throw Error('AUDIT_DID_NOT_REJECT_SENTINEL');
};`);
  await fs.writeFile(path.join(modules,'builder-util/index.js'),'exports.Arch={x64:1};');
  await fs.writeFile(path.join(modules,'@electron/asar/index.js'),'module.exports={};');
  return directory;
}
