import {createHash} from 'node:crypto';
export function validateArticleImage(v){
 const fail=()=>{throw Object.assign(new Error('QQ_AGENT_IMAGE_INVALID'),{code:'QQ_AGENT_IMAGE_INVALID',retryable:true});};
 if(v?.schemaVersion!=='agent-article-image-v1'||v.rendererVersion!==1||!Number.isInteger(v.pageCount)||v.pageCount<1||v.pageCount>24||!Number.isInteger(v.page)||v.page<0||v.page>=v.pageCount||!/^[a-f0-9-]{36}$/iu.test(v.revisionId??'')||v.mimeType!=='image/png'||typeof v.data!=='string'||v.data.length>1400000||!/^[a-f0-9]{64}$/u.test(v.sha256??''))fail();
 const data=Buffer.from(v.data,'base64');if(data.toString('base64')!==v.data||data.length>1048576||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||createHash('sha256').update(data).digest('hex')!==v.sha256)fail();
 return {...v};
}
