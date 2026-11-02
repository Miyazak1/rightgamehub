import fs from 'node:fs/promises';
import fsSync,{createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isNewerUpdate} from './update-version.mjs';
import {updateTrust,fetchUpdateEnvelope} from './update-manifest.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
async function hashes(file){const sha256=crypto.createHash('sha256'),sha512=crypto.createHash('sha512');for await(const chunk of createReadStream(file)){sha256.update(chunk);sha512.update(chunk);}return {sha256:sha256.digest('hex'),sha512:sha512.digest('base64')};}
export async function createDesktopUpdater({configuration,localTest=false,app,appRoot,profileRoot,fetchImpl=fetch,engineFactory,prepareInstall,onState=()=>{},confirmInstall=async()=>false,isBusy=()=>false}) {
  const trust=updateTrust(configuration,{localTest});
  let state={status:trust?'idle':'disabled',currentVersion:app.getVersion()},engine,verified,installer,operation,abort,quitHandler;
  const snapshot=()=>({...state});
  const publish=(status,extra={})=>{state={status,currentVersion:app.getVersion(),...extra};onState(snapshot());};
  const readManifest=async()=>{const result=await fetchUpdateEnvelope(fetchImpl,trust,{signal:abort?.signal});verified=result;return result;};
  const cacheRoot=path.join(profileRoot,'updates');
  const inside=file=>{const r=path.relative(cacheRoot,path.resolve(file));return r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
  async function validateFile(file,manifest=verified){
    if(!manifest||!inside(file))fail('DESKTOP_UPDATE_UNTRUSTED');
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||!inside(await fs.realpath(file))||stat.size!==manifest.payload.installer.size)fail('DESKTOP_UPDATE_INTEGRITY');
    const actual=await hashes(file);if(actual.sha256!==manifest.payload.installer.sha256||actual.sha512!==manifest.payload.installer.sha512)fail('DESKTOP_UPDATE_INTEGRITY');
  }
  async function download(url,destination,options){
    const expected=verified?.payload.installer;if(!expected||url.href!==new URL(expected.path,trust.feed).href||!inside(destination))fail('DESKTOP_UPDATE_UNTRUSTED');
    const response=await fetchImpl(url.href,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(900000)]),redirect:'error',credentials:'omit',headers:{'Accept-Encoding':'identity'}});
    if(response.status!==200||response.redirected)fail('DESKTOP_UPDATE_DOWNLOAD_FAILED');
    const handle=await fs.open(destination,'wx',0o600);let size=0,last=0;const start=Date.now();
    try{for await(const chunk of response.body){abort.signal.throwIfAborted();size+=chunk.length;if(size>expected.size)fail('DESKTOP_UPDATE_INTEGRITY');await handle.writeFile(chunk);if(Date.now()-last>200){last=Date.now();options.onProgress?.({percent:size/expected.size*100,transferred:size,total:expected.size,bytesPerSecond:size/Math.max(1,(Date.now()-start)/1000)});}}}finally{await handle.close();}
    await validateFile(destination);
  }
  if(trust){
    await fs.mkdir(cacheRoot,{recursive:true});
    engine=engineFactory({adapter:{version:app.getVersion(),name:'mooyu-updates',isPackaged:true,userDataPath:profileRoot,baseCachePath:cacheRoot,appUpdateConfigPath:path.join(appRoot,'build-info.json'),updateOrigin:new URL(trust.feed).origin,whenReady:()=>app.whenReady(),onQuit:handler=>app.once('quit',handler),quit:()=>app.quit()},readManifest,download,installDirectory:path.dirname(app.getPath('exe'))});
    engine.on('error',()=>{}); // Controller exposes only bounded, non-sensitive codes.
    engine.on('download-progress',value=>{if(state.status==='downloading')publish('downloading',{version:verified.payload.version,percent:Math.max(0,Math.min(100,Math.round(value.percent)))});});
  }
  function cancelInstall(){if(quitHandler){app.removeListener('quit',quitHandler);quitHandler=null;publish('ready',{version:verified?.payload.version});}}
  async function run(action){
    if(!engine)return snapshot();
    if(action==='cancel'){abort?.abort();return snapshot();}
    if(operation)return snapshot();
    operation=Promise.resolve().then(async()=>{
      abort=new AbortController();
      try{
        if(action==='check'){
          installer=null;publish('checking');await engine.checkForUpdates();
          const newer=isNewerUpdate(verified.payload.version,app.getVersion());
          publish(newer?'available':'current',newer?{version:verified.payload.version}:{});
        }else if(action==='download'){
          if(state.status!=='available'&&state.status!=='error')return snapshot();
          publish('checking');const fresh=await readManifest();await engine.checkForUpdates();if(fresh.fingerprint!==verified.fingerprint)fail('DESKTOP_UPDATE_CHANGED');if(!isNewerUpdate(fresh.payload.version,app.getVersion())){publish('current');return snapshot();}
          publish('downloading',{version:verified.payload.version,percent:0});const files=await engine.downloadUpdate();
          abort.signal.throwIfAborted();if(files.length!==1)fail('DESKTOP_UPDATE_UNTRUSTED');await validateFile(files[0]);installer=files[0];publish('ready',{version:verified.payload.version});
        }else if(action==='install'){
          if(state.status!=='ready'||!installer)fail('DESKTOP_UPDATE_NOT_READY');
          if(isBusy())fail('DESKTOP_UPDATE_BUSY');
          if(!await confirmInstall())return snapshot();
          const expected=verified,latest=await readManifest();if(expected.fingerprint!==latest.fingerprint)fail('DESKTOP_UPDATE_CHANGED');await validateFile(installer,expected);
          const handoff=await prepareInstall(installer,verified.payload);
          publish('installing',{version:verified.payload.version});
          quitHandler=()=>{
            // Recheck at the last synchronous point before handing off execution.
            try{const bytes=fsSync.readFileSync(installer),sha=crypto.createHash('sha256').update(bytes).digest('hex');if(sha!==verified.payload.installer.sha256)throw Error();handoff();}catch{fsSync.writeFileSync(path.join(cacheRoot,'last-error.txt'),'DESKTOP_UPDATE_INTEGRITY');}finally{quitHandler=null;}
          };
          app.once('quit',quitHandler);app.quit();
        }
      }catch(error){installer=null;cancelInstall();publish('error',{code:abort.signal.aborted?'DESKTOP_UPDATE_CANCELLED':/^DESKTOP_UPDATE_[A-Z_]+$/.test(error.code??'')?error.code:'DESKTOP_UPDATE_FAILED'});}
      finally{operation=null;}
      return snapshot();
    });
    return operation;
  }
  return {state:snapshot,run,cancelInstall,dispose(){abort?.abort();if(state.status!=='installing')cancelInstall();}};
}
