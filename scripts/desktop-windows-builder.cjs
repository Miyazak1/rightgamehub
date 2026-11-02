// A local preview installer. Nothing here supplies a publish/update destination.
module.exports=function windowsBuilder({appDirectory,output,icon,version,acceptance=false}) {
  return {appId:acceptance?'fun.mooyu.desktop.acceptance':'fun.mooyu.desktop',
    productName:acceptance?'墨鱼工坊安装验收':'墨鱼工坊',executableName:acceptance?'MooyuWorkshopAcceptance':'MooyuWorkshop',
    directories:{app:appDirectory,output},asar:true,npmRebuild:false,
    publish:null,forceCodeSigning:false,
    files:['main.cjs','preload.cjs','web/**/*','build-info.json','package.json','update-runner.exe'],
    extraMetadata:{version},win:{target:[{target:'nsis',arch:['x64']}],icon,
      signAndEditExecutable:true,signExecutable:false,verifyUpdateCodeSignature:false},
    nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,
      deleteAppDataOnUninstall:false,runAfterFinish:false,packElevateHelper:false,
      createDesktopShortcut:false,createStartMenuShortcut:true,
      artifactName:acceptance?'MooyuWorkshop-Acceptance-${version}-x64.exe':'MooyuWorkshop-${version}-x64-Setup.exe',
      installerLanguages:['zh_CN','en_US'],displayLanguageSelector:false,
      uninstallDisplayName:acceptance?'墨鱼工坊安装验收':'墨鱼工坊'}
  };
};
