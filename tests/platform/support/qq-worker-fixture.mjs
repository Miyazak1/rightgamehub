// Isolated crash fixture only. The production CLI has no fake-model option.
import {createRequire} from 'node:module';
import {parseConfig} from '../../../apps/qq-channel/src/config.mjs';
import {QQRepository} from '../../../apps/qq-channel/src/repository.mjs';
import {QQService} from '../../../apps/qq-channel/src/service.mjs';
const {Pool}=createRequire(new URL('../../../apps/qq-channel/package.json',import.meta.url))('pg');
if(process.env.QA_LEDGER_TEST_ISOLATED!=='1')throw Error('ISOLATION_REQUIRED');
const config=parseConfig(JSON.parse(process.env.QQ_TEST_CONFIG),process.env);
const pool=new Pool({connectionString:config.databaseUrl}),repository=new QQRepository(pool,config);
const service=new QQService({config,repository,
 provider:async()=>({reply:'Isolated fixture response',usage:{inputTokens:3,outputTokens:3}}),
 gateway:{connected:()=>true,send:async()=>{console.log('FIXTURE_SENT');return '77';}},
 fault:async point=>{if(point===process.argv[2]){console.log('FIXTURE_CRASH_'+point);process.exit(37);}},
});
try{await service.tick();}finally{await pool.end();}
