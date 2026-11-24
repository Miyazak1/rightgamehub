import pg from 'pg';
import {PostgresAgentRuntimeRepository} from './agent-runtime-repository.mjs';
import {createAgentRuntimePolicyService} from './agent-runtime-policy-service.mjs';
import {PostgresAgentToolGatewayRepository} from './agent-tool-gateway-repository.mjs';
import {createAgentToolGateway} from './agent-tool-gateway.mjs';
import {PostgresAgentProviderGatewayRepository} from './agent-provider-gateway-repository.mjs';
import {createAgentProviderGateway} from './agent-provider-gateway.mjs';
import {createAgentSecretVault} from './agent-secret-vault.mjs';
import {createAgentDeepSeekProviderAdapter} from './agent-deepseek-provider-adapter.mjs';
import {PostgresAgentRuntimeStageArtifactRepository} from './agent-runtime-stage-artifact-repository.mjs';

export function createAgentRuntimeServices({env=process.env,pool:suppliedPool,applicationName='mooyu-agent',providerAdapter=null,responseSchemas={},toolConfiguration={}}={}){
 if(!env.DATABASE_URL&&!suppliedPool)throw new Error('DATABASE_URL is required');if(!env.AGENT_SECRET_ENCRYPTION_KEY)throw new Error('AGENT_SECRET_ENCRYPTION_KEY is required');
 const ownsPool=!suppliedPool,pool=suppliedPool??new pg.Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:30000,query_timeout:35000,lock_timeout:5000,application_name:applicationName,ssl:env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
 if(ownsPool)pool.on('error',e=>process.stderr.write(JSON.stringify({service:applicationName,event:'database-unavailable',code:e.code??'DATABASE_UNAVAILABLE'})+'\n'));
 const runtimeRepository=new PostgresAgentRuntimeRepository(pool),policyService=createAgentRuntimePolicyService({pool});
 const toolGateway=createAgentToolGateway({runtimeRepository,toolRepository:new PostgresAgentToolGatewayRepository(pool),policyService,adapters:toolConfiguration.adapters??{},inputSchemas:toolConfiguration.inputSchemas??{},outputSchemas:toolConfiguration.outputSchemas??{}});
 const providerGateway=createAgentProviderGateway({runtimeRepository,governanceRepository:new PostgresAgentProviderGatewayRepository(pool),policyService,secretVault:createAgentSecretVault({masterKey:env.AGENT_SECRET_ENCRYPTION_KEY}),adapters:{deepseek:providerAdapter??createAgentDeepSeekProviderAdapter()},responseSchemas});
 return Object.freeze({pool,runtimeRepository,policyService,toolGateway,providerGateway,artifactRepository:new PostgresAgentRuntimeStageArtifactRepository(pool),close:async()=>{if(ownsPool)await pool.end();}});
}
