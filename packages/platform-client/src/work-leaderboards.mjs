export const leaderboardToday = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const workLeaderboardPath = (workId,date,puzzleId) => `/works/${encodeURIComponent(workId)}/leaderboard${date?'/'+encodeURIComponent(date):''}${date&&puzzleId?'/'+encodeURIComponent(puzzleId):''}`;
