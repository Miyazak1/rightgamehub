export default{
  createState:()=>({attempts:0,maxAttempts:4,solved:false,last:null}),
  reduce:({state,command,context})=>{
    if(command.name==='challenge.reset')return{...state,attempts:0,solved:false,last:null};
    if(command.name!=='challenge.attempt')return state;
    if(state.solved||state.attempts>=state.maxAttempts)return state;
    const model=context.observe(context.dependencies[0].id,{kind:'curve'}),attempts=state.attempts+1;
    const {cut,volume,optimumCut,optimumVolume}=model.optimization,success=Math.abs(cut-optimumCut)<=.085;
    return{...state,attempts,solved:state.solved||success,last:{success,metrics:{cut,volume,optimumCut,optimumVolume,efficiency:volume/optimumVolume}}};
  },
  observe:({state})=>state,
};
