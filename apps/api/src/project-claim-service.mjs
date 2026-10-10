import crypto from 'node:crypto';

const withTransaction = async (pool, action) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const relationships = new Set(['owner','maintainer']);
const evidenceTypes = new Set(['github','website','storefront','other']);
const claimStatuses = new Set(['pending','verified','rejected','cancelled','disputed','suspended','revoked']);
const decisionActions = new Set(['approve','reject','dispute','suspend','restore','revoke']);
const normalizeRepositoryUrl = value => String(value ?? '').replace(/\.git\/?$/i,'').replace(/\/$/,'').toLowerCase();

export class ProjectClaimError extends Error {
  constructor(code, statusCode, message) { super(message); this.code = code; this.statusCode = statusCode; this.retryable = statusCode >= 500; }
}

const asIso = value => value ? new Date(value).toISOString() : null;
const claimView = row => ({
  id: row.id,
  workId: row.work_id,
  workTitle: row.work_title,
  claimantUserId: row.claimant_user_id,
  claimantDisplayName: row.claimant_display_name,
  claimantHandle: row.claimant_handle,
  relationship: row.relationship,
  status: row.status,
  evidenceType: row.evidence_type,
  evidenceUrl: row.evidence_url ?? null,
  repositoryId: row.repository_id == null ? null : String(row.repository_id),
  repositoryUrl: row.repository_url ?? null,
  applicantNote: row.applicant_note,
  decisionNote: row.decision_note,
  submittedAt: asIso(row.submitted_at),
  decidedAt: asIso(row.decided_at),
  verifiedAt: asIso(row.verified_at),
  suspendedAt: asIso(row.suspended_at),
  revokedAt: asIso(row.revoked_at),
  updatedAt: asIso(row.updated_at),
  version: String(row.version),
});

const publicView = (work, row) => ({
  workId: work.id,
  ingestionMethod: work.ingestion_method,
  attributionKind: work.attribution_kind,
  eligible: work.attribution_kind === 'community_catalog' && !row,
  status: row?.status ?? (work.attribution_kind === 'community_catalog' ? 'unclaimed' : 'publisher'),
  relationship: row?.status === 'verified' ? row.relationship : null,
  claimantDisplayName: row?.status === 'verified' ? row.claimant_display_name : null,
  claimantHandle: row?.status === 'verified' ? row.claimant_handle : null,
  verifiedAt: row?.status === 'verified' ? asIso(row.verified_at) : null,
});

const appendEvent = (client, input) => client.query(
  `INSERT INTO project_claim_events(id,claim_id,actor_user_id,action,from_status,to_status,details)
   VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [input.eventId,input.claimId,input.actorUserId,input.action,input.fromStatus ?? null,input.toStatus,input.details ?? {}],
);

const claimSelect = `SELECT c.*,w.title AS work_title,u.display_name AS claimant_display_name,u.profile_handle AS claimant_handle
  FROM project_claims c JOIN works w ON w.id=c.work_id JOIN users u ON u.id=c.claimant_user_id`;

export class PostgresProjectClaimRepository {
  constructor(pool) { this.pool = pool; }

  async getPublic(workId) {
    const work = (await this.pool.query(
      "SELECT id,repository_url,license_spdx,ingestion_method,attribution_kind FROM works WHERE id=$1 AND state='published' AND visibility='public'",
      [workId],
    )).rows[0];
    if (!work) throw new ProjectClaimError('WORK_NOT_FOUND',404,'作品不存在或当前不可公开访问。');
    const row = (await this.pool.query(
      `${claimSelect} WHERE c.work_id=$1 AND c.status IN ('verified','suspended','disputed','pending')
       ORDER BY CASE c.status WHEN 'verified' THEN 0 WHEN 'suspended' THEN 1 WHEN 'disputed' THEN 2 ELSE 3 END,c.updated_at DESC LIMIT 1`,
      [workId],
    )).rows[0];
    return publicView(work,row);
  }

  async create(input) {
    return withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.workId]);
      const work = (await client.query(
        "SELECT id,title,owner_user_id,repository_url,license_spdx,ingestion_method,attribution_kind FROM works WHERE id=$1 AND state='published' AND visibility='public' FOR UPDATE",
        [input.workId],
      )).rows[0];
      if (!work) throw new ProjectClaimError('WORK_NOT_FOUND',404,'作品不存在或当前不可认领。');
      if (work.attribution_kind !== 'community_catalog') throw new ProjectClaimError('WORK_HAS_PUBLISHER',409,'这个游戏由当前发布者直接上传或导入，不属于待认领收录。');
      if (work.owner_user_id === input.actor.userId) throw new ProjectClaimError('ALREADY_WORK_OWNER',409,'你已经是这个作品的管理者。');
      let repository=null;
      let evidence;
      if(input.evidenceType==='github'){
        repository = (await client.query(
          `SELECT r.id,r.repository_id,r.owner_login,r.name,r.html_url,r.visibility,r.access_state,
                  c.id AS connection_id,c.status AS connection_status,c.user_id
           FROM github_source_repositories r JOIN github_source_connections c ON c.id=r.connection_id
           WHERE c.id=$1 AND c.user_id=$2 AND r.repository_id=$3 FOR SHARE`,
          [input.connectionId,input.actor.userId,input.repositoryId],
        )).rows[0];
        if (!repository || repository.connection_status !== 'active' || repository.access_state !== 'active') throw new ProjectClaimError('CLAIM_EVIDENCE_UNAVAILABLE',409,'所选 GitHub 仓库授权无效，请重新连接后再试。');
        if (repository.visibility !== 'public') throw new ProjectClaimError('CLAIM_REPOSITORY_NOT_PUBLIC',409,'认领证据必须来自公开仓库。');
        const source = (await client.query('SELECT repository_id,repository_url FROM work_sources WHERE work_id=$1',[input.workId])).rows[0];
        const matches = source ? String(source.repository_id) === String(repository.repository_id) : normalizeRepositoryUrl(work.repository_url) === normalizeRepositoryUrl(repository.html_url);
        if (!matches) throw new ProjectClaimError('CLAIM_REPOSITORY_MISMATCH',409,'所选仓库与该游戏公开的源码仓库不一致。');
        evidence={provider:'github',connectionId:repository.connection_id,sourceRepositoryId:repository.id,repositoryId:String(repository.repository_id),owner:repository.owner_login,name:repository.name,url:repository.html_url,accessState:repository.access_state,capturedAt:input.submittedAt.toISOString()};
      }else{
        evidence={provider:input.evidenceType,url:input.evidenceUrl,capturedAt:input.submittedAt.toISOString()};
      }
      const authority = (await client.query("SELECT id FROM project_claims WHERE work_id=$1 AND status IN ('verified','disputed','suspended') LIMIT 1",[input.workId])).rows[0];
      if (authority) throw new ProjectClaimError('WORK_ALREADY_CLAIMED',409,'这个作品已经存在已确认或争议中的认领关系。');
      const duplicate = (await client.query("SELECT id FROM project_claims WHERE work_id=$1 AND claimant_user_id=$2 AND status='pending' LIMIT 1",[input.workId,input.actor.userId])).rows[0];
      if (duplicate) throw new ProjectClaimError('CLAIM_ALREADY_PENDING',409,'你已经提交过认领申请，请等待审核。');
      const row = (await client.query(
        `INSERT INTO project_claims(id,work_id,claimant_user_id,relationship,evidence_type,connection_id,source_repository_id,repository_id,repository_url,evidence_url,evidence,applicant_note,submitted_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING *, $14::text AS work_title, $15::text AS claimant_display_name, $16::text AS claimant_handle`,
        [input.claimId,input.workId,input.actor.userId,input.relationship,input.evidenceType,repository?.connection_id??null,repository?.id??null,repository?.repository_id??null,repository?.html_url??null,input.evidenceUrl??null,evidence,input.note,input.submittedAt,work.title,input.actor.profile.displayName,input.actor.profile.profileHandle ?? null],
      )).rows[0];
      await appendEvent(client,{eventId:input.eventId,claimId:row.id,actorUserId:input.actor.userId,action:'submitted',toStatus:'pending',details:{relationship:input.relationship,evidenceType:input.evidenceType,repositoryId:repository?String(repository.repository_id):null,evidenceUrl:input.evidenceUrl??null}});
      return claimView(row);
    });
  }

  async listMine(userId, status, limit) {
    const rows = (await this.pool.query(
      `${claimSelect} WHERE c.claimant_user_id=$1 AND ($2::text IS NULL OR c.status=$2) ORDER BY c.updated_at DESC,c.id DESC LIMIT $3`,
      [userId,status,limit],
    )).rows;
    return rows.map(claimView);
  }

  async cancel({ actorUserId, claimId, eventId }) {
    return withTransaction(this.pool, async client => {
      const current = (await client.query(`${claimSelect} WHERE c.id=$1 AND c.claimant_user_id=$2 FOR UPDATE OF c`,[claimId,actorUserId])).rows[0];
      if (!current) throw new ProjectClaimError('CLAIM_NOT_FOUND',404,'认领申请不存在。');
      if (current.status !== 'pending') throw new ProjectClaimError('CLAIM_STATE_CONFLICT',409,'只有待审核的申请可以撤回。');
      const row = (await client.query(
        `UPDATE project_claims SET status='cancelled',updated_at=now(),version=version+1 WHERE id=$1
         RETURNING *, $2::text AS work_title, $3::text AS claimant_display_name, $4::text AS claimant_handle`,
        [claimId,current.work_title,current.claimant_display_name,current.claimant_handle],
      )).rows[0];
      await appendEvent(client,{eventId,claimId,actorUserId,action:'cancelled',fromStatus:'pending',toStatus:'cancelled'});
      return claimView(row);
    });
  }

  async listAdmin(status, limit) {
    const rows = (await this.pool.query(
      `${claimSelect} WHERE ($1::text IS NULL OR c.status=$1) ORDER BY c.submitted_at ASC,c.id ASC LIMIT $2`,
      [status,limit],
    )).rows;
    return rows.map(claimView);
  }

  async decide({ actorUserId, claimId, action, note, eventId }) {
    return withTransaction(this.pool, async client => {
      const current = (await client.query(
        `${claimSelect} WHERE c.id=$1 FOR UPDATE OF c`,[claimId],
      )).rows[0];
      if (!current) throw new ProjectClaimError('CLAIM_NOT_FOUND',404,'认领申请不存在。');
      await client.query('SELECT id FROM works WHERE id=$1 FOR UPDATE',[current.work_id]);
      const transitions = {
        approve:{from:['pending'],to:'verified',event:'verified'}, reject:{from:['pending'],to:'rejected',event:'rejected'},
        dispute:{from:['verified'],to:'disputed',event:'disputed'}, suspend:{from:['verified','disputed'],to:'suspended',event:'suspended'},
        restore:{from:['suspended','disputed'],to:'verified',event:'restored'}, revoke:{from:['verified','disputed','suspended'],to:'revoked',event:'revoked'},
      };
      const transition = transitions[action];
      if (!transition.from.includes(current.status)) throw new ProjectClaimError('CLAIM_STATE_CONFLICT',409,'认领当前状态不允许执行这个操作。');
      let previousOwner = current.previous_owner_user_id;
      if (action === 'approve' || action === 'restore') {
        const competing = (await client.query("SELECT id FROM project_claims WHERE work_id=$1 AND id<>$2 AND status IN ('verified','disputed','suspended') LIMIT 1",[current.work_id,claimId])).rows[0];
        if (competing) throw new ProjectClaimError('WORK_ALREADY_CLAIMED',409,'这个作品已经存在另一条有效或争议中的认领关系。');
        const claimant=(await client.query('SELECT status,can_publish FROM users WHERE id=$1',[current.claimant_user_id])).rows[0];
        if(!claimant||claimant.status!=='active'||!claimant.can_publish)throw new ProjectClaimError('CLAIM_EVIDENCE_STALE',409,'申请人的创作者资格已失效，不能通过或恢复认领。');
        const work = (await client.query('SELECT owner_user_id,repository_url,attribution_kind,(SELECT repository_id FROM work_sources WHERE work_id=works.id) AS source_repository_id FROM works WHERE id=$1',[current.work_id])).rows[0];
        if(work.attribution_kind!=='community_catalog')throw new ProjectClaimError('CLAIM_SOURCE_CHANGED',409,'游戏已经具有明确发布者，不能继续处理旧认领。');
        if(current.evidence_type==='github'){
          const evidence = (await client.query(
            `SELECT c.status AS connection_status,r.access_state,r.repository_id,r.html_url
             FROM github_source_connections c JOIN github_source_repositories r ON r.connection_id=c.id
             WHERE c.id=$1 AND c.user_id=$2 AND r.id=$3`,
            [current.connection_id,current.claimant_user_id,current.source_repository_id],
          )).rows[0];
          if (!evidence || evidence.connection_status !== 'active' || evidence.access_state !== 'active' || String(evidence.repository_id) !== String(current.repository_id)) throw new ProjectClaimError('CLAIM_EVIDENCE_STALE',409,'GitHub 仓库授权已失效，不能通过或恢复认领。');
          const sourceStillMatches = work.source_repository_id ? String(work.source_repository_id) === String(evidence.repository_id) : normalizeRepositoryUrl(work.repository_url) === normalizeRepositoryUrl(evidence.html_url);
          if (!sourceStillMatches) throw new ProjectClaimError('CLAIM_REPOSITORY_CHANGED',409,'游戏公开的源码仓库已变化，请拒绝旧申请并让申请人重新提交。');
        }
        if (action === 'approve' && work.owner_user_id === current.claimant_user_id) throw new ProjectClaimError('ALREADY_WORK_OWNER',409,'申请人已经是这个作品的管理者，不需要再次认领。');
        previousOwner = action === 'approve' ? work.owner_user_id : current.previous_owner_user_id;
        if (action === 'restore' && current.status === 'suspended' && work.owner_user_id !== previousOwner) throw new ProjectClaimError('CLAIM_OWNERSHIP_CHANGED',409,'作品管理权已发生变化，不能自动恢复认领。');
        if (action === 'restore' && current.status === 'disputed' && work.owner_user_id !== current.claimant_user_id) throw new ProjectClaimError('CLAIM_OWNERSHIP_CHANGED',409,'争议期间作品管理权已发生变化，不能自动恢复认领。');
        if (work.owner_user_id !== current.claimant_user_id && (action === 'approve' || current.status === 'suspended')) {
          await client.query('UPDATE works SET owner_user_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',[current.work_id,current.claimant_user_id]);
          await client.query('UPDATE creator_usage SET work_count=GREATEST(0,work_count-1),updated_at=now() WHERE user_id=$1',[work.owner_user_id]);
          await client.query('UPDATE creator_usage SET work_count=work_count+1,updated_at=now() WHERE user_id=$1',[current.claimant_user_id]);
        }
      }
      if (action === 'suspend' || (action === 'revoke' && current.status !== 'suspended')) {
        const work = (await client.query('SELECT owner_user_id FROM works WHERE id=$1',[current.work_id])).rows[0];
        if (work.owner_user_id !== current.claimant_user_id || !current.previous_owner_user_id) throw new ProjectClaimError('CLAIM_OWNERSHIP_CHANGED',409,'作品管理权已发生变化，不能自动撤销认领。');
        await client.query('UPDATE works SET owner_user_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',[current.work_id,current.previous_owner_user_id]);
        await client.query('UPDATE creator_usage SET work_count=GREATEST(0,work_count-1),updated_at=now() WHERE user_id=$1',[current.claimant_user_id]);
        await client.query('UPDATE creator_usage SET work_count=work_count+1,updated_at=now() WHERE user_id=$1',[current.previous_owner_user_id]);
      }
      const row = (await client.query(
        `UPDATE project_claims SET status=$2,decision_note=$3,decided_by_user_id=$4,decided_at=now(),
           previous_owner_user_id=COALESCE($5,previous_owner_user_id),verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END,
           suspended_at=CASE WHEN $2='suspended' THEN now() ELSE suspended_at END,revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END,
           updated_at=now(),version=version+1 WHERE id=$1
         RETURNING *, $6::text AS work_title, $7::text AS claimant_display_name, $8::text AS claimant_handle`,
        [claimId,transition.to,note,actorUserId,previousOwner,current.work_title,current.claimant_display_name,current.claimant_handle],
      )).rows[0];
      await appendEvent(client,{eventId,claimId,actorUserId,action:transition.event,fromStatus:current.status,toStatus:transition.to,details:{note}});
      return claimView(row);
    });
  }
}

export function createProjectClaimService({ repository, ids = () => crypto.randomUUID(), clock = () => new Date() }) {
  const requireUser = actor => { if (!actor?.userId) throw new ProjectClaimError('UNAUTHORIZED',401,'请先登录。'); };
  const requireCreator = actor => {
    requireUser(actor);
    if (!actor.profile?.canPublish || !actor.scopes?.includes('works:write')) throw new ProjectClaimError('CREATOR_REQUIRED',403,'认领作品需要先开通创作者权限。');
  };
  const requireAdmin = actor => { requireUser(actor); if (actor.profile?.role !== 'admin') throw new ProjectClaimError('ADMIN_REQUIRED',403,'需要管理员权限。'); };
  const validId = value => uuidPattern.test(String(value ?? ''));
  const clean = (value,max) => String(value ?? '').trim().slice(0,max+1);
  return Object.freeze({
    publicStatus(workId) {
      if (!validId(workId)) return {workId,ingestionMethod:'platform',attributionKind:'publisher',eligible:false,status:'publisher',relationship:null,claimantDisplayName:null,claimantHandle:null,verifiedAt:null};
      return repository.getPublic(workId);
    },
    submit(actor,workId,body={}) {
      requireCreator(actor);
      if (!validId(workId)) throw new ProjectClaimError('WORK_NOT_FOUND',404,'官方内置作品暂不支持认领。');
      if(!evidenceTypes.has(body.evidenceType))throw new ProjectClaimError('CLAIM_EVIDENCE_INVALID',400,'请选择有效的身份依据。');
      let connectionId=null,repositoryId=null,evidenceUrl=null;
      if(body.evidenceType==='github'){
        if (!validId(body.connectionId) || !/^[1-9][0-9]*$/.test(String(body.repositoryId ?? ''))) throw new ProjectClaimError('CLAIM_EVIDENCE_INVALID',400,'请选择有效的 GitHub 仓库证据。');
        connectionId=body.connectionId;repositoryId=String(body.repositoryId);
      }else{
        evidenceUrl=clean(body.evidenceUrl,2048);
        if(evidenceUrl.length>2048)throw new ProjectClaimError('CLAIM_EVIDENCE_INVALID',400,'证明页面地址不能超过 2048 个字符。');
        try{const parsed=new URL(evidenceUrl);if(parsed.protocol!=='https:')throw new Error();}catch{throw new ProjectClaimError('CLAIM_EVIDENCE_INVALID',400,'请提供公开可访问的 HTTPS 证明页面。');}
      }
      if (!relationships.has(body.relationship)) throw new ProjectClaimError('CLAIM_RELATIONSHIP_INVALID',400,'请选择作者或维护者身份。');
      const note=clean(body.note,1000); if(note.length>1000)throw new ProjectClaimError('CLAIM_NOTE_TOO_LONG',400,'补充说明不能超过 1000 个字符。');
      if(body.evidenceType!=='github'&&note.length<10)throw new ProjectClaimError('CLAIM_NOTE_REQUIRED',400,'非 GitHub 认领请用至少 10 个字说明你与游戏的关系。');
      return repository.create({actor,workId,evidenceType:body.evidenceType,connectionId,repositoryId,evidenceUrl,relationship:body.relationship,note,claimId:ids(),eventId:ids(),submittedAt:clock()});
    },
    listMine(actor,query={}) { requireUser(actor); const status=query.status||'all'; if(status!=='all'&&!claimStatuses.has(status))throw new ProjectClaimError('CLAIM_STATUS_INVALID',400,'无效的认领状态。'); return repository.listMine(actor.userId,status==='all'?null:status,Math.min(100,Math.max(1,Number(query.limit)||50))); },
    cancel(actor,claimId) { requireUser(actor); if(!validId(claimId))throw new ProjectClaimError('CLAIM_NOT_FOUND',404,'认领申请不存在。'); return repository.cancel({actorUserId:actor.userId,claimId,eventId:ids()}); },
    listAdmin(actor,query={}) { requireAdmin(actor); const status=query.status||'pending'; if(status!=='all'&&!claimStatuses.has(status))throw new ProjectClaimError('CLAIM_STATUS_INVALID',400,'无效的认领状态。'); return repository.listAdmin(status==='all'?null:status,Math.min(100,Math.max(1,Number(query.limit)||50))); },
    decide(actor,claimId,body={}) { requireAdmin(actor); if(!validId(claimId))throw new ProjectClaimError('CLAIM_NOT_FOUND',404,'认领申请不存在。'); if(!decisionActions.has(body.action))throw new ProjectClaimError('CLAIM_ACTION_INVALID',400,'无效的审核操作。'); const note=clean(body.note,2000); if(note.length<3||note.length>2000)throw new ProjectClaimError('CLAIM_DECISION_NOTE_INVALID',400,'审核说明需要 3 到 2000 个字符。'); return repository.decide({actorUserId:actor.userId,claimId,action:body.action,note,eventId:ids()}); },
  });
}
