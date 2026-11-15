import { rejectPractice } from './error.mjs';
import { publicPracticeQuestion } from './service.mjs';

export function normalizeLearningQuery(input = {}) {
  const allowed = ['view','days','subjectId','stageId','topicId','difficultyId','limit','offset'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k)))
    rejectPractice('LEARNING_QUERY_INVALID',400,'学习数据筛选无效。');
  const q={view:input.view??'summary',days:Number(input.days??30),limit:Number(input.limit??10),offset:Number(input.offset??0)};
  if (!['summary','history','wrong'].includes(q.view)||![0,7,30,90,365].includes(q.days)||!Number.isInteger(q.limit)||q.limit<1||q.limit>20||!Number.isInteger(q.offset)||q.offset<0||q.offset>1000)
    rejectPractice('LEARNING_QUERY_INVALID',400,'学习数据筛选无效。');
  for(const key of ['subjectId','stageId','topicId','difficultyId']) if(input[key]!=null&&input[key]!=='') {
    if(typeof input[key]!=='string'||!/^[a-zA-Z0-9._:-]{1,100}$/.test(input[key]))rejectPractice('LEARNING_QUERY_INVALID',400,'学习数据筛选无效。');
    q[key]=input[key];
  }
  return q;
}

// All aggregates cover the entire matching account dataset, not the history UI's
// most recent 50 batches. Only submitted, answered questions count in accuracy.
export async function queryLearningInsights(pool,userId,input={},now=new Date()) {
  const q=normalizeLearningQuery(input),asOf=new Date(now).toISOString();
  const since=q.days?new Date(new Date(asOf).getTime()-q.days*86400000).toISOString():null;
  const values=[userId,since,asOf,...['subjectId','stageId','topicId','difficultyId'].map(k=>q[k]??null)];
  const cte=`WITH batches AS (SELECT * FROM practice_batches WHERE user_id=$1
    AND ($2::timestamptz IS NULL OR COALESCE(completed_at,created_at)>=$2)
    AND COALESCE(completed_at,created_at)<=$3
    AND ($4::text IS NULL OR config->>'subjectId'=$4)
    AND ($5::text IS NULL OR config->>'stageId'=$5)
    AND ($6::text IS NULL OR config->>'topicId'=$6)
    AND ($7::text IS NULL OR config->>'difficultyId'=$7)),
    questions AS (SELECT b.id,b.config,b.completed_at,item FROM batches b
      CROSS JOIN LATERAL jsonb_array_elements(b.items) item WHERE b.status='completed')`;
  const result={schemaVersion:1,scope:'platform-practice',query:q,window:{since,asOf,basis:'completedAt-or-createdAt'},
    coverage:{submittedOnlyForAccuracy:true,unansweredIsIncorrect:false,includesCoursewareProgress:false,statisticsTruncated:false}};
  // One statement per view gives one consistent PostgreSQL snapshot.
  if(q.view==='summary') {
    const {rows}=await pool.query(`${cte} SELECT
      (SELECT count(*)::int FROM batches WHERE status='completed') AS "completedBatches",
      (SELECT count(*)::int FROM batches WHERE status IN ('queued','preparing','ready')) AS "inProgressBatches",
      count(*)::int AS questions,count(*) FILTER(WHERE item->>'answer' IS NOT NULL)::int AS answered,
      count(*) FILTER(WHERE item->>'answer' IS NULL)::int AS unanswered,
      count(*) FILTER(WHERE item->>'answer'=item->'question'->>'correctAnswer')::int AS correct,
      COALESCE((SELECT jsonb_agg(t) FROM (SELECT config->>'subjectId' AS "subjectId",config->>'stageId' AS "stageId",
        config->>'topicId' AS "topicId",config->>'difficultyId' AS "difficultyId",count(*)::int AS questions,
        count(*) FILTER(WHERE item->>'answer' IS NOT NULL)::int AS answered,
        count(*) FILTER(WHERE item->>'answer'=item->'question'->>'correctAnswer')::int AS correct
        FROM questions GROUP BY 1,2,3,4 ORDER BY 1,2,3,4) t),'[]'::jsonb) AS topics FROM questions`,values);
    const row=rows[0];const score=r=>({...r,unanswered:r.questions-r.answered,incorrect:r.answered-r.correct,accuracy:r.answered?r.correct/r.answered:null});
    result.summary=score({...row,topics:row.topics.map(score)});
  } else {
    const sql=q.view==='history'
      ? `${cte} SELECT id,config,status,created_at AS "createdAt",completed_at AS "completedAt",
          jsonb_array_length(items) AS total,(SELECT count(*)::int FROM jsonb_array_elements(items) i WHERE i->>'answer' IS NOT NULL) AS answered
        FROM batches ORDER BY created_at DESC,id LIMIT $8 OFFSET $9`
      : `${cte} SELECT id AS "batchId",config,item FROM questions
        WHERE item->>'answer' IS NOT NULL AND item->>'answer' IS DISTINCT FROM item->'question'->>'correctAnswer'
        ORDER BY completed_at DESC,id,item->'question'->>'id' LIMIT $8 OFFSET $9`;
    const {rows}=await pool.query(sql,[...values,q.limit+1,q.offset]);
    result.items=rows.slice(0,q.limit).map(row=>q.view==='history'?row:{batchId:row.batchId,config:row.config,
      question:publicPracticeQuestion(row.item,row.config.language,true)});
    result.pagination={limit:q.limit,offset:q.offset,returned:result.items.length,hasMore:rows.length>q.limit};
  }
  return result;
}
