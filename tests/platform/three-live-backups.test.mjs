import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBackupDockerCommand,backupSnapshot,assertBackupSnapshotUnchanged} from '../../scripts/create-three-live-backups.mjs';
const opt='PGOPTIONS=-c default_transaction_read_only=on -c lock_timeout=10000 -c statement_timeout=0';
test('backup boundary permits dumps and decode-to-null; rejects restore execution or service mutations',()=>{
 for(const args of [['ps','-aq'],['inspect','source'],['exec','-e',opt,'db','pg_dump','-U','fixture','-d','fixture','--format=custom','--no-password','--lock-wait-timeout=10s'],['exec','-i','db','pg_restore','--list'],['exec','-i','db','pg_restore','--file=/dev/null'],['exec','-e',opt,'db','psql','-X','-U','fixture','-d','fixture','-At','-v','ON_ERROR_STOP=1','-c','SELECT 1']])assert.doesNotThrow(()=>assertBackupDockerCommand(args));
 for(const args of [['stop','paper'],['compose','up','-d'],['exec','-i','db','pg_restore','-d','fixture'],['exec','db','psql','-c','DROP TABLE history'],['exec','-e',opt,'db','pg_dump','-U','fixture','-d','fixture','--file=/data/overwrite'],['exec','-e',opt,'db','psql','-X','-U','fixture','-d','fixture','-At','-v','ON_ERROR_STOP=1','-c','SELECT 1; DELETE FROM history']])assert.throws(()=>assertBackupDockerCommand(args),/BACKUP_COMMAND_REFUSED/);
});
test('backup snapshot accepts mount enumeration order but rejects source, permissions and restart drift',()=>{
 const c={Name:'/fixture',Id:'abc',Image:'same',State:{Running:true,StartedAt:'unchanged'},RestartCount:0,Config:{Env:['PRIVATE=not-output']},HostConfig:{RestartPolicy:{Name:'no'}},Mounts:[{Destination:'/a',Source:'/original',RW:false},{Destination:'/b',Source:'/data',RW:true}],NetworkSettings:{Networks:{net:{Aliases:['a','b']}}}};
 const initial=backupSnapshot([c]),reordered=structuredClone(c);reordered.Mounts.reverse();reordered.NetworkSettings.Networks.net.Aliases.reverse();assertBackupSnapshotUnchanged(initial,backupSnapshot([reordered]));assert.ok(!JSON.stringify(initial).includes('PRIVATE'));
 for(const change of [v=>v.Mounts[0].Source='/changed',v=>v.Mounts[0].RW=true,v=>v.State.StartedAt='new',v=>v.RestartCount++,v=>v.Config.Env=[]]){const changed=structuredClone(c);change(changed);assert.throws(()=>assertBackupSnapshotUnchanged(initial,backupSnapshot([changed])));}
});
