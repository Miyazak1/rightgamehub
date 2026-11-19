import {readFile} from 'node:fs/promises';
import pg from '../../apps/qq-channel/node_modules/pg/lib/index.js';
import {parseConfig} from '../../apps/qq-channel/src/config.mjs';
import {QQRepository} from '../../apps/qq-channel/src/repository.mjs';
const config=parseConfig(JSON.parse(await readFile('/config/config.json','utf8')),process.env);
const pool=new pg.Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:2000,query_timeout:2000});
try{
 const health=await fetch('http://127.0.0.1:'+config.port+'/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());
 if(health.service!=='mooyu-qq-local')throw Error();
 const repository=new QQRepository(pool,config);repository.control=process.env.QQ_ADMIN_ENABLED==='true';await repository.check();
 // The health check detects DB/service failure; QQ offline is reported by status,
 // and must not be treated as an excuse to restart the account repeatedly.
 console.log(JSON.stringify({database:true,service:true,qqConnected:health.connected}));
}catch{console.error('QQ_SERVICE_OR_DATABASE_UNAVAILABLE');process.exitCode=1;}
finally{await pool.end();}
