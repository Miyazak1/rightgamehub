export default {
  createState:() => ({ channel:'primary',records:[],comparison:null }),
  reduce:({ state,command }) => {
    if(command.name==='instrument.channel.set')return{...state,channel:String(command.payload.channel??'primary')};
    if(command.name==='measurement.record')return{...state,records:[...state.records,structuredClone(command.payload.reading??{})].slice(-50)};
    if(command.name==='comparison.select')return{...state,comparison:Array.isArray(command.payload.indices)?command.payload.indices.slice(0,2):null};
    if(command.name==='measurement.clear')return{...state,records:[],comparison:null};
    return state;
  },
  observe:({ state,query,context }) => {
    const dependency=context.dependencies[0];
    return { ...state,live:dependency?context.observe(dependency.id,query?.sourceQuery??null):null };
  },
};
