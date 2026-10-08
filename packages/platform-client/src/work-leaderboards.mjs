// Add games here only after their server-side read adapter is available.
export const workLeaderboards = Object.freeze({
  'gamehub-guess-baike': {title:'每日挑战榜',playerCenter:'/games/guess-baike/players'},
});
export const leaderboardToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const workLeaderboardPath = (workId,date,puzzleId) => `/works/${encodeURIComponent(workId)}/leaderboard${date?'/'+encodeURIComponent(date):''}${date&&puzzleId?'/'+encodeURIComponent(puzzleId):''}`;
