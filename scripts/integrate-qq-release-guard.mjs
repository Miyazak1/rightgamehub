import {assertQQApplicationHealthy} from './qq-plugin-release-guard.mjs';
import {WORKER_SNAPSHOT_PROBE} from './qq-plugin-guardian.mjs';
// Apply only to a NEW release artifact after its existing formatter/scopes
// transforms. Frozen packages and records are never rewritten in place.
export function addQQApplicationGate(original){
 let source=original;const once=(from,to)=>{if(source.split(from).length!==2)throw Error('QQ_RELEASE_GATE_ANCHOR_REQUIRED');source=source.replace(from,to);};
 once("fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});lock=true;",String.raw`fs.mkdirSync('/var/lock/mooyu-agent-plugin-cutover.lock',{mode:0o700});lock=true;fs.writeFileSync('/var/lock/mooyu-agent-plugin-cutover.lock/qq-guardian-owner.private.json',JSON.stringify({kind:'mooyu-qq-guardian-v1',pid:process.pid,start:fs.readFileSync('/proc/'+process.pid+'/stat','utf8').split(') ').at(-1).trim().split(/\s+/)[19],boot:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()}),{flag:'wx',mode:0o600});`);
 once("if(lock)fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');", "if(lock){const lease='/var/lock/mooyu-agent-plugin-cutover.lock/qq-guardian-owner.private.json';if(fs.existsSync(lease)){if(JSON.parse(fs.readFileSync(lease,'utf8')).pid!==process.pid)fail('MAINTENANCE_LEASE_CHANGED');fs.unlinkSync(lease);}fs.rmdirSync('/var/lock/mooyu-agent-plugin-cutover.lock');}");
 once("setPhase('preflight-current-scene');const cs=all();papers(cs);", "setPhase('preflight-current-scene');const cs=all();papers(cs);assertQQApplicationHealthy(qqApplicationSnapshot());state.qqApplicationGateVersion=2;");
 once("const result={result:mode==='upgrade'?'GITHUB_SEARCH_UPDATE_VERIFIED'", "let qqPrevious=null;for(let qqRound=0;qqRound<4;qqRound++){await new Promise(r=>setTimeout(r,10000));const qqCurrent=qqApplicationSnapshot();assertQQApplicationHealthy(qqCurrent);if(qqPrevious&&Date.parse(qqCurrent.runtime.checkedAt)<=Date.parse(qqPrevious))fail('QQ_RELEASE_OBSERVATION_NOT_ADVANCING');qqPrevious=qqCurrent.runtime.checkedAt;guards();}const result={qqApplicationVerified:true,qqStableWindowMs:40000,result:mode==='upgrade'?'GITHUB_SEARCH_UPDATE_VERIFIED'");
 source+='\n'+assertQQApplicationHealthy.toString()+'\nfunction qqApplicationSnapshot(){return JSON.parse(docker(["exec","mooyu-qq-worker-1","node","--input-type=module","-e",'+JSON.stringify(WORKER_SNAPSHOT_PROBE)+']));}\n';
 return source;
}
