const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const harness=require('./support/researcher-qa-db.cjs');

const crossref=message=>new Response(JSON.stringify({message}),{status:200,headers:{'content-type':'application/json'}});

test('R1.7 discovery resolves exact identity, deduplicates queue and audits transitions in PostgreSQL',
  {skip:!harness.enabled},async()=>{
    const{admin}=await harness.setup();
    const{createAgentAccountService}=await harness.load('agent-account-service.mjs');
    const{PostgresAgentAccountRepository}=await harness.load('agent-account-repository.mjs');
    const{createAgentPaperDiscoveryService}=await harness.load('agent-paper-discovery-service.mjs');
    const operatorId=crypto.randomUUID();
    await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Discovery operator','admin')",[operatorId]);
    const account=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true})
      .provision({userId:operatorId},{provisionKey:`paper-discovery-${crypto.randomUUID()}`,displayName:'Paper discovery agent',
        handle:`paper-discovery-${crypto.randomBytes(5).toString('hex')}`,badgeLabel:'AI 助手',operatorLabel:'DB test',
        capabilities:['blog:auto-publish'],metadata:{}});
    const identityId=crypto.randomUUID();
    await admin.query(`INSERT INTO agent_paper_identities(id,agent_user_id,canonical_id,doi,arxiv_id,local_document_id,
      title,authors,publication_year,venue,identity_confidence) VALUES($1,$2,'doi:10.5555/r17','10.5555/r17',NULL,NULL,
      'Reliable Identity Resolution',$3,2026,'Fixture Journal','confirmed')`,[identityId,account.agentUserId,JSON.stringify(['Ada Example'])]);
    await admin.query(`INSERT INTO agent_paper_identity_aliases(id,agent_user_id,paper_identity_id,namespace,normalized_value,evidence_json)
      VALUES($1,$2,$3,'doi','10.5555/r17','{"source":"test"}')`,[crypto.randomUUID(),account.agentUserId,identityId]);
    const payload={title:['Reliable Identity Resolution'],author:[{given:'Ada',family:'Example'}],
      issued:{'date-parts':[[2026]]},'container-title':['Fixture Journal'],type:'journal-article'};
    const service=createAgentPaperDiscoveryService({pool:admin,authorizeOperator:async()=>true,fetchImpl:async()=>crossref(payload)});
    const actor={userId:operatorId};const requestId=crypto.randomUUID();
    const first=await service.discover(actor,account.agentUserId,{kind:'doi',doi:'10.5555/r17',requestId});
    assert.equal(first.candidates[0].resolution.decision,'exact-identity');
    assert.equal(first.candidates[0].resolution.paperIdentityId,identityId);
    assert.equal(first.candidates[0].queue.state,'queued');
    assert.equal((await service.discover(actor,account.agentUserId,{kind:'doi',doi:'10.5555/r17',requestId})).id,first.id);
    await assert.rejects(service.discover(actor,account.agentUserId,{kind:'doi',doi:'10.5555/changed',requestId}),
      error=>error.code==='PAPER_DISCOVERY_CONFLICT');
    await service.discover(actor,account.agentUserId,{kind:'doi',doi:'10.5555/r17',requestId:crypto.randomUUID()});
    const queue=await service.listQueue(actor,account.agentUserId);
    assert.equal(queue.length,1,'same identity must not be queued twice');
    const paused=await service.transition(actor,account.agentUserId,queue[0].id,{state:'paused',reason:'DB test pause'});
    assert.equal(paused.state,'paused');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM agent_paper_research_queue_events WHERE queue_item_id=$1',[queue[0].id])).rows[0].n,2);
    await assert.rejects(admin.query('DELETE FROM agent_paper_research_queue_items WHERE id=$1',[queue[0].id]));
    const otherOperator=crypto.randomUUID();await admin.query("INSERT INTO users(id,display_name,role) VALUES($1,'Other','admin')",[otherOperator]);
    const other=await createAgentAccountService({repository:new PostgresAgentAccountRepository(admin),authorizeOperator:async()=>true})
      .provision({userId:otherOperator},{provisionKey:`paper-other-${crypto.randomUUID()}`,displayName:'Other agent',
        handle:`paper-other-${crypto.randomBytes(5).toString('hex')}`,badgeLabel:'AI 助手',operatorLabel:'DB test',capabilities:['blog:auto-publish'],metadata:{}});
    await assert.rejects(admin.query(`INSERT INTO agent_paper_identity_aliases(id,agent_user_id,paper_identity_id,namespace,
      normalized_value,source_candidate_id,evidence_json) VALUES($1,$2,$3,'arxiv','2401.12345',$4,'{}')`,
      [crypto.randomUUID(),other.agentUserId,identityId,first.candidates[0].id]));
  });
