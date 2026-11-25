// One bounded native read. Never starts the channel, samples in a loop, sends
// a message, replays history into the inbox, or invokes QQ login/recovery.
export function summarizeGroupHistory(value){
 const list=value?.messages;if(!Array.isArray(list)||list.length>1000)throw Object.assign(Error(),{code:'HISTORY_SHAPE_UNAVAILABLE'});
 const instant=m=>typeof m.time==='number'&&Number.isFinite(m.time)&&m.time>0&&m.time<1e11?m.time*1000:null;
 const times=list.map(instant).filter(v=>v!==null),start=Date.parse('2026-11-25T04:55:00Z'),end=Date.parse('2026-11-25T05:20:00Z');
 const describe=m=>{
  const parts=Array.isArray(m.message)?m.message:null,known=new Set(['text','at','reply','image','face','record','video','file','json','xml','forward','node']);
  const text=parts?.filter(p=>p?.type==='text').map(p=>typeof p.data?.text==='string'?p.data.text:'').join('').trim();
  const t=instant(m),types=parts?[...new Set(parts.map(p=>known.has(p?.type)?p.type:'other'))].slice(0,16):[];
  return {at:t===null?null:new Date(t).toISOString(),messageIdType:typeof m.message_id,
   numericSafeMessageId:Number.isSafeInteger(m.message_id),messageFormat:parts?'array':typeof m.message==='string'?'string':'other',
   segmentTypes:types,segmentCount:parts?.length??null,atExpectedBot:parts?.some(p=>p?.type==='at'&&String(p.data?.qq)==='3922489710')??null,
   replyPresent:types.includes('reply'),outsideTextAndAt:parts?.some(p=>!['text','at'].includes(p?.type))??null,
   textBytes:typeof text==='string'?Buffer.byteLength(text):null,textHasControlCharacters:typeof text==='string'?/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text):null};
 };
 const caller=list.filter(m=>String(m.user_id??m.sender?.user_id)==='495469022');
 return {returnedMessages:list.length,returnedCallerMessages:caller.length,
  oldestReturnedAt:times.length?new Date(Math.min(...times)).toISOString():null,newestReturnedAt:times.length?new Date(Math.max(...times)).toISOString():null,
  incidentCallerMessages:caller.filter(m=>instant(m)!==null&&instant(m)>=start&&instant(m)<=end).slice(0,12).map(describe),
  latestCallerMessages:[...caller].sort((a,b)=>(instant(b)??0)-(instant(a)??0)).slice(0,5).map(describe),
  historyIsNotWireEvent:true,completeIncidentCoverageProven:false,rawMessageContentPrinted:false};
}

export const HISTORY_SHAPE_PROBE=`
import {NapCatControl} from '/app/apps/qq-channel/src/napcat-control.mjs';
${summarizeGroupHistory.toString()}
const control=new NapCatControl({token:process.env.QQ_NAPCAT_TOKEN,accessToken:process.env.QQ_ACCESS_TOKEN});
const post=control.post.bind(control);let managementAuthRequests=0,historyRequests=0;
control.post=async(path,body,auth,signal)=>{
 if(path==='/auth/login'){if(++managementAuthRequests>1)throw Object.assign(Error(),{code:'READ_LIMIT_REACHED'});}
 else if(path==='/Debug/call'&&body?.action==='get_group_msg_history'){if(++historyRequests>1)throw Object.assign(Error(),{code:'READ_LIMIT_REACHED'});}
 else throw Object.assign(Error(),{code:'READ_ONLY_REQUIRED'});
 return post(path,body,auth,signal);
};
const out={managementAuthRequests:0,historyRequests:0,qqLoginRequested:false,qrRequested:false,messagesSent:false,
 configurationWritten:false,servicesRestarted:false,oldTasksRetried:false};
try{
 const value=control.unwrap(await control.post('/Debug/call',{action:'get_group_msg_history',params:{group_id:905757031,count:100,reverseOrder:true}},true,AbortSignal.timeout(15000)));
 out.result='GROUP_HISTORY_SHAPE_READ';out.history=summarizeGroupHistory(value);
}catch(e){out.result='GROUP_HISTORY_SHAPE_UNAVAILABLE';out.code=/^[A-Z0-9_]{1,100}$/.test(e?.code??'')?e.code:'BOUNDED_READ_FAILED';}
finally{control.stop();out.managementAuthRequests=managementAuthRequests;out.historyRequests=historyRequests;}
console.log(JSON.stringify(out,null,2));`;
