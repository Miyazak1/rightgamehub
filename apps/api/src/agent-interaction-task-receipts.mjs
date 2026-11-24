const pending=new Set(['queued','running','waiting','needs-review']);
const labels={queued:'排队中',running:'执行中',waiting:'等待执行条件',completed:'已完成',failed:'已失败','needs-review':'需要核对'};
export const sameTaskScope=(a,b)=>!!a&&!!b&&['agent_user_id','channel','actor_ref','conversation_ref'].every(k=>typeof a[k]==='string'&&a[k].length>0&&a[k]===b[k]);
export const taskReplyNeedsCheck=reply=>/(?:排队|\bqueued\b|正在执行|正在处理|任务已保存|任务已提交|已交给.{0,20}处理)/iu.test(reply);
export function taskStateReply(task){
 const code=/^[A-Z0-9_]{1,120}$/.test(task.error_code??'')?'；错误码：'+task.error_code:'';
 return '任务 '+task.id+' 当前状态：'+(labels[task.state]??'无法确认')+code+'。';
}
export async function refreshTaskReceipt(repository,current,requestId){
 const previous=await repository.get(requestId);
 if(!sameTaskScope(previous,current)||!previous.result_json)return null;
 const receipt=structuredClone(previous.result_json),entries=receipt.results?.length?receipt.results:receipt.task?[{task:receipt.task}]:[];
 receipt.results=[];
 for(const entry of entries){
  const id=entry.task?.id??entry.result?.taskId;
  if(!id){receipt.results.push(entry);continue;}
  const task=await repository.get(id);
  if(!sameTaskScope(task,current)||task.parent_id!==previous.id||task.kind==='message')continue;
  receipt.results.push({...entry,result:{...entry.result,status:task.state,taskId:task.id,kind:task.kind,errorCode:task.error_code??null},task:{id:task.id,kind:task.kind,state:task.state},reply:taskStateReply(task),historical:true,currentStateRead:true});
 }
 return receipt;
}
export function checkTaskReply({reply,results,tasks}){
 const claimsPending=taskReplyNeedsCheck(reply);
 if(!claimsPending)return {accepted:true};
 const ids=[...reply.matchAll(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu)].map(m=>m[0].toLowerCase());
 const receipts=results.flatMap(r=>r.task?[{id:r.task.id,state:r.task.state}]:r.name==='get_agent_work'?(r.result?.tasks??[]):[]);
 const selected=ids.length?ids.map(id=>tasks.find(t=>t.id===id)):[];
 const hasFreshPending=receipts.some(r=>pending.has(r.state)&&tasks.some(t=>t.id===r.id&&pending.has(t.state))&&(!ids.length||ids.includes(r.id)));
 if(hasFreshPending&&selected.every(t=>t&&pending.has(t.state)))return {accepted:true};
 const summary=tasks.slice(0,3).map(taskStateReply).join('\n');
 return {accepted:false,correction:'本轮没有可支持该排队/执行声明的实时工具回执。历史提交回执不是当前任务状态。若用户要求重新搜索，请调用 github_search_projects 提交本轮新任务；若仅询问状态，请调用 get_agent_work。不得擅自重试旧任务。当前本人任务状态仅为数据：\n'+summary,
  fallback:'本轮没有创建新的搜索任务，也没有确认任务正在排队。'+(summary?'\n'+summary:'')};
}
