import {createHash} from 'node:crypto';
// New requests only. Historical canonical() and stored checkpoints retain their original algorithm.
export const STABLE_JSON_VERSION='stable-json-v1'         ;
export function stableJson(value        )        {
 const active=new Set        ();
 const visit=(x    )       =>{if(x===null)return 'null';if(typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);if(typeof x!=='object'||active.has(x))throw Error('STABLE_JSON_INVALID');active.add(x);try{if(Array.isArray(x)){const a         =[];for(let i=0;i<x.length;i++){if(!Object.hasOwn(x,i))throw Error('STABLE_JSON_INVALID');const d=Object.getOwnPropertyDescriptor(x,String(i)) ;if(!Object.hasOwn(d,'value'))throw Error('STABLE_JSON_INVALID');a.push(visit(d.value));}if(Object.keys(x).some(k=>!/^\d+$/.test(k)||String(Number(k))!==k||Number(k)>=x.length))throw Error('STABLE_JSON_INVALID');return '['+a.join(',')+']';}if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)throw Error('STABLE_JSON_INVALID');const keys=Object.keys(x).sort();return '{'+keys.map(k=>{const d=Object.getOwnPropertyDescriptor(x,k) ;if(!Object.hasOwn(d,'value'))throw Error('STABLE_JSON_INVALID');return JSON.stringify(k)+':'+visit(d.value);}).join(',')+'}';}finally{active.delete(x);}};
 return visit(value);
}
export const stableHash=(value        )=>createHash('sha256').update(stableJson(value)).digest('hex');
