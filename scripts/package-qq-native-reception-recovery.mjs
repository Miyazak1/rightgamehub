import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]??''),proof=JSON.parse(fs.readFileSync(process.argv[3]??'','utf8'));
if(!out.toLowerCase().startsWith('e:\\codexdata\\build\\right\\agent-server-preflight\\')||fs.existsSync(out)||proof.result!=='PASSED'||proof.stops!==1||proof.starts!==1||!proof.sameContainerImageAndVolume||!proof.fixturePreserved)throw Error('NEW_OUTPUT_AND_PASSED_PROOF_REQUIRED');
fs.mkdirSync(out,{recursive:true});const payload=path.join(out,'reviewed-tools');fs.mkdirSync(payload);
const paths=['scripts/recover-qq-native-reception-once.mjs','scripts/agent-server-cutover.mjs','scripts/qq-plugin-guardian.mjs','apps/qq-channel/src/recovery-policy.mjs','scripts/recover-qq-gateway-once.mjs','scripts/qq-native-reception-readonly.mjs'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=paths.map(p=>{const b=fs.readFileSync(path.join(root,p));fs.mkdirSync(path.dirname(path.join(payload,p)),{recursive:true});fs.writeFileSync(path.join(payload,p),b);return {path:p,sha256:sha(b),data:b.toString('base64')};});
const manifest={releaseId:'qq-native-reception-recovery-20261125-B',sourceRef:'refs/tags/qq-observation-source-20261125-r4',files:files.map(({path,sha256})=>({path,sha256})),scope:['mooyu-qq-napcat-1'],imagesChanged:false,loginVolumeReplaced:false,guardianPolicyChanged:false,attemptCounterIncrement:1,oldTasksRetried:false};
const manifestText=JSON.stringify(manifest,null,2)+'\n',manifestHash=sha(manifestText);fs.writeFileSync(path.join(payload,'manifest.json'),manifestText);
const bundle=zlib.gzipSync(Buffer.from(JSON.stringify(files))),bundleHash=sha(bundle);fs.writeFileSync(path.join(out,'reviewed-tools.json.gz'),bundle);
fs.writeFileSync(path.join(out,'isolated-recovery-proof.json'),JSON.stringify(proof,null,2)+'\n');
const index='/www/backup/gamehub/qq-native-reception-tools-20261125-B.private.json',prefix='/www/backup/gamehub/qq-native-reception-tools-20261125-';
const runtime=`runtime=''\nfor candidate in /root/mooyu-qq-gateway-runtime-20261124-*/node /root/mooyu-github-search-runtime-20261124-*/node; do\n if test -f "$candidate" && test -x "$candidate" && test ! -L "$candidate"; then\n  case "$("$candidate" --version)" in v22.*) runtime="$candidate"; break ;; esac\n fi\ndone\ntest -n "$runtime" || { echo VERIFIED_PRIVATE_NODE_NOT_FOUND; exit 2; }\n`;
const lock='exec 9>/var/lock/mooyu-agent-plugin-release.lock\nflock -n 9\nexec 8>/var/lock/mooyu-qq-guardian.lock\nflock -w 20 8\n';
const imports="import fs from 'node:fs';import crypto from 'node:crypto';import zlib from 'node:zlib';import path from 'node:path';import{spawnSync}from'node:child_process';\n";
const entry=mode=>`const stage=JSON.parse(fs.readFileSync(${JSON.stringify(index)},'utf8')).stage;
if(!new RegExp('^'+${JSON.stringify(prefix)}+'[A-Za-z0-9]+$').test(stage)||fs.realpathSync(stage)!==stage)throw Error('EXACT_REVIEWED_TOOLS_REQUIRED');
const manifestFile=stage+'/manifest.json',raw=fs.readFileSync(manifestFile);if(crypto.createHash('sha256').update(raw).digest('hex')!==${JSON.stringify(manifestHash)})throw Error('REVIEWED_MANIFEST_CHANGED');
for(const f of JSON.parse(raw).files){const p=stage+'/'+f.path,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||!fs.realpathSync(p).startsWith(stage+'/')||crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==f.sha256)throw Error('REVIEWED_TOOL_CHANGED');}
const r=spawnSync(process.execPath,[stage+'/scripts/recover-qq-native-reception-once.mjs',${JSON.stringify(mode)}],{stdio:'inherit',env:process.env});process.exitCode=r.status??1;`;
const setup=`if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('LINUX_ROOT_REQUIRED');
if(fs.existsSync(${JSON.stringify(index)}))throw Error('TOOLS_ALREADY_STAGED_NO_OVERWRITE');
const packed=Buffer.from(${JSON.stringify(bundle.toString('base64'))},'base64');if(crypto.createHash('sha256').update(packed).digest('hex')!==${JSON.stringify(bundleHash)})throw Error('TOOLS_CHECKSUM_FAILED');
const files=JSON.parse(zlib.gunzipSync(packed,{maxOutputLength:2097152})),expected=${JSON.stringify(paths)};
if(files.length!==expected.length||new Set(files.map(f=>f.path)).size!==expected.length||files.some(f=>!expected.includes(f.path)))throw Error('TOOLS_LIST_INVALID');
const folder=fs.mkdtempSync(${JSON.stringify(prefix)});fs.chmodSync(folder,0o700);
for(const f of files){const b=Buffer.from(f.data,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('SOURCE_CHECKSUM_FAILED');const target=path.join(folder,f.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,b,{flag:'wx',mode:0o400});}
fs.writeFileSync(folder+'/manifest.json',${JSON.stringify(manifestText)},{flag:'wx',mode:0o600});fs.writeFileSync(${JSON.stringify(index)},JSON.stringify({stage:folder,releaseId:${JSON.stringify(manifest.releaseId)}})+'\\n',{flag:'wx',mode:0o600});console.log('新恢复工具目录：'+folder);
${entry('plan')}`;
const commands={
 'server-prepare-and-plan.txt':`(\nset -euo pipefail\numask 077\n${lock}${runtime}"$runtime" --input-type=module <<'QQ_RECOVERY_PREPARE_PLAN'\n${imports}${setup}\nQQ_RECOVERY_PREPARE_PLAN\n)\n`,
 'server-apply-only-after-authorization.txt':`# Restarts ONLY the original QQ gateway once. Requires explicit authorization.\n(\nset -euo pipefail\numask 077\n${lock}${runtime}export MOOYU_QQ_NATIVE_RECEIVE_RECOVERY_AUTH=20261125-once\n"$runtime" --input-type=module <<'QQ_RECOVERY_APPLY_ONCE'\n${imports}${entry('apply')}\nQQ_RECOVERY_APPLY_ONCE\n)\n`,
 'server-check-new-reply.txt':`(\nset -euo pipefail\n${runtime}"$runtime" --input-type=module <<'QQ_RECOVERY_CHECK_REPLY'\n${imports}${entry('acceptance')}\nQQ_RECOVERY_CHECK_REPLY\n)\n`
};
for(const [name,body]of Object.entries(commands)){const r=spawnSync('C:/Program Files/Git/bin/bash.exe',['-n'],{input:body,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('BASH_SYNTAX_FAILED:'+name);const code=body.match(/<<'[^']+'\n([\s\S]*?)\nQQ_RECOVERY_[A-Z_]+\n/)?.[1];if(!code||spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8',windowsHide:true}).status!==0)throw Error('NODE_WRAPPER_SYNTAX_FAILED:'+name);fs.writeFileSync(path.join(out,name),body);}
const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('file:///'+path.join(payload,'scripts/recover-qq-native-reception-once.mjs').replaceAll('\\','/')).href)})`],{encoding:'utf8',windowsHide:true,timeout:10000});if(imported.status!==0)throw Error('PACKED_MODULE_IMPORT_FAILED');
const report={result:'REVIEWED_RECOVERY_TOOLS_PREPARED_NOT_EXECUTED',out,sourceRef:manifest.sourceRef,manifestHash,bundleHash,compressedBytes:bundle.length,planHasServiceMutations:false,applyRestartsOnly:'mooyu-qq-napcat-1',authorizationPending:true,unitTestsPassed:5,isolatedContainerAndVolumeTestPassed:true,commandSyntaxPassed:true,packagedImportsResolve:true};fs.writeFileSync(path.join(out,'package-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
