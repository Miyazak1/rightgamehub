const fs=require('node:fs');
// Startup owns identity/listen fields, not ports updated by the transport controller.
exports.saveLabSession=(file,state)=>{
 const current=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const key of ['agentId','operatorId','apiPort','serverPid'])if(state[key]!==undefined)current[key]=state[key];
 fs.writeFileSync(file,JSON.stringify(current,null,2),{mode:0o600});
};
