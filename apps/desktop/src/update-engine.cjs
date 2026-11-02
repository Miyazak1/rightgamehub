const {NsisUpdater}=require('electron-updater');
const {Provider}=require('electron-updater/out/providers/Provider');

// The provider can only resolve an authenticated, same-origin artifact. The
// application's controller also re-verifies the cached file before installing.
exports.createUpdateEngine=function({adapter,readManifest,download,installDirectory}) {
  class SignedProvider extends Provider {
    constructor(_options,_updater,runtime){super(runtime);}
    async getLatestVersion(){this.verified=await readManifest();const p=this.verified.payload;return {version:p.version,releaseDate:p.releasedAt,files:[{url:p.installer.path,sha512:p.installer.sha512,size:p.installer.size}]};}
    resolveFiles(info){const p=this.verified?.payload;if(!p||info.version!==p.version)throw Error('DESKTOP_UPDATE_UNTRUSTED');return [{url:new URL(p.installer.path,adapter.updateOrigin),info:{url:p.installer.path,sha512:p.installer.sha512,size:p.installer.size}}];}
  }
  const engine=new NsisUpdater({provider:'custom',updateProvider:SignedProvider},adapter);
  engine.autoDownload=false;engine.autoInstallOnAppQuit=false;engine.allowDowngrade=false;
  engine.allowPrerelease=true;engine.disableWebInstaller=true;engine.disableDifferentialDownload=true;
  engine.installDirectory=installDirectory;
  engine.httpExecutor={download};
  engine.logger={info(){},warn(){},error(){},debug(){}};
  return engine;
};
