const compact=value=>String(value??'').replace(/\s+/gu,' ').trim();
const dateKey=date=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}${value.month}${value.day}`;
};
const topicTags=work=>[...(work.tags??[]).map(compact),work.kind==='game'?'网页游戏':'互动作品',work.openSource?'开源游戏':'免费游戏'].filter(Boolean).slice(0,5);

export function buildXhsDraft(work,{origin='https://mooyu.fun',now=new Date()}={}){
  const title=compact(work.title||'墨鱼工坊作品');
  const campaignKey=`xhs-${dateKey(now)}-${String(work.id).slice(0,8)}`;
  const url=new URL(`/w/${encodeURIComponent(work.id)}`,origin);
  url.searchParams.set('gh_src','campaign');
  url.searchParams.set('gh_campaign',campaignKey);
  const source=work.repositoryUrl
    ? `源码：已公开${work.licenseSpdx?`（${work.licenseSpdx}）`:''}`
    : '来源与授权信息：见作品详情页';
  const minutes=work.estimatedMinutes?`大约 ${work.estimatedMinutes} 分钟就能体验一局。`:'打开浏览器就能开始体验。';
  const hashtags=topicTags(work).map(tag=>`#${tag.replace(/\s+/gu,'')}`).join(' ');
  return {
    title:`这个${work.openSource?'开源':'免费'}小游戏，打开浏览器就能玩｜${title}`.slice(0,60),
    body:[
      `最近在墨鱼工坊发现《${title}》。`,
      compact(work.description)||'一款可以直接在线体验的轻量作品。',
      '',
      `✦ ${minutes}`,
      `✦ ${source}`,
      '✦ 不需要注册，打开即可试玩。',
      '',
      `免费体验：${url}`,
      hashtags,
    ].join('\n'),
    campaignKey,
    url:String(url),
  };
}
