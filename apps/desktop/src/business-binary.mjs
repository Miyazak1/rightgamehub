import {BLOB_RESULT_METHODS} from './parity-contract.mjs';
export async function encodeBusinessBinary(method,result){
  if(!BLOB_RESULT_METHODS.includes(method))return result;
  const value=result?.data;
  if(!value||typeof value.arrayBuffer!=='function'||value.size>64*1024**2)throw Object.assign(Error('DESKTOP_BINARY_RESPONSE_INVALID'),{code:'DESKTOP_BINARY_RESPONSE_INVALID',status:502});
  return {...result,data:{bytes:await value.arrayBuffer(),contentType:value.type}};
}
export function decodeBusinessBinary(method,result){
  if(!BLOB_RESULT_METHODS.includes(method))return result;
  if(!(result?.data?.bytes instanceof ArrayBuffer)||result.data.bytes.byteLength>64*1024**2)throw Error('DESKTOP_BINARY_RESPONSE_INVALID');
  return {...result,data:new Blob([result.data.bytes],{type:result.data.contentType})};
}
