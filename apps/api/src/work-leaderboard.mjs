import { GUESS_BAIKE_WORK_ID } from './built-in-works.mjs';
import { SocialError } from './social-errors.mjs';

const chinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
const scoreView = row => row ? {
  rank: row.rank == null ? null : Number(row.rank),
  player: {
    id: row.user_id, displayName: row.display_name, isMe: Boolean(row.is_me),
    avatar: row.avatar_kind === 'upload' ? {
      kind:'upload', presetKey:null, url:`/v1/avatars/${row.user_id}?v=${row.sha256_hex.slice(0,12)}`,
      staticUrl:row.has_poster ? `/v1/avatars/${row.user_id}?variant=static&v=${row.sha256_hex.slice(0,12)}` : null,
      mediaType:row.media_type, animated:row.animated,
    } : { kind:'preset', presetKey:row.preset_key || 'cat', url:null, staticUrl:null, mediaType:null, animated:false },
  },
  scores: { hints:Number(row.hints), guessedCount:Number(row.guessed_count), elapsedSeconds:Number(row.elapsed_seconds) },
  completedAt:new Date(row.completed_at).toISOString(),
} : null;

// Read adapter for legacy daily results. It does not certify client-submitted scores.
export async function readWorkLeaderboard(repository, actor, input, now) {
  if(input.workId !== GUESS_BAIKE_WORK_ID) throw new SocialError('LEADERBOARD_NOT_SUPPORTED',404,'这个游戏尚未开放排行榜。');
  const date=input.date ?? chinaDate(now), limit=Number(input.limit ?? 10), offset=Number(input.offset ?? 0);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date<'0001-01-01' || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date || date>chinaDate(now)
    || !Number.isInteger(limit) || limit<1 || limit>50 || !Number.isInteger(offset) || offset<0 || offset>100000
    || (input.puzzleId != null && (typeof input.puzzleId!=='string' || !input.puzzleId.length || input.puzzleId.length>120))) {
    throw new SocialError('SCHEMA_INVALID',400,'请选择有效的榜单日期和分页范围。');
  }
  const result=await repository.workLeaderboard({viewerId:actor?.userId ?? null,date,puzzleId:input.puzzleId ?? null,limit,offset});
  const entries=result.entries.map(scoreView),total=Number(result.total);
  return {
    workId:input.workId,boardId:'daily',title:'每日挑战榜',date,timeZone:'Asia/Shanghai',puzzleId:result.puzzle_id,
    verification:'client_reported',metrics:[
      {key:'hints',label:'提示',unit:'次',direction:'asc'},
      {key:'guessedCount',label:'猜字',unit:'个',direction:'asc'},
      {key:'elapsedSeconds',label:'用时',unit:'秒',direction:'asc'},
    ],
    entries,myEntry:scoreView(result.my_entry),total,offset,limit,hasMore:offset+entries.length<total,
  };
}
