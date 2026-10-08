// Fixed 4x4 rules and Mulberry32 random sequence, shared by the sample and verifier.
export function createTileMerge(seed) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new TypeError('Invalid seed.');
  let randomState=seed>>>0,score=0,moves=0;const cells=Array(16).fill(0);
  const random=()=>{randomState=(randomState+0x6D2B79F5)>>>0;let n=randomState;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return ((n^n>>>14)>>>0)/4294967296;};
  const add=()=>{const empty=cells.flatMap((value,index)=>value?[]:[index]);if(empty.length)cells[empty[Math.floor(random()*empty.length)]]=random()<.9?2:4;};
  add();add();
  const move=direction=>{
    if(typeof direction!=='string'||direction.length!==1||!'LURD'.includes(direction))throw new TypeError('Invalid move.');
    let changed=false;
    for(let line=0;line<4;line++){
      const indices=Array.from({length:4},(_,i)=>direction==='L'?line*4+i:direction==='R'?line*4+3-i:direction==='U'?i*4+line:(3-i)*4+line);
      const values=indices.map(i=>cells[i]).filter(Boolean),merged=[];
      for(let i=0;i<values.length;i++){if(values[i]===values[i+1]){const value=values[i]*2;merged.push(value);score+=value;i++;}else merged.push(values[i]);}
      while(merged.length<4)merged.push(0);
      indices.forEach((index,i)=>{if(cells[index]!==merged[i])changed=true;cells[index]=merged[i];});
    }
    if(changed){moves++;add();}return changed;
  };
  const snapshot=()=>({cells:[...cells],score,moves,'max-tile':Math.max(...cells),over:!cells.includes(0)&&cells.every((v,i)=>(i%4===3||v!==cells[i+1])&&(i>=12||v!==cells[i+4]))});
  return {move,snapshot};
}
export function verifyTileMerge(seed,evidence) {
  if(!evidence||Object.keys(evidence).some(key=>!['format','moves'].includes(key))||evidence.format!=='tile-merge-v1'||typeof evidence.moves!=='string'||evidence.moves.length<1||evidence.moves.length>8192||!/^[LURD]+$/.test(evidence.moves))throw new Error('Invalid move evidence.');
  const game=createTileMerge(seed);
  for(const move of evidence.moves)if(!game.move(move))throw new Error('Evidence contains an ineffective move.');
  const {score,moves,'max-tile':maxTile}=game.snapshot();return {score,moves,'max-tile':maxTile};
}
