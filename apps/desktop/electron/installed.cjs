const {app,dialog}=require('electron');
const {createShell}=require('./main.cjs');
const {installedDesktopConfig}=require('../src/installed-configuration.mjs');
const args=process.argv.slice(1);
if(args.length===1 && args[0]==='--version') { console.log(app.getVersion());app.exit(0); }
else {
  // NSIS/Windows may pass no user arguments. Custom endpoints and profile paths
  // are development-only; an installed build always uses the shared service.
  const config=installedDesktopConfig(app.getPath('appData'),app.getAppPath(),args);
  createShell(config).then(shell=>shell?.createWindow(config.initialRoute)).catch(()=>{
    dialog.showErrorBox('墨鱼工坊','客户端启动失败。账号和本地存档仍保留，请重新启动。');app.exit(70);
  });
}
