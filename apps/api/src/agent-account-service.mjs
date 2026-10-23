import crypto from 'node:crypto';
import {AgentAccountError} from './agent-account-repository.mjs';
import {stableHash} from './researcher-qa-protocol/stable-json.mjs';
const fail=code=>{throw new AgentAccountError(code);};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v))fail('AGENT_INPUT');return v;};
const text=(v,min,max)=>{if(typeof v!=='string'||v.trim()!==v||v.length<min||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('AGENT_INPUT');return v;};
const allowedCapabilities=new Set(['research:qa','blog:auto-publish']);
const caps=v=>{if(!Array.isArray(v)||new Set(v).size!==v.length||v.some(x=>!allowedCapabilities.has(x)))fail('AGENT_CAPABILITY_DENIED');return [...v].sort();};
export function createAgentAccountService({repository,authorizeOperator}){
 if(typeof authorizeOperator!=='function')fail('AGENT_OPERATOR_PORT_REQUIRED');
 async function operator(actor){const copy=structuredClone(actor);uuid(copy?.userId);if(await authorizeOperator(structuredClone(copy))!==true)fail('AGENT_OPERATOR_REQUIRED');return copy.userId;}
 return {
  async list(actor){return repository.list(await operator(actor));},
  async provision(actor,input){input=structuredClone(input);const id=await operator(actor),v={provisionKey:text(input.provisionKey,8,100),displayName:text(input.displayName,1,120),handle:text(input.handle,3,32).toLowerCase(),badgeLabel:input.badgeLabel,operatorLabel:text(input.operatorLabel,1,120),capabilities:caps(input.capabilities??[]),metadata:input.metadata??{}};if(!/^[a-z][a-z0-9-]{2,31}$/.test(v.handle)||['admin','api','me','login','profile','settings','support'].includes(v.handle)||!['AI 助手','官方机器人'].includes(v.badgeLabel)||!v.metadata||Array.isArray(v.metadata)||typeof v.metadata!=='object'||Buffer.byteLength(JSON.stringify(v.metadata))>4096)fail('AGENT_INPUT');return repository.provision(id,{...v,digest:stableHash({operator:id,...v})});},
  async suspend(actor,agentUserId){return repository.suspend(await operator(actor),uuid(agentUserId));},
  async rotate(actor,input){input=structuredClone(input);const id=await operator(actor),v={agentUserId:uuid(input.agentUserId),rotationKey:text(input.rotationKey,8,100),keyId:text(input.keyId,8,100),verifierHash:input.verifierHash,capabilities:caps(input.capabilities??[])};if(!/^[a-zA-Z0-9_-]+$/.test(v.keyId)||typeof v.verifierHash!=='string'||!/^[a-f0-9]{64}$/.test(v.verifierHash))fail('AGENT_INPUT');return repository.rotate(id,{...v,digest:stableHash({operator:id,...v})});},
  async revoke(actor,{agentUserId,executionPrincipalId}){return repository.revoke(await operator(actor),uuid(agentUserId),uuid(executionPrincipalId));},
  async authenticatePrincipal(input){input=structuredClone(input);uuid(input.agentUserId);uuid(input.executionPrincipalId);text(input.keyId,8,100);if(typeof input.secret!=='string'||input.secret.length<32||input.secret.length>512)fail('AGENT_PRINCIPAL_DENIED');const digest=crypto.createHash('sha256').update(input.secret).digest();return repository.authenticate({agentUserId:input.agentUserId,executionPrincipalId:input.executionPrincipalId,keyId:input.keyId,digest});}
 };
}
