export const PRIVACY_TYPES=Object.freeze(['email','phone','idCard','bankCard','ipAddress','secret','custom']);

const labels=Object.freeze({email:'EMAIL',phone:'PHONE',idCard:'ID',bankCard:'BANK_CARD',ipAddress:'IP',secret:'SECRET',custom:'CUSTOM'});
const priorities=Object.freeze({secret:0,idCard:1,bankCard:2,email:3,phone:4,ipAddress:5,custom:6});

function allMatches(text,regex,type,validate=()=>true){
  const findings=[];
  for(const match of text.matchAll(regex)){
    const value=match[0],start=match.index??0;
    if(value&&validate(value))findings.push({type,value,start,end:start+value.length});
  }
  return findings;
}

function validChineseId(value){
  const normalized=value.toUpperCase();
  if(!/^\d{17}[\dX]$/u.test(normalized))return false;
  const year=Number(normalized.slice(6,10)),month=Number(normalized.slice(10,12)),day=Number(normalized.slice(12,14));
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return false;
  const weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2],checks='10X98765432';
  const sum=weights.reduce((total,weight,index)=>total+Number(normalized[index])*weight,0);
  return checks[sum%11]===normalized[17];
}

function passesLuhn(value){
  const digits=value.replace(/\D/gu,'');
  if(digits.length<16||digits.length>19||/^(\d)\1+$/u.test(digits))return false;
  let sum=0,double=false;
  for(let index=digits.length-1;index>=0;index--){let digit=Number(digits[index]);if(double){digit*=2;if(digit>9)digit-=9;}sum+=digit;double=!double;}
  return sum%10===0;
}

function validIpv4(value){return value.split('.').every(part=>Number(part)>=0&&Number(part)<=255&&String(Number(part))===part);}
function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');}

const detectors=Object.freeze({
  email:text=>allMatches(text,/(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w-])/giu,'email'),
  phone:text=>allMatches(text,/(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/gu,'phone'),
  idCard:text=>allMatches(text,/(?<!\d)\d{17}[\dXx](?!\d)/gu,'idCard',validChineseId),
  bankCard:text=>allMatches(text,/(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/gu,'bankCard',passesLuhn),
  ipAddress:text=>allMatches(text,/(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/gu,'ipAddress',validIpv4),
  secret:text=>[
    ...allMatches(text,/(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])/gu,'secret'),
    ...allMatches(text,/(?<![A-Za-z0-9])Bearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}/giu,'secret'),
  ],
});

export function scanSensitiveText(input,{types=PRIVACY_TYPES.filter(type=>type!=='custom'),customTerms=[]}={}){
  const text=String(input??''),enabled=new Set(types),found=[];
  for(const type of PRIVACY_TYPES){if(type!=='custom'&&enabled.has(type))found.push(...detectors[type](text));}
  if(enabled.has('custom'))for(const rawTerm of customTerms){
    const term=String(rawTerm??'').trim();if(!term)continue;
    found.push(...allMatches(text,new RegExp(escapeRegExp(term),'giu'),'custom'));
  }
  const accepted=[];
  for(const item of found.sort((a,b)=>a.start-b.start||(priorities[a.type]??99)-(priorities[b.type]??99)||b.end-a.end)){
    if(accepted.some(other=>item.start<other.end&&item.end>other.start))continue;
    accepted.push({...item,id:`${item.type}:${item.start}:${item.end}`});
  }
  return accepted.sort((a,b)=>a.start-b.start);
}

export function maskSensitiveValue(value,type){
  if(type==='email'){
    const at=value.indexOf('@');return at>0?`${value[0]}***${value.slice(at)}`:'***';
  }
  const digits=value.replace(/\D/gu,'');
  if(type==='phone')return digits.length>=7?`${digits.slice(0,3)}****${digits.slice(-4)}`:'***';
  if(type==='idCard')return `${digits.slice(0,6)}********${digits.slice(-4)}`;
  if(type==='bankCard')return `**** **** **** ${digits.slice(-4)}`;
  if(type==='ipAddress')return `***.***.***.${value.split('.').at(-1)}`;
  return '••••••••';
}

export function redactSensitiveText(input,findings,{selectedIds,mode='labels'}={}){
  const text=String(input??''),selected=selectedIds?new Set(selectedIds):null,counters={};let cursor=0,result='';
  for(const finding of findings){
    if(selected&&!selected.has(finding.id))continue;
    if(finding.start<cursor)continue;
    result+=text.slice(cursor,finding.start);
    counters[finding.type]=(counters[finding.type]||0)+1;
    result+=mode==='mask'?maskSensitiveValue(finding.value,finding.type):`[${labels[finding.type]||'PRIVATE'}_${counters[finding.type]}]`;
    cursor=finding.end;
  }
  return result+text.slice(cursor);
}

export function summarizeFindings(findings){return findings.reduce((summary,item)=>({...summary,[item.type]:(summary[item.type]||0)+1}),{});}
