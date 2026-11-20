import pg from 'pg';
import {loadAgentInteractionConfig} from './agent-interaction-config.mjs';
import {PostgresAgentInteractionRepository} from './agent-interaction-repository.mjs';
import {PostgresAgentRuntimeRepository} from './agent-runtime-repository.mjs';
import {bootstrapAgentInteractions} from './agent-interaction-bootstrap.mjs';
const config=loadAgentInteractionConfig(process.env);
if(!config.enabled||!process.env.DATABASE_URL)throw new Error('AGENT_INTERACTION_BOOTSTRAP_CONFIG_REQUIRED');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
try{process.stdout.write(JSON.stringify(await bootstrapAgentInteractions({repository:new PostgresAgentInteractionRepository(pool),runtimeRepository:new PostgresAgentRuntimeRepository(pool),agentId:config.agentId}))+'\n');}finally{await pool.end();}
