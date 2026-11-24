import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReadOnlyDocker,isOutsidePaperWorker} from '../../scripts/generate-agent-cutover-files.mjs';
test('generator boundary permits metadata/config/readonly SELECT and rejects service or database mutations',()=>{
 for(const args of [['inspect','api'],['image','inspect','sha256:abc'],['ps','-aq'],['compose','-f','/www/base.yml','--profile','*','config','--format','json'],['exec','-e','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000','db','psql','-c','SELECT count(*) FROM users']])assert.doesNotThrow(()=>assertReadOnlyDocker(args));
 for(const args of [['update','--restart=no','paper'],['stop','api'],['image','load','--input','images.tar'],['compose','up','config','--format','json'],['compose','up','-d'],['exec','db','pg_dump'],['exec','db','node','apps/api/src/migrate-cli.mjs'],['exec','db','psql','-c','SELECT 1'],['exec','-e','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000','db','psql','-c','SELECT 1; DELETE FROM users']])assert.throws(()=>assertReadOnlyDocker(args),/GENERATOR_MUTATING_DOCKER_COMMAND_REFUSED/);
});
test('generation still inventories closed paper workers by their Compose service identity',()=>{
 const c={Name:'/closed-paper',Config:{Entrypoint:['node','-e','process.exit(0)'],Cmd:null,Labels:{'com.docker.compose.service':'business-paper-worker'}}};
 assert.equal(isOutsidePaperWorker(c,[]),true);assert.equal(isOutsidePaperWorker(c,[{container:'closed-paper'}]),false);
 const other=structuredClone(c);other.Config.Labels['com.docker.compose.service']='business-api';assert.equal(isOutsidePaperWorker(other,[]),false);
});
