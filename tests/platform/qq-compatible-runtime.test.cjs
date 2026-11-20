const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const enabled=process.env.QQ_COMPAT_TEST_DOCKER==='1',image='mooyu-qq-gateway:20261120-compatible-candidate';
function docker(extra){return cp.spawnSync('docker',['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--env','QQ_WEBUI_TOKEN='+'a'.repeat(64),...extra,image],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1e6});}

test('compatible gateway refuses mixed runtime settings before touching login data',{skip:!enabled,timeout:90000},()=>{
 for(const extra of [['--env','NAPCAT_QQ_DATA_DIR=/data/qq'],['--workdir','/opt']]){
  const r=docker(extra);assert.notEqual(r.status,0);assert.match(r.stderr,/QQ_COMPAT_RUNTIME_MISMATCH/);assert(!r.stdout.includes('a'.repeat(64)));assert(!r.stderr.includes('a'.repeat(64)));
 }
});

test('compatible gateway refuses a changed management token and preserves existing configuration bytes',{skip:!enabled,timeout:45000},t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qq-compat-guard-'));
 t.after(()=>{const resolved=path.resolve(directory);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(resolved).startsWith('qq-compat-guard-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const config=path.join(directory,'napcat/config');fs.mkdirSync(config,{recursive:true});const file=path.join(config,'webui.json'),original=JSON.stringify({host:'0.0.0.0',port:6099,token:'b'.repeat(64)});fs.writeFileSync(file,original);
 const r=docker(['--mount',`type=bind,source=${directory},target=/data`]);assert.notEqual(r.status,0);assert.match(r.stderr,/QQ_EXISTING_WEBUI_CONFIG_RETAINED/);assert.equal(fs.readFileSync(file,'utf8'),original);assert(!r.stderr.includes('b'.repeat(64)));
});

test('context preparation rejects an unverified program before creating build output',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qq-compat-source-')),source=path.join(directory,'main.mjs'),out='E:/CodexData/build/Right/qq-compatible-candidate/rejected-'+crypto.randomUUID();
 try{fs.writeFileSync(source,'export const synthetic=true;');const r=cp.spawnSync(process.execPath,['scripts/prepare-qq-compatible-context.mjs','--out-dir',out,'--main',source],{encoding:'utf8',windowsHide:true});assert.notEqual(r.status,0);assert.match(r.stderr,/QQ_MAIN_HASH_MISMATCH/);assert(!fs.existsSync(out));}
 finally{const resolved=path.resolve(directory);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(resolved).startsWith('qq-compat-source-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
