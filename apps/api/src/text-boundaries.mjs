export function unicodePrefix(value,limit) {
  const text=String(value??'').toWellFormed().slice(0,limit);
  const last=text.charCodeAt(text.length-1);
  return last>=0xd800&&last<=0xdbff?text.slice(0,-1):text;
}

export function isDatabaseJson(value,depth=0,ancestors=new Set()) {
  if(depth>32)return false;
  if(value===null||value===undefined||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(typeof value==='string')return value.isWellFormed()&&!value.includes('\0');
  if(typeof value!=='object'||ancestors.has(value))return false;
  ancestors.add(value);
  const valid=Object.entries(value).every(([key,item])=>key.isWellFormed()&&!key.includes('\0')&&isDatabaseJson(item,depth+1,ancestors));
  ancestors.delete(value);return valid;
}
