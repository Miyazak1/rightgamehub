import React from 'react';
import {useI18n} from './I18n.jsx';
import {MathContent} from './PracticeMath.tsx';

export function LearningDataCard({result,go}) {
  const {locale}=useI18n(),en=locale==='en';if(result?.scope!=='platform-practice')return null;
  const s=result.summary,label=value=>typeof value==='object'?value?.[en?'en':'zh-CN']:value;
  return <section className="agent-learning-card" aria-label={en?'Learning data':'学习数据'}>
    <header><strong>{en?'Your practice records':'你的练习记录'}</strong><small>{result.query.days?(en?`Last ${result.query.days} days`:`最近 ${result.query.days} 天`):(en?'All records':'全部记录')}</small></header>
    {s&&<><dl className="agent-stat-grid"><div><dt>{en?'Answered':'已作答'}</dt><dd>{s.answered}</dd></div><div><dt>{en?'Correct':'答对'}</dt><dd>{s.correct}</dd></div><div><dt>{en?'Accuracy':'正确率'}</dt><dd>{s.accuracy===null?'—':Math.round(s.accuracy*100)+'%'}</dd></div><div><dt>{en?'Unanswered':'未作答'}</dt><dd>{s.unanswered}</dd></div></dl>
      {!s.questions&&<p>{en?'No submitted practice matches these filters. This does not indicate mastery.':'当前范围还没有已提交的练习记录，暂时无法判断掌握情况。'}</p>}
      {s.topics?.length>0&&<ul>{s.topics.slice(0,8).map((t,i)=><li key={i}><span>{label(t.title)||t.topicId} · {t.difficultyId}</span><strong>{t.correct}/{t.answered}</strong></li>)}</ul>}{s.topics?.length>8&&<small>{en?'Showing the first 8 topic groups. Use filters to narrow the view.':'显示前 8 个知识点分组，可通过筛选缩小范围。'}</small>}</>}
    {result.items?.map(item=>item.question?<article key={item.batchId+':'+item.question.id}><MathContent text={item.question.prompt}/><small>{en?'Your answer':'你的答案'}：{item.question.answer} · {en?'Correct answer':'正确答案'}：{item.question.correctAnswer}</small><button onClick={()=>go('/learn/practice/'+item.batchId)}>{en?'Review question':'回看练习'} →</button></article>:<article key={item.id}><strong>{item.config.topicId}</strong><small>{item.answered}/{item.total} · {item.status}</small><button onClick={()=>go('/learn/practice/'+item.id)}>{en?'Open practice':'打开练习'} →</button></article>)}
    {result.items?.length===0&&<p>{en?'No matching records.':'当前筛选下没有记录。'}</p>}
    {result.pagination?.hasMore&&<small>{en?'More records are available in Learning data.':'还有更多记录，可在学习数据页面翻页查看。'}</small>}
    <footer>{en?'Submitted practice only · Unanswered questions are excluded from accuracy · Courseware progress is not included':'正确率仅统计已提交练习中的已答题目 · 未作答单独计数 · 不含课件学习进度'}</footer>
  </section>;
}

export default function PlatformAgentCards({results=[],go,openCapability,disabled}) {
  const {locale}=useI18n(),en=locale==='en';
  const seen=new Set();
  return <div className="agent-result-cards">{results.map((item,i)=>item.error?<p className="agent-tool-error" role="status" key={i}>{en?'Query incomplete. Try again.':'本次查询未完成，可调整条件后重试。'}</p>:item.name==='get_my_learning_data'?<LearningDataCard key={i} result={item.result} go={go}/>:<React.Fragment key={i}>{(item.result?.capabilities||[item.result?.capability]).filter(c=>{if(!c||seen.has(c.id))return false;seen.add(c.id);return true;}).map(c=><article className="agent-capability-card" key={c.id}>
    <small>{c.kind==='game'?(en?'GAME':'游戏'):c.kind==='official-tool'?(en?'TOOL':'工具'):(en?'LEARN':'学习')}</small><strong>{c.title}</strong><p>{c.description}</p><button disabled={disabled} onClick={()=>openCapability(c.id)}>{en?'Open':'打开'} →</button>
  </article>)}{item.result?.capabilities?.length===0&&<p>{en?'No matching available content.':'没有找到匹配的可用内容。'}</p>}</React.Fragment>)}</div>;
}
