import crypto from 'node:crypto';
import {withTransaction} from './database.mjs';
import {normalizeCompetition,validateCompetitionMetrics,competitionSortKey,COMPETITION_LIMITS} from '../../../packages/contracts/src/competition.mjs';
import {verifyTileMerge} from '../../../packages/competition-rules/tile-merge-v1.mjs';

export class CompetitionError extends Error {
  constructor(code,statusCode,message){super(message);this.code=code;this.statusCode=statusCode;this.retryable=statusCode===429||statusCode===503;}
}
const fail=(code,status,message)=>{throw new CompetitionError(code,status,message);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const chinaDate=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const boardView=row=>({id:row.id,...row.definition,timeZone:'Asia/Shanghai'});
const runView=row=>({id:row.id,boardId:row.board_id,status:row.status,periodKey:row.period_key,seed:Number(row.seed),expiresAt:new Date(row.expires_at).toISOString(),metrics:row.metrics,channel:row.channel});
const legacyDefinition={id:'daily',key:'daily',modeKey:'daily',rulesetVersion:1,title:'每日挑战榜',period:'daily',timeZone:'Asia/Shanghai',verification:'client_reported',challengeScoped:true,playerCenter:'/games/guess-baike/players',metrics:[{key:'hints',label:'提示',unit:'次'},{key:'guessedCount',label:'猜字',unit:'个'},{key:'elapsedSeconds',label:'用时',unit:'秒'}],ranking:[{metric:'hints',direction:'asc'},{metric:'guessedCount',direction:'asc'},{metric:'elapsedSeconds',direction:'asc'}]};

// Called only after archive validation, inside the release publication transaction.
// This is a bounded platform policy, not a grant accepting IDs supplied by an author.
export async function registerCompetitionRelease(client,{workId,releaseId,ownerUserId,competition}) {
  if(!competition)return;
  const normalized=normalizeCompetition(competition),ids=[];
  for(const definition of normalized.boards){
    const digest=hash(definition);
    await client.query(`INSERT INTO competition_boards(id,work_id,board_key,ruleset_version,definition,definition_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(work_id,board_key,ruleset_version) DO NOTHING`,[crypto.randomUUID(),workId,definition.key,definition.rulesetVersion,definition,digest]);
    const row=(await client.query('SELECT * FROM competition_boards WHERE work_id=$1 AND board_key=$2 AND ruleset_version=$3',[workId,definition.key,definition.rulesetVersion])).rows[0];
    if(row.definition_hash!==digest||row.status!=='active')throw Object.assign(new Error('Board rules changed or retired; increment rulesetVersion.'),{code:'MANIFEST_COMPETITION_VERSION_CONFLICT'});
    ids.push(row.id);
    await client.query('INSERT INTO competition_release_boards(work_id,release_id,board_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[workId,releaseId,row.id]);
  }
  for(const channel of ['production','preview'])await client.query(`INSERT INTO game_release_service_scopes(work_id,release_id,channel,status,mode_ids,approved_by,reason)
    VALUES($1,$2,$3,'active',$4,$5,'Validated competition v1 policy: bounded metrics and platform verifier allowlist')
    ON CONFLICT(release_id,channel) DO UPDATE SET mode_ids=EXCLUDED.mode_ids,status='active',approved_by=EXCLUDED.approved_by,reason=EXCLUDED.reason`,[workId,releaseId,channel,ids,ownerUserId]);
}
const publicBoardsSql=`SELECT DISTINCT b.* FROM competition_boards b JOIN competition_release_boards rb ON rb.board_id=b.id
  JOIN releases r ON r.id=rb.release_id JOIN works w ON w.id=b.work_id
  JOIN work_targets t ON t.work_id=w.id AND t.current_release_id=r.id
  WHERE b.work_id=$1 AND b.status='active' AND w.state='published' AND w.visibility='public'
  AND t.state='published' AND r.validation_state='ready' AND r.serving_state='enabled'`;
const project=async(client,run)=>client.query(`INSERT INTO competition_entries(board_id,period_key,user_id,run_id,metrics,sort_key,achieved_at)
  VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(board_id,period_key,user_id) DO UPDATE
  SET run_id=EXCLUDED.run_id,metrics=EXCLUDED.metrics,sort_key=EXCLUDED.sort_key,achieved_at=EXCLUDED.achieved_at
  WHERE (EXCLUDED.sort_key,EXCLUDED.achieved_at,EXCLUDED.run_id)<(competition_entries.sort_key,competition_entries.achieved_at,competition_entries.run_id)`,[run.board_id,run.period_key,run.user_id,run.id,run.metrics,run.sort_key,run.submitted_at]);
export function createCompetitionService({pool,gameSessionService,socialService,clock=()=>new Date()}) {
  const lockUser=(client,userId)=>client.query("SELECT pg_advisory_xact_lock(hashtextextended('competition:user:'||$1,0))",[userId]);
  const resolve=(client,actor,token)=>gameSessionService.resolve(actor,token,{capability:'competition'},client);
  const authorizedBoard=async(client,scope,id)=>{
    if(!uuid.test(id)||!scope.modeIds.includes(id))fail('COMPETITION_NOT_ALLOWED',403,'本次启动未获准使用这个榜单。');
    const board=(await client.query(`SELECT b.* FROM competition_boards b JOIN competition_release_boards rb ON rb.board_id=b.id WHERE b.id=$1 AND rb.release_id=$2 AND b.work_id=$3 AND b.status='active' FOR SHARE OF b`,[id,scope.releaseId,scope.workId])).rows[0];
    if(!board)fail('COMPETITION_NOT_ALLOWED',403,'榜单已停用或不属于当前游戏版本。');return board;
  };
  const ownedRun=async(client,scope,id)=>{
    const run=(await client.query('SELECT * FROM competition_runs WHERE id=$1 AND user_id=$2 AND release_id=$3 AND channel=$4 FOR UPDATE',[id,scope.userId,scope.releaseId,scope.channel])).rows[0];
    if(!run)fail('COMPETITION_RUN_NOT_FOUND',404,'找不到本局成绩。');return run;
  };
  return {
    async boards(workId){
      if(workId==='gamehub-guess-baike')return socialService?[legacyDefinition]:[];
      if(!uuid.test(workId))return [];
      return (await pool.query(publicBoardsSql+' ORDER BY b.board_key,b.ruleset_version DESC',[workId])).rows.map(boardView);
    },
    async modes(actor,token){return withTransaction(pool,async client=>{
      const scope=await resolve(client,actor,token);
      return (await client.query(`SELECT b.* FROM competition_boards b JOIN competition_release_boards rb ON rb.board_id=b.id WHERE rb.release_id=$1 AND b.id=ANY($2::uuid[]) AND b.status='active' ORDER BY b.board_key`,[scope.releaseId,scope.modeIds])).rows.map(boardView);
    });},
    async start(actor,token,{boardId,requestId}){return withTransaction(pool,async client=>{
      await lockUser(client,actor.userId);const scope=await resolve(client,actor,token),board=await authorizedBoard(client,scope,boardId);
      const prior=(await client.query('SELECT * FROM competition_runs WHERE user_id=$1 AND release_id=$2 AND request_id=$3',[scope.userId,scope.releaseId,requestId])).rows[0];
      if(prior){if(prior.board_id!==boardId||prior.channel!==scope.channel)fail('COMPETITION_IDEMPOTENCY_CONFLICT',409,'这个请求标识已用于其他运行。');return runView(prior);}
      const now=clock();
      const count=(await client.query("SELECT count(*)::int AS n FROM competition_runs WHERE user_id=$1 AND issued_at>$2",[scope.userId,new Date(now.getTime()-3600000)])).rows[0].n;
      if(count>=COMPETITION_LIMITS.runsPerHour)fail('COMPETITION_RATE_LIMITED',429,'本小时挑战次数已达上限，请稍后再试。');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('competition:capacity',0))");
      const retained=(await client.query('SELECT count(*)::int AS n FROM (SELECT 1 FROM competition_runs LIMIT $1) bounded',[COMPETITION_LIMITS.retainedRuns])).rows[0].n;
      if(retained>=COMPETITION_LIMITS.retainedRuns)fail('COMPETITION_CAPACITY_REACHED',503,'排行榜记录容量已达上限，暂时不能开始新挑战。自由游玩仍可使用。');
      const period=board.definition.period==='daily'?chinaDate(now):'all-time';
      // Daily runs cannot submit into a closed day. All-time runs expire after two hours.
      const expires=new Date(Math.min(now.getTime()+7200000,board.definition.period==='daily'?Date.parse(period+'T00:00:00+08:00')+86400000:Infinity));
      const row=(await client.query(`INSERT INTO competition_runs(id,board_id,user_id,release_id,channel,request_id,period_key,seed,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[crypto.randomUUID(),boardId,scope.userId,scope.releaseId,scope.channel,requestId,period,crypto.randomBytes(4).readUInt32LE(),now,expires])).rows[0];return runView(row);
    });},
    async get(actor,token,id){return withTransaction(pool,async client=>{const scope=await resolve(client,actor,token),run=await ownedRun(client,scope,id);await authorizedBoard(client,scope,run.board_id);return runView(run);});},
    async abandon(actor,token,id){return withTransaction(pool,async client=>{await lockUser(client,actor.userId);const scope=await resolve(client,actor,token),run=await ownedRun(client,scope,id);await authorizedBoard(client,scope,run.board_id);if(run.status==='issued')await client.query("UPDATE competition_runs SET status='abandoned' WHERE id=$1",[id]);return {abandoned:run.status==='issued'||run.status==='abandoned'};});},
    async finish(actor,token,id,body){return withTransaction(pool,async client=>{
      await lockUser(client,actor.userId);const scope=await resolve(client,actor,token),run=await ownedRun(client,scope,id),board=await authorizedBoard(client,scope,run.board_id),definition=board.definition;
      const digest=hash(body);
      if(run.submission_hash){if(run.submission_hash!==digest)fail('COMPETITION_IDEMPOTENCY_CONFLICT',409,'本局已经提交了不同的成绩。');return {...runView(run),verification:definition.verification};}
      if(run.status!=='issued'||new Date(run.expires_at)<=clock())fail('COMPETITION_RUN_CLOSED',409,'本局已结束或超时，请开始新的一局。');
      let metrics;
      if(definition.verification==='replay_verified'){
        let calculated;try{calculated=verifyTileMerge(Number(run.seed),body.evidence);}catch{fail('COMPETITION_EVIDENCE_INVALID',422,'操作记录不符合本游戏规则。');}
        metrics=Object.fromEntries(definition.metrics.map(metric=>[metric.key,calculated[metric.key]]));
        if(body.metrics&&canonical(metrics)!==canonical(body.metrics))fail('COMPETITION_SCORE_MISMATCH',422,'上报成绩与规则复算结果不同。');
      }else{if(body.evidence!==undefined)fail('COMPETITION_EVIDENCE_INVALID',422,'休闲榜仅接受声明的指标。');metrics=body.metrics;}
      try{metrics=validateCompetitionMetrics(definition,metrics);}catch(error){fail('COMPETITION_METRICS_INVALID',422,error.message);}
      const row=(await client.query(`UPDATE competition_runs SET status='accepted',submitted_at=$2,submission_hash=$3,metrics=$4,sort_key=$5,evidence=$6 WHERE id=$1 RETURNING *`,[id,clock(),digest,metrics,competitionSortKey(definition,metrics),body.evidence??null])).rows[0];
      if(scope.channel==='production')await project(client,row);
      return {...runView(row),verification:definition.verification};
    });},
    async leaderboard(actor,workId,boardId,{date,puzzleId,limit=10,offset=0}={}){
      if(boardId==='daily'&&workId==='gamehub-guess-baike')return {...await socialService.workLeaderboard(actor,{workId,date,puzzleId,limit,offset}),definition:legacyDefinition};
      const board=(await this.boards(workId)).find(row=>row.id===boardId);if(!board)fail('COMPETITION_BOARD_NOT_FOUND',404,'这个游戏尚未开放此排行榜。');
      const period=board.period==='daily'?(date??chinaDate(clock())):'all-time';
      if(board.period==='daily'&&(!/^\d{4}-\d{2}-\d{2}$/.test(period)||period<'0001-01-01'||!Number.isFinite(Date.parse(period+'T00:00:00Z'))||new Date(period+'T00:00:00Z').toISOString().slice(0,10)!==period||period>chinaDate(clock())))fail('SCHEMA_INVALID',400,'请选择有效的榜单日期。');
      const avatar=`a.kind AS avatar_kind,a.preset_key,a.media_type,a.animated,encode(a.sha256,'hex') AS sha256_hex,(a.poster_key IS NOT NULL OR a.poster_body IS NOT NULL) AS has_poster`;
      const result=(await pool.query(`WITH ranked AS (
        SELECT e.*,u.display_name,(u.id=$3::uuid) AS is_me,row_number() OVER(ORDER BY e.sort_key,e.achieved_at,e.run_id) AS rank
        FROM competition_entries e JOIN users u ON u.id=e.user_id WHERE e.board_id=$1 AND e.period_key=$2 AND u.status='active' AND u.social_visibility='public'
        AND NOT EXISTS(SELECT 1 FROM user_blocks x WHERE (x.blocker_user_id=$3 AND x.blocked_user_id=u.id) OR (x.blocker_user_id=u.id AND x.blocked_user_id=$3))
      ), page AS (SELECT * FROM ranked ORDER BY rank LIMIT $4 OFFSET $5), public_rows AS (SELECT p.*,${avatar} FROM page p LEFT JOIN user_avatars a ON a.user_id=p.user_id),
      mine AS (SELECT e.*,u.display_name,true AS is_me,r.rank,${avatar} FROM competition_entries e JOIN users u ON u.id=e.user_id LEFT JOIN ranked r ON r.user_id=e.user_id LEFT JOIN user_avatars a ON a.user_id=e.user_id WHERE e.board_id=$1 AND e.period_key=$2 AND e.user_id=$3 AND u.status='active')
      SELECT (SELECT count(*) FROM ranked)::int AS total,COALESCE((SELECT jsonb_agg(public_rows ORDER BY rank) FROM public_rows),'[]'::jsonb) AS entries,(SELECT to_jsonb(mine) FROM mine) AS my_entry`,[boardId,period,actor?.userId??null,limit,offset])).rows[0];
      const view=row=>row?{rank:row.rank==null?null:Number(row.rank),player:{id:row.user_id,displayName:row.display_name,isMe:row.is_me,avatar:row.avatar_kind==='upload'?{kind:'upload',presetKey:null,url:`/v1/avatars/${row.user_id}?v=${row.sha256_hex.slice(0,12)}`,staticUrl:row.has_poster?`/v1/avatars/${row.user_id}?variant=static&v=${row.sha256_hex.slice(0,12)}`:null,mediaType:row.media_type,animated:row.animated}:{kind:'preset',presetKey:row.preset_key||'cat',url:null,staticUrl:null,mediaType:null,animated:false}},scores:row.metrics,completedAt:new Date(row.achieved_at).toISOString()}:null;
      return {workId,boardId,title:board.title,date:board.period==='daily'?period:null,timeZone:board.timeZone,puzzleId:null,verification:board.verification,definition:board,metrics:board.metrics,entries:result.entries.map(view),myEntry:view(result.my_entry),total:result.total,limit,offset,hasMore:offset+result.entries.length<result.total};
    },
    async moderate(actor,id,{action,reason}){
      if(actor?.profile?.role!=='admin')fail('ADMIN_REQUIRED',403,'需要管理员权限。');
      return withTransaction(pool,async client=>{
        const initial=(await client.query('SELECT * FROM competition_runs WHERE id=$1',[id])).rows[0];if(!initial)fail('COMPETITION_RUN_NOT_FOUND',404,'找不到本局成绩。');
        await lockUser(client,initial.user_id);const run=(await client.query('SELECT * FROM competition_runs WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!['accepted','invalidated'].includes(run.status))fail('COMPETITION_RUN_CLOSED',409,'本局没有可管理的成绩。');
        await client.query('UPDATE competition_runs SET status=$2 WHERE id=$1',[id,action==='invalidate'?'invalidated':'accepted']);
        await client.query('INSERT INTO competition_moderation_events(actor_user_id,run_id,action,reason) VALUES($1,$2,$3,$4)',[actor.userId,id,action,reason]);
        await client.query('DELETE FROM competition_entries WHERE board_id=$1 AND period_key=$2 AND user_id=$3',[run.board_id,run.period_key,run.user_id]);
        const best=(await client.query("SELECT * FROM competition_runs WHERE board_id=$1 AND period_key=$2 AND user_id=$3 AND status='accepted' AND channel='production' ORDER BY sort_key,submitted_at,id LIMIT 1",[run.board_id,run.period_key,run.user_id])).rows[0];if(best)await project(client,best);
        return {status:action==='invalidate'?'invalidated':'accepted'};
      });
    },
    async cleanOnce(){
      // Keep accepted metrics for audit/rebuild. Raw evidence is bounded and expires after seven days.
      const evidence=await pool.query("UPDATE competition_runs SET evidence=NULL WHERE id IN (SELECT id FROM competition_runs WHERE evidence IS NOT NULL AND submitted_at<now()-interval '7 days' ORDER BY submitted_at LIMIT 200)");
      const expired=await pool.query("DELETE FROM competition_runs WHERE id IN (SELECT id FROM competition_runs WHERE status IN ('issued','abandoned') AND expires_at<now()-interval '1 day' ORDER BY expires_at LIMIT 200)");
      return {evidenceRemoved:evidence.rowCount,expiredRemoved:expired.rowCount};
    },
  };
}
