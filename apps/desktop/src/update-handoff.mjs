import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export async function prepareUpdateHandoff({app,profileRoot,installer,payload}) {
  const root=path.join(profileRoot,'updates'),id=crypto.randomUUID();
  const bytes=await fs.readFile(path.join(app.getAppPath(),'update-runner.exe'));
  const info=JSON.parse(await fs.readFile(path.join(app.getAppPath(),'build-info.json'),'utf8'));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==info.updateRunnerSha256)throw Error('DESKTOP_UPDATE_HELPER_INTEGRITY');
  const helper=path.join(root,'runner-'+id+'.exe'),request=path.join(root,'runner-'+id+'.json');
  await fs.writeFile(helper,bytes,{flag:'wx',mode:0o700});
  await fs.writeFile(request,JSON.stringify({installer,target:app.getPath('exe'),pid:process.pid,sha256:payload.installer.sha256,exeSha256:payload.installer.exeSha256}),{flag:'wx',mode:0o600});
  return ()=>{const child=spawn(helper,[request],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();};
}
