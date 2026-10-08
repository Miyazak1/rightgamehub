export function createCompetitionHandlers({apiClient,descriptor,getGameSession,signal,checkIdentity}) {
  const options={signal,beforeRequest:checkIdentity};
  const data=async call=>(await call).data;
  const session=()=>getGameSession('competition');
  return {handlers:{
    'competition.modes.list':async()=>data(apiClient.listCompetitionModes(await session(),options)),
    'competition.runs.start':async({boardId,requestId})=>data(apiClient.startCompetitionRun(await session(),{boardId,requestId},options)),
    'competition.runs.get':async({runId})=>data(apiClient.getCompetitionRun(await session(),runId,options)),
    'competition.runs.finish':async({runId,metrics,evidence})=>data(apiClient.finishCompetitionRun(await session(),runId,{...(metrics!==undefined?{metrics}:{}),...(evidence!==undefined?{evidence}:{})},options)),
    'competition.runs.abandon':async({runId})=>data(apiClient.abandonCompetitionRun(await session(),runId,options)),
    'competition.leaderboards.get':async({boardId,date,limit=10,offset=0})=>{
      if(!Number.isInteger(limit)||limit<1||limit>10)throw Object.assign(new Error('SDK leaderboard pages contain 1–10 entries.'),{code:'SCHEMA_INVALID'});
      return data(apiClient.readCompetitionLeaderboard(descriptor.workId,boardId,{date,limit,offset},options));
    },
  }};
}
