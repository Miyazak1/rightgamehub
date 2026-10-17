export default {
  createState:() => ({ ready:false,commands:0,exports:0,lastCommand:null }),
  reduce:({ state,command }) => {
    if(command.name==='embed.ready')return{...state,ready:true};
    if(command.name==='embed.command.received')return{...state,commands:state.commands+1,lastCommand:String(command.payload.name??'')};
    if(command.name==='embed.state.exported')return{...state,exports:state.exports+1};
    return state;
  },
  observe:({ state }) => state,
};
