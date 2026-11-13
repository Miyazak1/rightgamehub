'use strict';
const {verifyLocal,figure}=require('./index.cjs');
// Server-side presentation hook for a result from the frozen worker.
// Caller owns the attempt state and the separate authorization to publish a question.
function prepareLocalFigure(claim, result){
  const checked=verifyLocal(claim,result);
  const artifact=structuredClone(checked.questionArtifact);
  return (phase,language)=>{
    if(!['question','review'].includes(phase)||!['zh','en'].includes(language))throw Error('invalid display request');
    try{
      const display=figure(artifact,phase,language);
      return display ? {state:'ready',display} : {state:'original_only',reason:'no_figure_for_phase_or_contract'};
    }catch(error){
      if(error.code!=='ERR_ASSERTION')throw error;
      return {state:'original_only',reason:'geometry_or_layout_unverified'};
    }
  };
}
module.exports={prepareLocalFigure};
