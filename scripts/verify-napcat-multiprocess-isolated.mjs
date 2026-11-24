// Disposable, disconnected smoke test of the exact deployed gateway image.
// Does not mount a host path/login volume or start the image entrypoint.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {processProbeCode} from './verify-napcat-mode-readonly.mjs';
const out=process.argv[2];if(!out||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_BUILD_DIRECTORY_REQUIRED');fs.mkdirSync(out,{recursive:true});
const image='sha256:ac32edd020830d3f9437ef2e46e462b0ee02390a76bd19167848ad0b2a69412d',label='mooyu.qq.mode-test',value=crypto.randomBytes(10).toString('hex'),name='napcat-mode-test-'+value;
const docker=(args,options={})=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,...options});if(r.status!==0)throw Error('LOCAL_DOCKER_'+args[0]+'_FAILED');return r.stdout?.trim()??'';};
let made=false,proof={result:'FAILED',image,network:'none',productionChanged:false,loginDataMounted:false,nativeLoginTested:false};
try{
 const identity=JSON.parse(docker(['run','--rm','--network','none','--read-only','--entrypoint','node',image,'-e','console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}));']));
 if(!Number.isSafeInteger(identity.uid)||!Number.isSafeInteger(identity.gid))throw Error('IMAGE_USER_IDENTITY_REQUIRED');proof.runtimeUser=identity;
 const minimal=process.argv[3]==='minimal';proof.minimalEnvironmentChange=minimal;
 const modeEnv=minimal?['-e','NAPCAT_DISABLE_MULTI_PROCESS=0']:['-e','NAPCAT_DISABLE_MULTI_PROCESS=0','-e','NAPCAT_DISABLE_MULTIPROCESSING=0','-e','NAPCAT_WORKER_PROCESS=0','-e','NAPCAT_FORCE_NODE_PROCESS=1','-e','NAPCAT_DISABLE_PIPE=1'];
 docker(['run','-d','--name',name,'--label',label+'='+value,'--pull','never','--network','none','--read-only','--memory','512m','--pids-limit','96','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/data:rw,nosuid,size=128m,uid='+identity.uid+',gid='+identity.gid+',mode=0700','--tmpfs','/tmp:rw,nosuid,size=128m','--workdir','/app',...modeEnv,'--entrypoint','node',image,'/app/load.cjs']);made=true;
 await new Promise(r=>setTimeout(r,5000));
 const before=JSON.parse(docker(['inspect',name]))[0];
 const sourceCode="const fs=require('fs'),s=fs.readFileSync('/app/napcat/napcat.mjs','utf8');console.log(JSON.stringify({singleModeBypassesManager:/if \\(Ef.isMultiProcessDisabled\\) \\{\\s*await ZQ\\(\\)/.test(s),workerPreloadsAddon:s.includes('process.dlopen({ exports: {} }, t'),workerInstallsRestartCallback:s.includes('de.setRestartProcessCall(async () =>'),forksWithIpc:s.includes('[\"inherit\", \"pipe\", \"pipe\", \"ipc\"]')}));";
 proof.sourceMarkers=JSON.parse(docker(['run','--rm','--network','none','--read-only','--entrypoint','node',image,'-e',sourceCode]));
 const tree=before.State.Running?JSON.parse(docker(['exec',name,'node','-e',processProbeCode])):{count:0,parentChildPair:false};
 const log=spawnSync('docker',['logs','--tail','300',name],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024});const text=(log.stdout??'')+'\n'+(log.stderr??'');
 const markers={addonPreloaded:/已预加载 Node Addon/.test(text),addonFailed:/预加载 Node Addon 失败/.test(text),parentStartFailed:/\[Process\] 启动失败/.test(text),workerCrashLoop:/异常退出 3 次/.test(text),missingModule:/ERR_MODULE_NOT_FOUND|Cannot find module/.test(text),waitingNetwork:/等待网络连接|网络不可用|ENETUNREACH|EAI_AGAIN/.test(text)};
 proof.errorSummaries=[...text.matchAll(/(?:Error|TypeError|SyntaxError|RangeError|ERR_[A-Z_]+|EACCES|EROFS|ENOENT)[^\r\n]{0,250}/g)].slice(0,6).map(m=>m[0].replace(/https?:\/\/\S+/gi,'[url]').replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g,'[identifier]'));
 proof={...proof,containerRunning:before.State.Running,exitCode:before.State.ExitCode,nodeProcessCount:tree.count,parentChildPair:tree.parentChildPair,markers};
 if(!before.State.Running||proof.nodeProcessCount<2||!tree.parentChildPair||!markers.addonPreloaded||markers.addonFailed||markers.parentStartFailed||markers.workerCrashLoop||markers.missingModule)throw Error('ISOLATED_MULTIPROCESS_SMOKE_FAILED');
 proof.result='PASSED_BOOTSTRAP_ONLY';
}catch(e){proof.errorCode=/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'LOCAL_TEST_FAILED';process.exitCode=1;}
finally{
 if(made){const c=JSON.parse(docker(['inspect',name]))[0];if(c.Config.Labels[label]!==value||c.HostConfig.NetworkMode!=='none'||c.Mounts.some(m=>m.Type!=='tmpfs'))throw Error('TEST_SCOPE_CHANGED');docker(['stop','--timeout','10',name]);docker(['rm',name]);proof.testContainerRemoved=true;}
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}
