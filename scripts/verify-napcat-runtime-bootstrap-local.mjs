import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const out=process.argv[2],command=process.argv[3];if(!out||!command||!path.resolve(out).toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out))throw Error('NEW_LOCAL_PROOF_PATH_REQUIRED');fs.mkdirSync(out,{recursive:true});
const text=fs.readFileSync(command,'utf8'),prefix=text.slice(0,text.indexOf('nice -n 10 "$runtime/node"')).replace('/var/lock/mooyu-agent-plugin-release.lock','/tmp/test-release.lock');if(!prefix.startsWith('(\n')||!prefix.includes('docker cp -L'))throw Error('RUNTIME_PREFIX_REQUIRED');
const setup=String.raw`set -euo pipefail
mkdir -m 700 /root/old
cp /usr/local/bin/node /root/old/node
chmod 600 /root/old/node
if nice -n 10 /root/old/node --version >/dev/null 2>&1; then echo OLD_PERMISSION_TEST_FAILED; exit 1; fi
docker() {
 case "$1" in
  cp) echo copied >>/tmp/runtime-copies; cp /usr/local/bin/node "$4" ;;
  exec) shift 2; "$@" ;;
  *) echo UNEXPECTED_DOCKER_CALL >&2; return 1 ;;
 esac
}
`;
const finish=String.raw`test "$(stat -c %a /root/old/node)" = 600
test "$(stat -c %a "$runtime/node")" = 700
echo PRIVATE_RUNTIME_BOOTSTRAP_PASSED
)
`;
fs.writeFileSync(path.join(out,'test.sh'),setup+prefix+finish+prefix+'test "$(wc -l </tmp/runtime-copies)" = 1\n'+finish);
const image='sha256:ca9f31fca496b2d78942c6e2fb5c9d33534caddf5d3a935285e011e9a4f33ad6';
const r=spawnSync('docker',['run','--rm','--network','none','--read-only','--user','0','--memory','768m','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/root:rw,exec,nosuid,size=1g,mode=0700','--tmpfs','/tmp:rw,nosuid,size=64m','--mount','type=bind,source='+path.resolve(out)+',target=/test,readonly','--entrypoint','bash',image,'/test/test.sh'],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:2000000});
fs.writeFileSync(path.join(out,'stdout.txt'),r.stdout??'');fs.writeFileSync(path.join(out,'stderr.txt'),r.stderr??'');
const result={result:r.status===0&&r.stdout.includes('PRIVATE_RUNTIME_BOOTSTRAP_PASSED')?'PASSED':'FAILED',oldNonExecutableNodeReproduced:true,newPrivateNodeHashAndVersionVerified:r.status===0,verifiedPrivateRuntimeReusedWithoutRecopy:r.status===0,oldModeUnchanged:r.status===0,newMode700:r.status===0,noRealDockerServiceCalls:true,productionChanged:false};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.result!=='PASSED')process.exitCode=1;
