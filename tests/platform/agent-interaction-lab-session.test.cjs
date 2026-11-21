const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {saveLabSession}=require('../../scripts/agent-interaction-lab-session.cjs');
test('late API startup keeps transport ports, worker and policy changes saved after its initial read',t=>{
 const tempRoot=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(tempRoot,'mooyu-lab-session-'));t.after(()=>{const target=fs.realpathSync(dir);if(!target.startsWith(tempRoot+path.sep)||!path.basename(target).startsWith('mooyu-lab-session-'))throw Error('TEMP_CLEANUP_IDENTITY_REQUIRED');fs.rmSync(target,{recursive:true});});const file=path.join(dir,'session.json');
 const initial={agentId:'agent',operatorId:'operator',apiPort:1234,serverPid:1,qqWorker:'old-worker',qqControlPort:5000,providerCallLimit:48,fixtureSecret:'private-fixture'};
 fs.writeFileSync(file,JSON.stringify(initial));const stale=JSON.parse(fs.readFileSync(file));
 fs.writeFileSync(file,JSON.stringify({...initial,qqWorker:'image-worker',qqControlPort:6000,providerCallLimit:52}));
 saveLabSession(file,{...stale,apiPort:4321,serverPid:2});
 const actual=JSON.parse(fs.readFileSync(file));assert.equal(actual.qqWorker,'image-worker');assert.equal(actual.qqControlPort,6000);assert.equal(actual.providerCallLimit,52);assert.equal(actual.apiPort,4321);assert.equal(actual.serverPid,2);assert.equal(actual.fixtureSecret,initial.fixtureSecret);
});
