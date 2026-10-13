import crypto from 'node:crypto';

const statuses=new Set(['review','ready','opened','contacted','replied','declined','paused']);
const methods=new Set(['github_issue','github_discussion','email','other']);
const transitions={
  review:new Set(['review','ready','paused']),
  ready:new Set(['review','ready','opened','contacted','paused']),
  opened:new Set(['ready','opened','contacted','paused']),
  contacted:new Set(['contacted','replied','declined','paused']),
  replied:new Set(['replied','paused']),
  declined:new Set(['declined','paused']),
  paused:new Set(['review','ready','paused']),
};
const clean=(value,max)=>String(value??'').trim().slice(0,max+1);
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const githubContactReference=(method,value)=>{
  if(!value||!['github_issue','github_discussion'].includes(method))return true;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname.toLowerCase()!=='github.com')return false;
    const parts=url.pathname.split('/').filter(Boolean);
    const expected=method==='github_issue'?'issues':'discussions';
    return parts.length===4&&parts[2]===expected&&/^[1-9][0-9]*$/u.test(parts[3]);
  }catch{return false;}
};
const repositoryIdentity=value=>{
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname.toLowerCase()!=='github.com')return null;
    const parts=url.pathname.replace(/\.git\/?$/iu,'').split('/').filter(Boolean);
    if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_.-]+$/u.test(part)))return null;
    return {key:`${parts[0]}/${parts[1]}`.toLowerCase(),owner:parts[0],name:parts[1],url:`https://github.com/${parts[0]}/${parts[1]}`};
  }catch{return null;}
};
const asIso=value=>value?new Date(value).toISOString():null;
const view=row=>({
  id:row.id,workId:row.work_id,workTitle:row.work_title,workDescription:row.work_description,
  repositoryKey:row.repository_key,repositoryUrl:row.repository_url,repositoryOwner:row.repository_owner,
  licenseSpdx:row.license_spdx,status:row.status,draftSubject:row.draft_subject,draftBody:row.draft_body,
  draftTemplateVersion:Number(row.draft_template_version),
  contactMethod:row.contact_method??null,contactReference:row.contact_reference??null,note:row.note??null,
  lastContactedAt:asIso(row.last_contacted_at),version:String(row.version),updatedAt:asIso(row.updated_at),
});
const eventView=row=>({id:row.id,action:row.action,fromStatus:row.from_status??null,toStatus:row.to_status,details:row.details??{},actorDisplayName:row.actor_display_name,createdAt:asIso(row.created_at)});
const baseSelect=`SELECT o.*,w.title AS work_title,w.description AS work_description,w.license_spdx,
  split_part(o.repository_key,'/',1) AS repository_owner
  FROM author_outreach_records o JOIN works w ON w.id=o.work_id`;

export class AuthorOutreachError extends Error{
  constructor(code,statusCode,message){super(message);this.code=code;this.statusCode=statusCode;this.retryable=statusCode>=500;}
}

export class PostgresAuthorOutreachRepository{
  constructor(pool){this.pool=pool;}
  async candidates(){
    return (await this.pool.query(`SELECT DISTINCT ON (lower(regexp_replace(w.repository_url,'\\.git/?$','','i')))
      w.id AS work_id,w.title,w.description,w.repository_url,w.license_spdx
      FROM works w
      WHERE w.kind='game' AND w.state='published' AND w.visibility='public'
        AND w.attribution_kind='community_catalog' AND w.repository_url IS NOT NULL AND w.license_spdx IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM project_claims c WHERE c.work_id=w.id AND c.status IN ('pending','verified','disputed','suspended'))
      ORDER BY lower(regexp_replace(w.repository_url,'\\.git/?$','','i')),w.updated_at DESC,w.id`)).rows;
  }
  async sync({actorUserId,records}){
    const client=await this.pool.connect();let inserted=0,upgraded=0;
    try{
      await client.query('BEGIN');
      for(const record of records){
        const result=await client.query(`INSERT INTO author_outreach_records
          (id,work_id,repository_key,repository_url,draft_subject,draft_body,draft_template_version,created_by_user_id,updated_by_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING RETURNING id`,
          [record.id,record.workId,record.repositoryKey,record.repositoryUrl,record.draftSubject,record.draftBody,record.draftTemplateVersion,actorUserId]);
        if(result.rowCount){inserted++;await client.query(`INSERT INTO author_outreach_events(id,outreach_id,actor_user_id,action,to_status,details)
          VALUES($1,$2,$3,'discovered','review',$4)`,[record.eventId,record.id,actorUserId,{repositoryKey:record.repositoryKey,draftTemplateVersion:record.draftTemplateVersion}]);}
        else{
          const upgradedRecord=await client.query(`UPDATE author_outreach_records SET repository_url=$3,draft_subject=$4,draft_body=$5,
            draft_template_version=$6,updated_by_user_id=$7,updated_at=now(),version=version+1
            WHERE work_id=$1 AND repository_key=$2 AND status='review' AND version=1
              AND draft_template_version<$6 AND contact_reference IS NULL AND last_contacted_at IS NULL
            RETURNING id`,[record.workId,record.repositoryKey,record.repositoryUrl,record.draftSubject,record.draftBody,record.draftTemplateVersion,actorUserId]);
          if(upgradedRecord.rowCount){upgraded++;await client.query(`INSERT INTO author_outreach_events(id,outreach_id,actor_user_id,action,from_status,to_status,details)
            VALUES($1,$2,$3,'updated','review','review',$4)`,[record.eventId,upgradedRecord.rows[0].id,actorUserId,{reason:'brand_template_upgrade',draftTemplateVersion:record.draftTemplateVersion}]);}
        }
      }
      await client.query('COMMIT');return{inserted,upgraded};
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }
  async list(status,limit){const rows=(await this.pool.query(`${baseSelect} WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.updated_at DESC,o.id DESC LIMIT $2`,[status,limit])).rows;return rows.map(view);}
  async update(input){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const current=(await client.query(`${baseSelect} WHERE o.id=$1 FOR UPDATE OF o`,[input.id])).rows[0];
      if(!current)throw new AuthorOutreachError('OUTREACH_NOT_FOUND',404,'联络记录不存在。');
      if(String(current.version)!==input.expectedVersion)throw new AuthorOutreachError('OUTREACH_STALE',409,'联络记录已经更新，请刷新后重试。');
      if(!transitions[current.status]?.has(input.status))throw new AuthorOutreachError('OUTREACH_TRANSITION_INVALID',409,'当前状态不允许执行这个操作。');
      const contactedAt=input.status==='contacted'?(current.last_contacted_at??input.now):current.last_contacted_at;
      const row=(await client.query(`UPDATE author_outreach_records SET status=$2,draft_subject=$3,draft_body=$4,
        contact_method=$5,contact_reference=$6,note=$7,last_contacted_at=$8,updated_by_user_id=$9,updated_at=$10,version=version+1
        WHERE id=$1 RETURNING *`,[input.id,input.status,input.draftSubject,input.draftBody,input.contactMethod,input.contactReference,input.note,contactedAt,input.actorUserId,input.now])).rows[0];
      const action=input.status===current.status?'updated':input.status==='opened'?'opened':input.status==='contacted'?'contacted':input.status==='replied'?'replied':input.status==='declined'?'declined':input.status==='paused'?'paused':'reopened';
      await client.query(`INSERT INTO author_outreach_events(id,outreach_id,actor_user_id,action,from_status,to_status,details)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.eventId,input.id,input.actorUserId,action,current.status,input.status,{contactMethod:input.contactMethod,contactReference:input.contactReference,note:input.note}]);
      await client.query('COMMIT');return view({...row,work_title:current.work_title,work_description:current.work_description,license_spdx:current.license_spdx,repository_owner:current.repository_owner});
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }
  async events(id){return (await this.pool.query(`SELECT e.*,u.display_name AS actor_display_name FROM author_outreach_events e JOIN users u ON u.id=e.actor_user_id WHERE e.outreach_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,[id])).rows.map(eventView);}
}

export function createAuthorOutreachService({repository,siteOrigin='https://mooyu.fun',ids=()=>crypto.randomUUID(),clock=()=>new Date()}){
  const requireAdmin=actor=>{if(!actor?.userId)throw new AuthorOutreachError('UNAUTHORIZED',401,'请先登录。');if(actor.profile?.role!=='admin')throw new AuthorOutreachError('ADMIN_REQUIRED',403,'需要管理员权限。');};
  const draft=candidate=>{
    const repo=repositoryIdentity(candidate.repository_url);if(!repo)return null;
    const workUrl=new URL(`/w/${encodeURIComponent(candidate.work_id)}`,siteOrigin);workUrl.searchParams.set('gh_src','campaign');workUrl.searchParams.set('gh_campaign','author-outreach');
    const title=clean(candidate.title,70);
    const subject=`MOOYU.FUN invitation / 墨鱼工坊认领邀请：${title}`.slice(0,120);
    const body=`Hello, ${repo.owner} team,\n\nWe are MOOYU.FUN, an open game and creator community where players can directly experience independent games and open projects. Based on the ${candidate.license_spdx} license and the public repository information, we created a playable community catalog page for “${title}”:\n${workUrl}\n\nOriginal repository:\n${repo.url}\n\nThe page is clearly labeled as “listed by the platform, awaiting author claim” and is not presented as an official release. You are welcome to review it. If you choose to claim it on MOOYU.FUN, you can maintain its description, releases, and availability. If you would prefer the work not to be displayed, simply reply and we will prioritize your request.\n\nThis is a one-time, human-reviewed invitation for this specific project. It will not be sent again automatically. Thank you for creating and sharing your work.\n\n---\n\n中文\n\n你好，${repo.owner} 团队：\n\n我们是墨鱼工坊（MOOYU.FUN），一个让玩家直接体验独立游戏和开放作品的游戏与创作社区。我们依据 ${candidate.license_spdx} 许可证和公开仓库信息，为《${title}》建立了一个可直接试玩的社区收录页面：\n${workUrl}\n\n原仓库：\n${repo.url}\n\n当前页面明确标记为“平台代收录、等待作者认领”，不会冒充官方版本。你可以先核对页面；如果愿意，可以在墨鱼工坊认领后维护介绍、版本与下架状态。如果你不希望该作品继续展示，也可以直接回复，我们会优先处理。\n\n这是一封针对该作品的一次性人工邀请，不会自动重复发送。谢谢你创造并开放这个项目。`;
    return {id:ids(),eventId:ids(),workId:candidate.work_id,repositoryKey:repo.key,repositoryUrl:repo.url,draftSubject:subject,draftBody:body,draftTemplateVersion:3};
  };
  return Object.freeze({
    async sync(actor){requireAdmin(actor);const candidates=await repository.candidates();const records=candidates.map(draft).filter(Boolean);const result=await repository.sync({actorUserId:actor.userId,records});return{inserted:result.inserted,upgraded:result.upgraded,totalCandidates:records.length,items:await repository.list(null,100)};},
    list(actor,query={}){requireAdmin(actor);const status=query.status||'all';if(status!=='all'&&!statuses.has(status))throw new AuthorOutreachError('OUTREACH_STATUS_INVALID',400,'无效的联络状态。');return repository.list(status==='all'?null:status,Math.min(100,Math.max(1,Number(query.limit)||100)));},
    update(actor,id,body={}){requireAdmin(actor);if(!uuidPattern.test(id))throw new AuthorOutreachError('OUTREACH_NOT_FOUND',404,'联络记录不存在。');if(!statuses.has(body.status))throw new AuthorOutreachError('OUTREACH_STATUS_INVALID',400,'无效的联络状态。');const draftSubject=clean(body.draftSubject,120),draftBody=clean(body.draftBody,4000),note=clean(body.note,1000)||null,contactReference=clean(body.contactReference,2048)||null,contactMethod=body.contactMethod||null;if(draftSubject.length<5||draftSubject.length>120||draftBody.length<40||draftBody.length>4000)throw new AuthorOutreachError('OUTREACH_DRAFT_INVALID',400,'请完善联络标题和正文。');if(note&&note.length<3)throw new AuthorOutreachError('OUTREACH_NOTE_INVALID',400,'备注至少需要 3 个字符。');if(contactMethod&&!methods.has(contactMethod))throw new AuthorOutreachError('OUTREACH_CONTACT_INVALID',400,'请选择有效的联系渠道。');if(body.status==='contacted'&&(!contactMethod||!contactReference))throw new AuthorOutreachError('OUTREACH_CONTACT_REQUIRED',400,'记录已联系前，请填写联系渠道和实际联系记录。');if(!githubContactReference(contactMethod,contactReference))throw new AuthorOutreachError('OUTREACH_CONTACT_INVALID',400,'GitHub 联系记录必须是实际 Issue 或 Discussion 链接。');if(!/^[1-9][0-9]*$/u.test(String(body.expectedVersion??'')))throw new AuthorOutreachError('OUTREACH_VERSION_INVALID',400,'缺少有效的记录版本。');return repository.update({id,actorUserId:actor.userId,status:body.status,draftSubject,draftBody,contactMethod,contactReference,note,expectedVersion:String(body.expectedVersion),eventId:ids(),now:clock()});},
    events(actor,id){requireAdmin(actor);if(!uuidPattern.test(id))throw new AuthorOutreachError('OUTREACH_NOT_FOUND',404,'联络记录不存在。');return repository.events(id);},
  });
}
