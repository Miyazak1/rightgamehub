import {AsyncLocalStorage} from 'node:async_hooks';
const execution=new AsyncLocalStorage();
export const withAgentExecution=(context,fn)=>execution.run(context,fn);
export const agentExecutionSignal=explicit=>explicit??execution.getStore()?.signal;
export const boundedAgentSignal=(seconds,explicit)=>{
  const parent=agentExecutionSignal(explicit),timeout=AbortSignal.timeout(seconds*1000);
  return parent?AbortSignal.any([parent,timeout]):timeout;
};
