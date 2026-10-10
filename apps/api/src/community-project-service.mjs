import crypto from 'node:crypto';
import { withTransaction } from './database.mjs';
import { fail } from './community-errors.mjs';

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicStatuses=['recruiting','active','completed'];
const transitions={draft:['recruiting','cancelled'],recruiting:['active','completed','cancelled'],active:['recruiting','completed','cancelled'],completed:['archived'],cancelled:['archived'],archived:[]};
const iso=value=>value?new Date(value).toISOString():null;
const clean=(value,max)=>String(value??'').trim().slice(0,max+1);
const projectSelect=`SELECT p.*,u.display_name AS owner_display_name,u.profile_handle AS owner_handle,w.title AS work_title,
 (SELECT count(*)::int FROM community_project_members m WHERE m.project_id=p.id AND m.membership_state='active') AS member_count,
 (SELECT count(*)::int FROM contribution_tasks t WHERE t.project_id=p.id AND t.status IN ('open','claimed','submitted')) AS open_task_count,
 (SELECT count(*)::int FROM contribution_tasks t WHERE t.project_id=p.id AND t.status='completed') AS completed_task_count
 FROM community_projects p JOIN users u ON u.id=p.owner_id LEFT JOIN works w ON w.id=p.work_id`;

const roleInput=(role,index)=>{
  const name=clean(role?.name,40),description=clean(role?.description,500),capacity=Math.floor(Number(role?.capacity)||1);
  const requiredSkills=Array.isArray(role?.requiredSkills)?[...new Set(role.requiredSkills.map(value=>clean(value,30)).filter(Boolean))]:[];
  if(name.length<2||name.length>40||description.length>500||capacity<1||capacity>20||requiredSkills.length>8)fail('PROJECT_ROLE_INVALID',400,'请填写有效的项目角色、人数和技能标签。');
  return {name,description,capacity,requiredSkills,position:index};
};
const projectFields=body=>{
  const title=clean(body.title,80),summary=clean(body.summary,240),description=clean(body.description,4000);
  if(title.length<3||title.length>80||summary.length<10||summary.length>240||description.length<20||description.length>4000)fail('PROJECT_INVALID',400,'请填写有效的项目名称、简短目标和完整说明。');
  return {title,summary,description};
};
const projectView=(row,roles=[],membership=null,myApplication=null)=>({
  id:row.id,title:row.title,summary:row.summary,description:row.description,status:row.status,visibility:row.visibility,version:Number(row.version),
  owner:{id:row.owner_id,displayName:row.owner_display_name,handle:row.owner_handle},
  work:row.work_id?{id:row.work_id,title:row.work_title}:null,
  roles,memberCount:Number(row.member_count||0),openTaskCount:Number(row.open_task_count||0),completedTaskCount:Number(row.completed_task_count||0),
  isOwner:row.is_owner===true,membership,myApplication,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),completedAt:iso(row.completed_at),
});

export class CommunityProjectService {
  constructor({pool,ids=()=>crypto.randomUUID()}){Object.assign(this,{pool,ids});}
  requireUser(actor){if(!actor?.userId)fail('AUTH_REQUIRED',401,'请登录后继续。');}
  projectId(id){if(!uuidPattern.test(String(id||'')))fail('PROJECT_NOT_FOUND',404,'项目不存在或不可访问。');}
  page(query={}){return {limit:Math.min(50,Math.max(1,Math.floor(Number(query.limit)||20))),offset:Math.max(0,Math.floor(Number(query.offset)||0))};}
  async activeUser(client,actor){
    this.requireUser(actor);
    const user=(await client.query("SELECT id,status FROM users WHERE id=$1 FOR SHARE",[actor.userId])).rows[0];
    if(!user||user.status!=='active')fail('AUTH_REQUIRED',401,'账号当前不可用。');
    return user;
  }
  async hydrate(rows,viewerId,{detail=false}={}){
    if(!rows.length)return [];
    const ids=rows.map(row=>row.id);
    const roleRows=(await this.pool.query(`SELECT r.*,(SELECT count(*)::int FROM community_project_members m WHERE m.project_id=r.project_id AND m.role_id=r.id AND m.membership_state='active') AS filled_count FROM community_project_roles r WHERE r.project_id=ANY($1::uuid[]) ORDER BY r.project_id,r.position,r.id`,[ids])).rows;
    const roles=new Map(ids.map(id=>[id,[]]));
    for(const row of roleRows)roles.get(row.project_id).push({id:row.id,name:row.name,description:row.description,capacity:Number(row.capacity),requiredSkills:row.required_skills??[],filledCount:Number(row.filled_count)});
    let memberships=new Map(),applications=new Map();
    if(viewerId){
      const memberRows=(await this.pool.query("SELECT project_id,role_id,membership_state,joined_at,left_at FROM community_project_members WHERE project_id=ANY($1::uuid[]) AND user_id=$2",[ids,viewerId])).rows;
      memberships=new Map(memberRows.map(row=>[row.project_id,{roleId:row.role_id,state:row.membership_state,joinedAt:iso(row.joined_at),leftAt:iso(row.left_at)}]));
      const applicationRows=(await this.pool.query("SELECT id,project_id,role_id,state,version,message,created_at,decided_at FROM community_project_applications WHERE project_id=ANY($1::uuid[]) AND applicant_id=$2 ORDER BY created_at DESC",[ids,viewerId])).rows;
      for(const row of applicationRows)if(!applications.has(row.project_id))applications.set(row.project_id,{id:row.id,roleId:row.role_id,state:row.state,version:Number(row.version),message:row.message,createdAt:iso(row.created_at),decidedAt:iso(row.decided_at)});
    }
    return rows.map(row=>projectView(row,roles.get(row.id),memberships.get(row.id)??null,applications.get(row.id)??null));
  }
  async list(actor,query={}){
    const mine=query.mine===true||query.mine==='true';
    if(mine)this.requireUser(actor);
    const status=clean(query.status,20)||'all';
    if(status!=='all'&&!['draft','recruiting','active','completed','archived','cancelled'].includes(status))fail('PROJECT_STATUS_INVALID',400,'无效的项目状态。');
    const {limit,offset}=this.page(query),viewerId=actor?.userId??null;
    const rows=(await this.pool.query(`${projectSelect},(p.owner_id=$1) AS is_owner WHERE (
      ($2::boolean AND (p.owner_id=$1 OR EXISTS(SELECT 1 FROM community_project_members m WHERE m.project_id=p.id AND m.user_id=$1 AND m.membership_state='active') OR EXISTS(SELECT 1 FROM community_project_applications a WHERE a.project_id=p.id AND a.applicant_id=$1)))
      OR (NOT $2::boolean AND p.visibility='public' AND p.status=ANY($3::text[])))
      AND ($4='all' OR p.status=$4)
      ORDER BY CASE p.status WHEN 'recruiting' THEN 0 WHEN 'active' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,p.updated_at DESC,p.id DESC LIMIT $5 OFFSET $6`,[viewerId,mine,publicStatuses,status,limit,offset])).rows;
    return this.hydrate(rows,viewerId);
  }
  async get(actor,id){
    this.projectId(id);const viewerId=actor?.userId??null;
    const row=(await this.pool.query(`${projectSelect},(p.owner_id=$2) AS is_owner WHERE p.id=$1 AND (p.visibility IN ('public','unlisted') OR p.owner_id=$2 OR EXISTS(SELECT 1 FROM community_project_members m WHERE m.project_id=p.id AND m.user_id=$2) OR EXISTS(SELECT 1 FROM community_project_applications a WHERE a.project_id=p.id AND a.applicant_id=$2))`,[id,viewerId])).rows[0];
    if(!row)fail('PROJECT_NOT_FOUND',404,'项目不存在或不可访问。');
    const project=(await this.hydrate([row],viewerId,{detail:true}))[0];
    const members=(await this.pool.query(`SELECT m.user_id,m.role_id,m.joined_at,u.display_name,u.profile_handle FROM community_project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND m.membership_state='active' AND u.status='active' ORDER BY (m.user_id=$2) DESC,m.joined_at,m.user_id`,[id,row.owner_id])).rows.map(member=>({id:member.user_id,roleId:member.role_id,displayName:member.display_name,handle:member.profile_handle,joinedAt:iso(member.joined_at)}));
    const applications=row.owner_id===viewerId?(await this.pool.query(`SELECT a.*,u.display_name,u.profile_handle FROM community_project_applications a JOIN users u ON u.id=a.applicant_id WHERE a.project_id=$1 ORDER BY (a.state='pending') DESC,a.created_at DESC,a.id DESC LIMIT 100`,[id])).rows.map(application=>({id:application.id,roleId:application.role_id,applicant:{id:application.applicant_id,displayName:application.display_name,handle:application.profile_handle},message:application.message,state:application.state,version:Number(application.version),createdAt:iso(application.created_at),decidedAt:iso(application.decided_at)})):[];
    return {...project,members,applications};
  }
  async create(actor,body={}){
    this.requireUser(actor);const fields=projectFields(body),roles=Array.isArray(body.roles)?body.roles.map(roleInput):[];
    if(!roles.length||roles.length>8)fail('PROJECT_ROLES_REQUIRED',400,'请提供 1 至 8 个明确的招募角色。');
    const workId=body.workId||null;if(workId&&!uuidPattern.test(workId))fail('PROJECT_WORK_INVALID',400,'关联作品无效。');
    const projectId=await withTransaction(this.pool,async client=>{
      await this.activeUser(client,actor);await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['community-project-create:'+actor.userId]);
      if(workId){const work=(await client.query("SELECT id FROM works WHERE id=$1 AND owner_user_id=$2 AND state='published' AND visibility='public' FOR SHARE",[workId,actor.userId])).rows[0];if(!work)fail('PROJECT_WORK_INVALID',409,'只能关联自己当前公开发布的作品。');}
      const projectId=this.ids();
      await client.query(`INSERT INTO community_projects(id,owner_id,work_id,title,summary,description) VALUES($1,$2,$3,$4,$5,$6)`,[projectId,actor.userId,workId,fields.title,fields.summary,fields.description]);
      for(const role of roles)await client.query(`INSERT INTO community_project_roles(id,project_id,name,description,capacity,required_skills,position) VALUES($1,$2,$3,$4,$5,$6,$7)`,[this.ids(),projectId,role.name,role.description,role.capacity,role.requiredSkills,role.position]);
      await client.query("INSERT INTO community_project_members(project_id,user_id,membership_state) VALUES($1,$2,'active')",[projectId,actor.userId]);
      await client.query("INSERT INTO community_project_events(id,project_id,actor_id,action,details) VALUES($1,$2,$3,'created',$4)",[this.ids(),projectId,actor.userId,{roles:roles.length,workId}]);
      return projectId;
    });
    return this.get(actor,projectId);
  }
  async update(actor,id,body={}){
    this.requireUser(actor);this.projectId(id);
    if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail('PROJECT_VERSION_REQUIRED',409,'请刷新项目后再保存。');
    await withTransaction(this.pool,async client=>{
      await this.activeUser(client,actor);
      const row=(await client.query('SELECT * FROM community_projects WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row||row.owner_id!==actor.userId)fail('PROJECT_NOT_FOUND',404,'项目不存在，或你没有管理权限。');
      if(Number(row.version)!==body.expectedVersion)fail('PROJECT_VERSION_CONFLICT',409,'项目已经变化，请刷新后重试。');
      let title=row.title,summary=row.summary,description=row.description;
      if(body.title!==undefined||body.summary!==undefined||body.description!==undefined)({title,summary,description}=projectFields({title:body.title??row.title,summary:body.summary??row.summary,description:body.description??row.description}));
      const status=body.status??row.status,visibility=body.visibility??row.visibility;
      if(status!==row.status&&!transitions[row.status].includes(status))fail('PROJECT_STATE_CONFLICT',409,'项目当前状态不能切换到该阶段。');
      if(!['public','unlisted'].includes(visibility))fail('PROJECT_VISIBILITY_INVALID',400,'无效的项目可见范围。');
      await client.query(`UPDATE community_projects SET title=$2,summary=$3,description=$4,status=$5,visibility=$6,completed_at=CASE WHEN $5='completed' THEN COALESCE(completed_at,now()) ELSE completed_at END,version=version+1,updated_at=now() WHERE id=$1`,[id,title,summary,description,status,visibility]);
      await client.query("INSERT INTO community_project_events(id,project_id,actor_id,action,details) VALUES($1,$2,$3,'updated',$4)",[this.ids(),id,actor.userId,{fromStatus:row.status,toStatus:status}]);
    });
    return this.get(actor,id);
  }
  async apply(actor,id,body={}){
    this.requireUser(actor);this.projectId(id);const roleId=body.roleId,message=clean(body.message,1000);
    if(!uuidPattern.test(String(roleId||''))||message.length<10||message.length>1000)fail('PROJECT_APPLICATION_INVALID',400,'请选择角色并填写至少 10 个字的申请说明。');
    return withTransaction(this.pool,async client=>{
      await this.activeUser(client,actor);const project=(await client.query('SELECT * FROM community_projects WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!project||project.visibility!=='public'||!['recruiting','active'].includes(project.status))fail('PROJECT_NOT_RECRUITING',409,'项目当前不接受加入申请。');
      if(project.owner_id===actor.userId)fail('PROJECT_OWNER_APPLICATION',409,'发起人已经是项目成员。');
      const role=(await client.query('SELECT * FROM community_project_roles WHERE project_id=$1 AND id=$2',[id,roleId])).rows[0];if(!role)fail('PROJECT_ROLE_NOT_FOUND',404,'项目角色不存在。');
      const member=(await client.query("SELECT 1 FROM community_project_members WHERE project_id=$1 AND user_id=$2 AND membership_state='active'",[id,actor.userId])).rowCount;if(member)fail('PROJECT_ALREADY_MEMBER',409,'你已经是项目成员。');
      if((await client.query("SELECT 1 FROM community_project_applications WHERE project_id=$1 AND applicant_id=$2 AND state='pending'",[id,actor.userId])).rowCount)fail('PROJECT_APPLICATION_EXISTS',409,'你已有待处理的加入申请。');
      const applicationId=this.ids();await client.query(`INSERT INTO community_project_applications(id,project_id,role_id,applicant_id,message) VALUES($1,$2,$3,$4,$5)`,[applicationId,id,roleId,actor.userId,message]);
      await client.query("INSERT INTO community_project_events(id,project_id,actor_id,action,details) VALUES($1,$2,$3,'application_submitted',$4)",[this.ids(),id,actor.userId,{applicationId,roleId}]);
      return {id:applicationId,projectId:id,roleId,state:'pending',version:1,message};
    });
  }
  async decide(actor,projectId,applicationId,body={}){
    this.requireUser(actor);this.projectId(projectId);if(!uuidPattern.test(String(applicationId||'')))fail('PROJECT_APPLICATION_NOT_FOUND',404,'加入申请不存在。');
    if(!['approve','reject'].includes(body.decision)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail('PROJECT_APPLICATION_DECISION_INVALID',400,'请刷新申请后选择同意或拒绝。');
    return withTransaction(this.pool,async client=>{
      await this.activeUser(client,actor);const project=(await client.query('SELECT * FROM community_projects WHERE id=$1 FOR UPDATE',[projectId])).rows[0];
      if(!project||project.owner_id!==actor.userId)fail('PROJECT_NOT_FOUND',404,'项目不存在，或你没有管理权限。');
      const application=(await client.query('SELECT * FROM community_project_applications WHERE id=$1 AND project_id=$2 FOR UPDATE',[applicationId,projectId])).rows[0];
      if(!application)fail('PROJECT_APPLICATION_NOT_FOUND',404,'加入申请不存在。');
      if(application.state!=='pending'||Number(application.version)!==body.expectedVersion)fail('PROJECT_APPLICATION_CONFLICT',409,'申请已经处理，请刷新后查看。');
      if(body.decision==='approve'){
        const role=(await client.query('SELECT * FROM community_project_roles WHERE id=$1 AND project_id=$2 FOR UPDATE',[application.role_id,projectId])).rows[0];
        const filled=Number((await client.query("SELECT count(*)::int AS count FROM community_project_members WHERE project_id=$1 AND role_id=$2 AND membership_state='active'",[projectId,application.role_id])).rows[0].count);
        if(filled>=role.capacity)fail('PROJECT_ROLE_FULL',409,'这个角色已经招满，请先调整成员安排。');
        await client.query(`INSERT INTO community_project_members(project_id,user_id,role_id,membership_state,joined_at,left_at) VALUES($1,$2,$3,'active',now(),NULL) ON CONFLICT(project_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id,membership_state='active',joined_at=now(),left_at=NULL`,[projectId,application.applicant_id,application.role_id]);
      }
      const state=body.decision==='approve'?'approved':'rejected';
      await client.query('UPDATE community_project_applications SET state=$2,version=version+1,decided_by=$3,decided_at=now() WHERE id=$1',[applicationId,state,actor.userId]);
      await client.query(`INSERT INTO community_project_events(id,project_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)`,[this.ids(),projectId,actor.userId,body.decision==='approve'?'application_approved':'application_rejected',{applicationId,applicantId:application.applicant_id,roleId:application.role_id}]);
      return {id:applicationId,state,version:Number(application.version)+1};
    });
  }
  async leave(actor,id){
    this.requireUser(actor);this.projectId(id);
    return withTransaction(this.pool,async client=>{
      await this.activeUser(client,actor);const project=(await client.query('SELECT * FROM community_projects WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!project)fail('PROJECT_NOT_FOUND',404,'项目不存在或不可访问。');if(project.owner_id===actor.userId)fail('PROJECT_OWNER_CANNOT_LEAVE',409,'发起人不能直接退出项目；请先完成或取消项目。');
      const changed=await client.query("UPDATE community_project_members SET membership_state='left',left_at=now() WHERE project_id=$1 AND user_id=$2 AND membership_state='active'",[id,actor.userId]);
      if(!changed.rowCount)fail('PROJECT_MEMBERSHIP_NOT_FOUND',404,'你当前不是这个项目的成员。');
      await client.query("INSERT INTO community_project_events(id,project_id,actor_id,action) VALUES($1,$2,$3,'member_left')",[this.ids(),id,actor.userId]);return {left:true};
    });
  }
}
