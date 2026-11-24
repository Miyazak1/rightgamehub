import test from 'node:test';import assert from 'node:assert/strict';
import {assessOutboxWindow,legacyQQParticipantStatements} from '../../scripts/agent-server-cutover.mjs';
test('missing, malformed or inconsistent outbox proof is never an idle window',()=>{
 for(const proof of [null,{}, {total:'11',retainedCompleted:11},{total:11,retainedCompleted:12},{total:-1,retainedCompleted:0},{total:1,retainedCompleted:0.5},{total:Infinity,retainedCompleted:0}])assert.throws(()=>assessOutboxWindow(proof),/INVALID_OUTBOX_WINDOW_PROOF/);
 assert.equal(assessOutboxWindow({total:12,retainedCompleted:11}).blocking,1);
 assert.equal(assessOutboxWindow({total:0,retainedCompleted:0}).blocking,0);
});
test('legacy adoption includes both actors, preserves existing decisions and fails closed on malformed policy',()=>{
 const agent='c98abda1-d115-4e05-9c2e-43f68119386a',policy={enabled:true,allowedUsers:['495469022','52399347']};
 const sql=legacyQQParticipantStatements(agent,[policy]);assert.equal(sql.length,2);
 for(const [i,s]of sql.entries()){assert(s.includes("'"+policy.allowedUsers[i]+"'"));assert(s.endsWith('DO NOTHING'));assert(!/DO UPDATE|agent_capability_grants|admin/.test(s));}
 for(const bad of [[],[policy,policy],[{...policy,enabled:'true'}],[{...policy,allowedUsers:[]}],[{...policy,allowedUsers:['495469022','495469022']}],[{...policy,allowedUsers:["495469022';DELETE"]}],[{...policy,allowedUsers:[495469022]}]])assert.throws(()=>legacyQQParticipantStatements(agent,bad),/LEGACY_QQ_ALLOWLIST_REVIEW_REQUIRED/);
 assert(legacyQQParticipantStatements(agent,[{...policy,enabled:false}]).every(s=>s.includes(",false,'active'")));
});
