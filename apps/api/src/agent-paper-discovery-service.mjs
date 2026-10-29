import crypto from 'node:crypto';
import { stableHash } from './researcher-qa-protocol/stable-json.mjs';
import { normalizeDiscoveryCandidate, normalizeDiscoveryQuery, normalizePaperAuthors,
  normalizePaperTitle, queueStateForResolution, resolvePaperIdentity }
  from './agent-paper-discovery-contracts.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_RESPONSE_BYTES = 524288;
const errors = {
  PAPER_DISCOVERY_INPUT_INVALID: [400, '论文发现参数无效。'],
  PAPER_DISCOVERY_OPERATOR_REQUIRED: [403, '需要管理员权限。'],
  PAPER_DISCOVERY_AGENT_NOT_FOUND: [404, '机器人不存在或不属于当前运营者。'],
  PAPER_DISCOVERY_INTAKE_NOT_FOUND: [404, '私有收件不存在或尚未通过。'],
  PAPER_DISCOVERY_NOT_FOUND: [404, '没有找到符合条件的论文候选。'],
  PAPER_DISCOVERY_UPSTREAM_FAILED: [502, '论文元数据服务暂不可用。'],
  PAPER_DISCOVERY_METADATA_INVALID: [422, '论文元数据不完整或超出限制。'],
  PAPER_DISCOVERY_CONFLICT: [409, '幂等请求与已有发现条件冲突。'],
  PAPER_DISCOVERY_QUEUE_NOT_FOUND: [404, '私有研究队列项目不存在。'],
  PAPER_DISCOVERY_QUEUE_TRANSITION_INVALID: [409, '私有研究队列状态切换无效。'],
};
export class AgentPaperDiscoveryServiceError extends Error {
  constructor(code, details = {}) { const entry = errors[code] ?? [409, '论文发现失败。'];
    super(`${code}: ${entry[1]}`); this.name = 'AgentPaperDiscoveryServiceError'; this.code = code;
    this.statusCode = entry[0]; this.retryable = this.statusCode >= 500; this.details = details; }
}
const fail = (code, details) => { throw new AgentPaperDiscoveryServiceError(code, details); };
const asUuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('PAPER_DISCOVERY_INPUT_INVALID'); return value.toLowerCase(); };
const iso = value => value?.toISOString?.() ?? value ?? null;
const json = value => JSON.stringify(value);
const decodeXml = value => value.replace(/&#x([0-9a-f]+);/giu,(_,v)=>String.fromCodePoint(Number.parseInt(v,16)))
  .replace(/&#(\d+);/gu,(_,v)=>String.fromCodePoint(Number(v))).replace(/&lt;/gu,'<').replace(/&gt;/gu,'>')
  .replace(/&quot;/gu,'"').replace(/&apos;/gu,"'").replace(/&amp;/gu,'&');
const xmlElement = (xml, name) => { const match=xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'iu'));
  return match?decodeXml(match[1].replace(/<[^>]+>/gu,' ').replace(/\s+/gu,' ').trim()):null; };

async function responseBytes(response) {
  const length=response.headers.get('content-length');
  if(length&&(!/^\d+$/u.test(length)||Number(length)>MAX_RESPONSE_BYTES)) fail('PAPER_DISCOVERY_METADATA_INVALID');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength>MAX_RESPONSE_BYTES) fail('PAPER_DISCOVERY_METADATA_INVALID');
  return bytes;
}
async function request(url, accept, fetchImpl) {
  let response;
  try { response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Accept:accept,'User-Agent':'GameHub-Agent-Paper-Discovery/1.0'}}); }
  catch(error){ fail('PAPER_DISCOVERY_UPSTREAM_FAILED',{cause:error?.message??'network'}); }
  if(response.status===404) fail('PAPER_DISCOVERY_NOT_FOUND');
  if(!response.ok) fail('PAPER_DISCOVERY_UPSTREAM_FAILED',{status:response.status});
  return responseBytes(response);
}
function crossrefItem(item, fallbackDoi = null) {
  const title=item?.title?.find?.(value=>typeof value==='string'&&value.trim());
  const authors=(Array.isArray(item?.author)?item.author:[]).map(author=>[author?.given,author?.family]
    .filter(value=>typeof value==='string'&&value.trim()).join(' ').trim()).filter(Boolean).slice(0,200);
  const parts=item?.issued?.['date-parts']?.[0]??item?.published?.['date-parts']?.[0]??[];
  const publicationYear=Number(parts[0]); const doi=typeof item?.DOI==='string'?item.DOI:fallbackDoi;
  const venue=item?.['container-title']?.find?.(value=>typeof value==='string'&&value.trim())??null;
  return normalizeDiscoveryCandidate({sourceKind:'crossref',externalKey:`doi:${doi}`,doi,title,authors,
    publicationYear,venue,metadata:{type:item?.type??null},provenance:{provider:'crossref',retrievedAt:new Date().toISOString()}});
}
function arxivItem(xml, requestedId) {
  if(/<!DOCTYPE|<!ENTITY/iu.test(xml)) fail('PAPER_DISCOVERY_METADATA_INVALID');
  const entry=xml.match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/iu)?.[1];
  if(!entry) fail('PAPER_DISCOVERY_NOT_FOUND');
  const resolved=xmlElement(entry,'id')?.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/abs\//iu,'').toLowerCase();
  const authors=[...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/giu)]
    .map(match=>xmlElement(match[1],'name')).filter(Boolean);
  const published=xmlElement(entry,'published'); const year=new Date(published).getUTCFullYear();
  const doi=xmlElement(entry,'arxiv:doi');
  return normalizeDiscoveryCandidate({sourceKind:'arxiv',externalKey:`arxiv:${resolved}`,arxivId:resolved??requestedId,
    doi,title:xmlElement(entry,'title'),authors,publicationYear:year,venue:xmlElement(entry,'arxiv:journal_ref'),
    metadata:{abstract:xmlElement(entry,'summary')?.slice(0,12000)??null},
    provenance:{provider:'arxiv',retrievedAt:new Date().toISOString()}});
}
const runView = row => ({id:row.id,requestId:row.request_id,kind:row.query_kind,query:row.query_json,
  status:row.status,providerRequests:Number(row.provider_requests),candidateCount:Number(row.candidate_count),
  failureCode:row.failure_code,createdAt:iso(row.created_at)});
const candidateView = row => ({id:row.id,sourceKind:row.source_kind,externalKey:row.external_key,
  doi:row.canonical_doi,arxivId:row.arxiv_id,localDocumentId:row.local_document_id,title:row.title,
  authors:row.authors,publicationYear:row.publication_year,venue:row.venue,metadata:row.metadata_json,
  provenance:row.provenance_json,candidateSha256:row.candidate_sha256,resolution:row.decision?{
    decision:row.decision,paperIdentityId:row.paper_identity_id,paperVersionId:row.paper_version_id,
    matchBasis:row.match_basis,explanation:row.decision_json}:null,queue:row.queue_item_id?{
    id:row.queue_item_id,state:row.queue_state,priority:Number(row.queue_priority)}:null});
const queueView = row => ({id:row.id,state:row.state,priority:Number(row.priority),reason:row.reason,
  paperIdentityId:row.paper_identity_id,candidate:{id:row.source_candidate_id,title:row.title,authors:row.authors,
    publicationYear:row.publication_year,doi:row.canonical_doi,arxivId:row.arxiv_id,
    localDocumentId:row.local_document_id,sourceKind:row.source_kind},createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)});

export function createAgentPaperDiscoveryService({pool,fetchImpl=globalThis.fetch,authorizeOperator}={}) {
  if(!pool||typeof fetchImpl!=='function'||typeof authorizeOperator!=='function') fail('PAPER_DISCOVERY_INPUT_INVALID');
  const scope=async(actor,agentUserId)=>{const operatorId=asUuid(actor?.userId);
    if(await authorizeOperator(structuredClone(actor))!==true) fail('PAPER_DISCOVERY_OPERATOR_REQUIRED');
    const row=(await pool.query(`SELECT user_id FROM agent_accounts WHERE user_id=$1 AND operator_user_id=$2 AND status='active'`,
      [asUuid(agentUserId),operatorId])).rows[0]; if(!row) fail('PAPER_DISCOVERY_AGENT_NOT_FOUND');
    return {agentUserId:row.user_id,operatorId};};
  const fetchCandidates=async(query,agentUserId)=>{
    if(query.kind==='private-intake'){
      const row=(await pool.query(`SELECT intake.*,identity.title,identity.authors,identity.publication_year,identity.venue,
          identity.doi,identity.arxiv_id FROM agent_paper_private_intakes intake JOIN agent_paper_identities identity
          ON identity.id=intake.paper_identity_id AND identity.agent_user_id=intake.agent_user_id
        WHERE intake.id=$1 AND intake.agent_user_id=$2 AND intake.status='accepted'`,[query.intakeId,agentUserId])).rows[0];
      if(!row) fail('PAPER_DISCOVERY_INTAKE_NOT_FOUND');
      return {providerRequests:0,candidates:[normalizeDiscoveryCandidate({sourceKind:'private-intake',
        externalKey:`intake:${row.id}`,doi:row.doi,arxivId:row.arxiv_id,localDocumentId:row.content_sha256,
        title:row.title,authors:row.authors,publicationYear:row.publication_year,venue:row.venue,
        metadata:{intakeId:row.id,paperVersionId:row.paper_version_id},provenance:{provider:'private-intake',intakeId:row.id}})]};
    }
    if(query.kind==='arxiv'){
      const bytes=await request(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(query.arxivId)}`,'application/atom+xml',fetchImpl);
      let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('PAPER_DISCOVERY_METADATA_INVALID');}
      return {providerRequests:1,candidates:[arxivItem(xml,query.arxivId)]};
    }
    const url=query.kind==='doi'?`https://api.crossref.org/works/${encodeURIComponent(query.doi)}`:
      `https://api.crossref.org/works?query.title=${encodeURIComponent(query.title)}&query.author=${encodeURIComponent(query.author)}&rows=8&select=DOI,title,author,issued,published,container-title,type`;
    const bytes=await request(url,'application/json',fetchImpl);let payload;
    try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('PAPER_DISCOVERY_METADATA_INVALID');}
    const items=query.kind==='doi'?[payload?.message]:(payload?.message?.items??[]).slice(0,8);
    if(items.length===0) fail('PAPER_DISCOVERY_NOT_FOUND');
    try{return {providerRequests:1,candidates:items.map(item=>crossrefItem(item,query.kind==='doi'?query.doi:null))};}catch{fail('PAPER_DISCOVERY_METADATA_INVALID');}
  };
  const identityEvidence=async(client,agentUserId,candidate)=>{
    const identifiers=[['doi',candidate.doi],['arxiv',candidate.arxivId],['local-sha256',candidate.localDocumentId]].filter(([,value])=>value);
    const identifierMatches=[];
    if(identifiers.length){
      const rows=(await client.query(`SELECT alias.paper_identity_id AS identity_id,alias.namespace AS basis
        FROM agent_paper_identity_aliases alias WHERE alias.agent_user_id=$1 AND (alias.namespace,alias.normalized_value) IN
        (SELECT * FROM unnest($2::text[],$3::text[])) UNION SELECT identity.id AS identity_id,'doi' AS basis
        FROM agent_paper_identities identity WHERE identity.agent_user_id=$1 AND identity.doi=$4 UNION
        SELECT identity.id AS identity_id,'arxiv' AS basis FROM agent_paper_identities identity
        WHERE identity.agent_user_id=$1 AND identity.arxiv_id=$5 UNION SELECT identity.id AS identity_id,'local-sha256' AS basis
        FROM agent_paper_identities identity WHERE identity.agent_user_id=$1 AND identity.local_document_id=$6`,
      [agentUserId,identifiers.map(item=>item[0]),identifiers.map(item=>item[1]),candidate.doi,candidate.arxivId,candidate.localDocumentId])).rows;
      identifierMatches.push(...rows.map(row=>({identityId:row.identity_id,basis:row.basis==='local-sha256'?'content-sha256':row.basis})));
    }
    const versionMatch=candidate.localDocumentId?(await client.query(`SELECT version.id AS version_id,identity.id AS identity_id
      FROM agent_paper_versions version JOIN agent_paper_identities identity ON identity.id=version.paper_identity_id
      WHERE identity.agent_user_id=$1 AND version.content_sha256=$2 LIMIT 2`,[agentUserId,candidate.localDocumentId])).rows[0]:null;
    const possible=(await client.query(`SELECT id,title,authors,publication_year FROM agent_paper_identities
      WHERE agent_user_id=$1 AND publication_year=$2 LIMIT 50`,[agentUserId,candidate.publicationYear])).rows.filter(row=>{
        try{return normalizePaperTitle(row.title).fingerprint===candidate.titleFingerprint&&
          normalizePaperAuthors(row.authors).fingerprint===candidate.authorFingerprint;}catch{return false;}})
      .map(row=>({identityId:row.id}));
    return {identifierMatches,versionMatch:versionMatch?{identityId:versionMatch.identity_id,versionId:versionMatch.version_id}:null,
      fingerprintMatches:possible};
  };
  const list=async(actor,agentUserId,limit=25)=>{const scoped=await scope(actor,agentUserId);
    const runs=(await pool.query(`SELECT * FROM agent_paper_discovery_runs WHERE agent_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,
      [scoped.agentUserId,Math.min(100,Math.max(1,Number(limit)||25))])).rows;
    if(!runs.length)return [];
    const candidates=(await pool.query(`SELECT candidate.*,resolution.decision,resolution.paper_identity_id,resolution.paper_version_id,
      resolution.match_basis,resolution.decision_json,queue.id AS queue_item_id,queue.state AS queue_state,queue.priority AS queue_priority
      FROM agent_paper_discovery_candidates candidate LEFT JOIN agent_paper_identity_resolutions resolution ON resolution.candidate_id=candidate.id
      LEFT JOIN agent_paper_research_queue_items queue ON queue.source_candidate_id=candidate.id
      WHERE candidate.run_id=ANY($1::uuid[]) ORDER BY candidate.run_id,candidate.ordinal`,[runs.map(row=>row.id)])).rows;
    return runs.map(row=>({...runView(row),candidates:candidates.filter(item=>item.run_id===row.id).map(candidateView)}));};
  const discover=async(actor,agentUserId,input)=>{const scoped=await scope(actor,agentUserId);let query;
    try{query=normalizeDiscoveryQuery(input);}catch(error){fail(error.code??'PAPER_DISCOVERY_INPUT_INVALID');}
    const requestId=input?.requestId?asUuid(input.requestId):crypto.randomUUID(); const queryHash=stableHash(query);
    const prior=(await pool.query(`SELECT * FROM agent_paper_discovery_runs WHERE agent_user_id=$1 AND request_id=$2`,
      [scoped.agentUserId,requestId])).rows[0];
    if(prior){if(prior.query_sha256!==queryHash)fail('PAPER_DISCOVERY_CONFLICT');
      if(prior.status==='blocked')fail(prior.failure_code,{runId:prior.id});
      return (await list(actor,agentUserId,100)).find(run=>run.id===prior.id);}
    let discovered;
    try{discovered=await fetchCandidates(query,scoped.agentUserId);}catch(error){
      const code=typeof error?.code==='string'&&error.code.length<=120?error.code:'PAPER_DISCOVERY_UPSTREAM_FAILED';
      await pool.query(`INSERT INTO agent_paper_discovery_runs(id,agent_user_id,operator_user_id,request_id,query_kind,query_json,
        query_sha256,status,provider_requests,candidate_count,failure_code) VALUES($1,$2,$3,$4,$5,$6,$7,'blocked',0,0,$8)
        ON CONFLICT(agent_user_id,request_id) DO NOTHING`,[crypto.randomUUID(),scoped.agentUserId,scoped.operatorId,requestId,
        query.kind,json(query),queryHash,code]);throw error;
    }
    const client=await pool.connect(); const runId=crypto.randomUUID();
    try{await client.query('BEGIN');
      await client.query(`INSERT INTO agent_paper_discovery_runs(id,agent_user_id,operator_user_id,request_id,query_kind,query_json,
        query_sha256,status,provider_requests,candidate_count) VALUES($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9)`,
      [runId,scoped.agentUserId,scoped.operatorId,requestId,query.kind,json(query),queryHash,discovered.providerRequests,discovered.candidates.length]);
      for(let index=0;index<discovered.candidates.length;index+=1){const candidate=discovered.candidates[index]; const candidateId=crypto.randomUUID();
        await client.query(`INSERT INTO agent_paper_discovery_candidates(id,run_id,agent_user_id,ordinal,source_kind,external_key,
          canonical_doi,arxiv_id,local_document_id,title,normalized_title,title_fingerprint,authors,author_fingerprint,
          publication_year,venue,metadata_json,provenance_json,candidate_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [candidateId,runId,scoped.agentUserId,index+1,candidate.sourceKind,candidate.externalKey,candidate.doi,candidate.arxivId,
          candidate.localDocumentId,candidate.title,candidate.normalizedTitle,candidate.titleFingerprint,json(candidate.authors),
          candidate.authorFingerprint,candidate.publicationYear,candidate.venue,json(candidate.metadata),json(candidate.provenance),candidate.candidateSha256]);
        const resolution=resolvePaperIdentity(candidate,await identityEvidence(client,scoped.agentUserId,candidate));
        const decision={reason:resolution.reason,automaticMerge:false,modelUsed:false};
        await client.query(`INSERT INTO agent_paper_identity_resolutions(id,agent_user_id,candidate_id,decision,paper_identity_id,
          paper_version_id,match_basis,decision_json,decision_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [crypto.randomUUID(),scoped.agentUserId,candidateId,resolution.decision,resolution.identityId,resolution.versionId,
          resolution.matchBasis,json(decision),stableHash(decision)]);
        if(resolution.identityId) for(const [namespace,value] of [['doi',candidate.doi],['arxiv',candidate.arxivId],['local-sha256',candidate.localDocumentId]]) if(value){
          await client.query(`INSERT INTO agent_paper_identity_aliases(id,agent_user_id,paper_identity_id,namespace,normalized_value,
            source_candidate_id,evidence_json) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(agent_user_id,namespace,normalized_value) DO NOTHING`,
          [crypto.randomUUID(),scoped.agentUserId,resolution.identityId,namespace,value,candidateId,json({basis:'deterministic-resolution',runId})]);}
        const state=queueStateForResolution(resolution); const queueKey=stableHash({agentUserId:scoped.agentUserId,
          identityId:resolution.identityId??null,candidate:resolution.identityId?null:{doi:candidate.doi,arxivId:candidate.arxivId,
            localDocumentId:candidate.localDocumentId,titleFingerprint:candidate.titleFingerprint,
            authorFingerprint:candidate.authorFingerprint,publicationYear:candidate.publicationYear}}); const queueId=crypto.randomUUID();
        const inserted=(await client.query(`INSERT INTO agent_paper_research_queue_items(id,agent_user_id,source_candidate_id,paper_identity_id,
          queue_key,state,priority,reason) VALUES($1,$2,$3,$4,$5,$6,50,$7) ON CONFLICT(agent_user_id,queue_key) DO NOTHING RETURNING id`,
        [queueId,scoped.agentUserId,candidateId,resolution.identityId,queueKey,state,resolution.reason])).rows[0];
        if(inserted)await client.query(`INSERT INTO agent_paper_research_queue_events(id,queue_item_id,agent_user_id,operator_user_id,
          previous_state,next_state,reason) VALUES($1,$2,$3,$4,NULL,$5,$6)`,[crypto.randomUUID(),queueId,scoped.agentUserId,
          scoped.operatorId,state,`discovery:${resolution.reason}`]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return (await list(actor,agentUserId,100)).find(run=>run.id===runId);
  };
  const listQueue=async(actor,agentUserId,limit=50)=>{const scoped=await scope(actor,agentUserId);
    return (await pool.query(`SELECT item.*,candidate.title,candidate.authors,candidate.publication_year,candidate.canonical_doi,
      candidate.arxiv_id,candidate.local_document_id,candidate.source_kind FROM agent_paper_research_queue_items item
      JOIN agent_paper_discovery_candidates candidate ON candidate.id=item.source_candidate_id
      WHERE item.agent_user_id=$1 ORDER BY CASE item.state WHEN 'queued' THEN 0 WHEN 'paused' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
      item.priority DESC,item.created_at LIMIT $2`,[scoped.agentUserId,Math.min(100,Math.max(1,Number(limit)||50))])).rows.map(queueView);};
  const transition=async(actor,agentUserId,queueItemId,{state,reason})=>{const scoped=await scope(actor,agentUserId);asUuid(queueItemId);
    if(!['queued','paused','rejected'].includes(state)||typeof reason!=='string'||reason.trim().length<3||reason.trim().length>1000)
      fail('PAPER_DISCOVERY_QUEUE_TRANSITION_INVALID'); const client=await pool.connect();
    try{await client.query('BEGIN');const prior=(await client.query(`SELECT * FROM agent_paper_research_queue_items
      WHERE id=$1 AND agent_user_id=$2 FOR UPDATE`,[queueItemId,scoped.agentUserId])).rows[0];
      if(!prior)fail('PAPER_DISCOVERY_QUEUE_NOT_FOUND');
      try{await client.query(`UPDATE agent_paper_research_queue_items SET state=$3,reason=$4 WHERE id=$1 AND agent_user_id=$2`,
        [queueItemId,scoped.agentUserId,state,reason.trim()]);}catch(error){if(error.message?.includes('invalid paper queue transition'))
          fail('PAPER_DISCOVERY_QUEUE_TRANSITION_INVALID');throw error;}
      await client.query(`INSERT INTO agent_paper_research_queue_events(id,queue_item_id,agent_user_id,operator_user_id,
        previous_state,next_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),queueItemId,scoped.agentUserId,
          scoped.operatorId,prior.state,state,reason.trim()]);await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    return (await listQueue(actor,agentUserId,100)).find(item=>item.id===queueItemId);};
  return {list,discover,listQueue,transition};
}
