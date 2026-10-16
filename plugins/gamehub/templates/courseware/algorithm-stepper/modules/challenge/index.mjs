export default {
  createState:() => ({ attempts:0,maxAttempts:4,solved:false,last:null }),
  reduce:({ state,command,context }) => {
    if(command.name==='challenge.reset')return{...state,attempts:0,solved:false,last:null};
    if(command.name!=='challenge.attempt')return state;
    const model=context.observe(context.dependencies[0].id),amount=model.composition.no2,concentration=model.concentrations.no2,settled=model.progress>=.995;
    const success=settled&&amount>=.6&&concentration<=.5&&model.temperature<=318,attempts=state.attempts>=state.maxAttempts&&!state.solved?1:state.attempts+1;
    return{...state,attempts,solved:success,last:{success,reason:!settled?'unsettled':model.temperature>318?'hot':amount<.6?'low':'dense',metrics:{amount,concentration,temperature:model.temperature,progress:model.progress}}};
  },
  observe:({ state }) => state,
};
