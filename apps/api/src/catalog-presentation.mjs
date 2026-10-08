// Editorial corrections for the original launch catalog. Author edits take
// precedence; stored work metadata, ownership and releases are not modified.
const launchCopy = {
  '7359a350-cc0a-4a09-875d-cec9b5b8f93f': { originalTitle:'2048', title:'2048', oldDescription:'The source code for 2048', description:'滑动数字方块，合并相同数字，挑战 2048。', tags:['数字','益智'] },
  // Title and description verified against Miyazak1/oi-remake-game README.
  '314fb01a-27da-4c28-947a-68b20176a6cf': { originalTitle:'oi-remake-game', title:'OI 重开模拟器', oldDescription:'', description:'分配天赋、安排训练，体验信息学竞赛选手的成长历程。', tags:['文字','模拟'] },
  'f8537969-5f6b-41a8-8c43-f46a0f4a1293': {originalTitle:'桌猫',title:'桌猫',oldDescription:'鹏总',description:'一只像素小猫，陪你度过片刻休息时间。',tags:['像素','休闲']},
  '1a13df55-8906-4b03-a19a-5e5a3b776649': {originalTitle:'迷阵',title:'迷阵',oldDescription:'棋类游戏',description:'用于体验和验证联机对局的测试作品。',tags:['联机测试']},
};
export function presentCatalogWork(work) {
  const copy=launchCopy[work.id],tags=(work.tags??[]).filter(tag=>tag!=='github-import');
  if(!copy||work.title!==copy.originalTitle)return {...work,tags};
  return {...work,title:copy.title,description:(work.description??'').trim()===copy.oldDescription?copy.description:work.description,tags:tags.length?tags:copy.tags};
}
export function editorialSearchIds(query) {
  return query?Object.entries(launchCopy).filter(([,copy])=>[copy.title,copy.description,...copy.tags].join(' ').toLowerCase().includes(query)).map(([id,copy])=>({id,title:copy.originalTitle})):[];
}
