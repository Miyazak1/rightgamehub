const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha256 = value => {
  const bytes = new TextEncoder().encode(value), words = [], bitLength = bytes.length * 8;
  for (const byte of bytes) words.push(byte);
  words.push(128); while ((words.length % 64) !== 56) words.push(0);
  for (let index = 7; index >= 0; index--) words.push(Math.floor(bitLength / (2 ** (index * 8))) & 255);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rotr = (x,n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < words.length; offset += 64) {
    const w = new Array(64); for (let i = 0; i < 16; i++) w[i] = (words[offset+i*4]<<24)|(words[offset+i*4+1]<<16)|(words[offset+i*4+2]<<8)|words[offset+i*4+3];
    for (let i = 16; i < 64; i++) { const a=w[i-15],b=w[i-2]; w[i]=(((rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-16]+(rotr(b,17)^rotr(b,19)^(b>>>10))+w[i-7])|0); }
    let [a,b,c,d,e,f,g,q]=h;
    for (let i=0;i<64;i++){const t1=(q+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;q=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
    h[0]=(h[0]+a)|0;h[1]=(h[1]+b)|0;h[2]=(h[2]+c)|0;h[3]=(h[3]+d)|0;h[4]=(h[4]+e)|0;h[5]=(h[5]+f)|0;h[6]=(h[6]+g)|0;h[7]=(h[7]+q)|0;
  }
  return h.map(value => (value >>> 0).toString(16).padStart(8,'0')).join('');
};
const clone = value => JSON.parse(JSON.stringify(value));
const finish = (state,loser,players,reason) => ({ state,completed:true,event:{ loserSeat:players.find(p=>p.userId===loser).seat },terminationReason:reason,result:{ loserUserId:loser },playerResults:players.map(player=>({ userId:player.userId,result:player.userId===loser?'loss':'win' })) });
const rulesAdapter = {
  workId:'sample-work', modeKey:'duel', rulesetVersion:'1.0.0',
  createInitialState({ players }) { return { turnUserId:players[0].userId,round:1,scores:Object.fromEntries(players.map(p=>[p.userId,0])),secrets:{[players[0].userId]:'EMBER-7',[players[1].userId]:'TIDE-4'} }; },
  getTurn(state) { return { userId:state.turnUserId,seconds:30 }; },
  getPlayerView(state,userId) { return { round:state.round,turnUserId:state.turnUserId,scores:clone(state.scores),yourSecret:state.secrets[userId] }; },
  getSpectatorView(state) { return { round:state.round,turnUserId:state.turnUserId,scores:clone(state.scores) }; },
  serializeState: clone, deserializeState: clone, hashState(state) { return sha256(canonical(state)); },
  validateCommand({ state,command,actorUserId }) { if (actorUserId!==state.turnUserId) return {valid:false,code:'NOT_YOUR_TURN'}; return command?.type==='score'&&typeof command.value==='string' ? {valid:true}:{valid:false,code:'COMMAND_INVALID'}; },
  applyCommand({ state,command,actorUserId,players }) { const next=clone(state),scored=command.value===next.secrets[actorUserId]; if(scored) next.scores[actorUserId]+=1; const other=players.find(p=>p.userId!==actorUserId); next.turnUserId=other.userId; next.round+=1; next.secrets[actorUserId]=`${players.find(p=>p.userId===actorUserId).seat?'TIDE':'EMBER'}-${next.round+6}`; if(next.scores[actorUserId]>=2) return {state:next,completed:true,event:{actorSeat:players.find(p=>p.userId===actorUserId).seat,scored,scores:next.scores},result:{winnerUserId:actorUserId},playerResults:players.map(p=>({userId:p.userId,result:p.userId===actorUserId?'win':'loss'}))}; return {state:next,event:{actorSeat:players.find(p=>p.userId===actorUserId).seat,scored,scores:next.scores}}; },
  handleResign({ state,actorUserId,players }) { return finish(clone(state),actorUserId,players,'resignation'); },
  handleTimeout({ state,turnUserId,players }) { return finish(clone(state),turnUserId,players,'timeout'); }
};
module.exports = { rulesAdapter };
