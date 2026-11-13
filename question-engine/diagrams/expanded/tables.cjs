'use strict';
const assert=require('node:assert/strict');
const val=x=>{const s=String(x);assert(/^-?\d+(?:\.\d+|\/[1-9]\d*)?$/.test(s));return s;};
const numRow=a=>a.map(val);
function model(key,facts,lang){
  const tr=(zh,en)=>lang==='zh'?zh:en;
  const f=facts[0],a=f.args,b=facts[1].args;
  const groups=[],notes=[];
  const group=(heading,rows)=>groups.push({heading,rows});
  const red=tr('红球','Red'),blue=tr('蓝球','Blue'),bag=tr('袋中组成','Bag contents');
  const colors=(name,r,k)=>group(name,[[red,blue],[val(r),val(k)]]);
  const first=tr('甲盒','Box A'),second=tr('乙盒','Box B');
  switch(f.predicate){
    case 'red_blue_tokens':
      group(tr('袋中筹码','Tokens in the bag'),[[tr('红色','Red'),tr('蓝色','Blue')],[val(a.R),val(a.B)]]);break;
    case 'distinct_labelled_colored_balls':
      colors(bag,a.R,a.B);break;
    case 'remove_known_colors_before_sampling':
      group(tr('固定移出步骤','Before the random draws'),[['',red,blue],
        [tr('原有','Initially'),val(a.initialRed),val(a.initialBlue)],[tr('移出','Removed'),val(a.removedRed),val(a.removedBlue)]]);break;
    case 'recover_population_from_total_ratio':
      group(bag,[[tr('总数','Total'),tr('红∶蓝','Red : blue')],[val(a.total),val(a.redRatio)+' : '+val(a.blueRatio)]]);break;
    case 'two_boxes_distinct_labelled_balls':
      colors(first,a.R1,a.B1);colors(second,a.R2,a.B2);break;
    case 'two_colours_labelled_box_size':{
      const g=facts[2].args;
      group(first,[[tr('球总数','Total balls'),tr('红球无序对','Red pairs')],[val(a.n),val(b.pairs)]]);
      colors(second,g.red,g.blue);break;
    }
    case 'one_missing_integer_value':{
      assert.equal(a.unknown,'t');
      // Split long observation lists into rows, without adding padding observations.
      const values=[...numRow(a.known),'t'];const rows=[];
      for(let i=0;i<values.length;i+=4)rows.push(values.slice(i,i+4));
      group(tr('原组观测值','Original observations'),rows);
      if(facts[1].predicate==='given_mean')notes.push(tr('原组均值','Original mean')+' = '+val(b.mean));
      else {
        group(tr('另一组观测','Other group'),[[tr('个数','Count'),tr('均值','Mean')],[val(b.auxCount),val(b.auxMean)]]);
        notes.push(tr('合并均值','Pooled mean')+' = '+val(b.combinedMean));
      }
      break;
    }
    case 'three_distinct_values_respective_frequencies':
      assert.equal(a.values.length,3);assert.equal(a.knownFrequencies.length,2);assert.equal(a.unknown,'k');
      group(tr('原始频数表','Given frequencies'),[[tr('取值','Value'),...numRow(a.values)],
        [tr('频数','Count'),...numRow(a.knownFrequencies),'k']]);
      notes.push((facts[1].predicate==='given_mean'?tr('给定均值','Given mean'):tr('总频数','Total count'))+' = '+val(b.value));break;
    case 'four_known_two_bounded_unknown_integers':
      group(tr('四个已知观测值','Four known observations'),[numRow(a.known)]);
      group(tr('两个未知观测值','Two unknown observations'),[['x','y']]);
      notes.push(tr('仅替换 x','Only x is replaced'));break;
    case 'four_increasing_integer_levels_bounded_frequencies':{
      assert.equal(a.levels.length,4);assert.equal(a.oneBased,true);
      const known=Number(a.knownIndex);assert(Number.isInteger(known)&&known>=1&&known<=4);
      group(tr('原始频数表','Given frequencies'),[[tr('取值','Value'),...numRow(a.levels)],
        [tr('频数','Count'),...a.levels.map((_,i)=>i+1===known?val(a.knownFrequency):'?')]]);
      notes.push(tr('删除第 '+val(facts[2].args.position)+' 个取值的全部数据','Remove all at position '+val(facts[2].args.position)));break;
    }
    case 'two_even_groups_unknown_bounded_integer_means':
      group(tr('两组原始观测','Original groups'),[['',tr('个数','Count'),tr('方差','Variance'),tr('均值','Mean')],
        ['A',val(a.nA),val(a.vA),'?'],['B',val(a.nB),val(a.vB),'?']]);
      group(tr('整组重复次数','Whole-group repetitions'),[['A','B'],[val(facts[2].args.p),val(facts[2].args.q)]]);break;
    default:throw Error('unregistered data display');
  }
  return {groups,notes};
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function tableFigure(key,facts,lang){
  const {groups,notes}=model(key,facts,lang);
  let y=8;
  const svg=[];
  const txt=(x,baseline,s,size=15,align='middle')=>'<text x="'+x+'" y="'+baseline+'" text-anchor="'+align+'" font-size="'+size+'" font-family="Arial,sans-serif" fill="#193c47">'+esc(s)+'</text>';
  for(const {heading,rows} of groups){
    svg.push(txt(12,y+16,heading,15,'start'));y+=25;
    for(const [i,row] of rows.entries()){
      const w=264/row.length;
      row.forEach((value,j)=>{
        const x=12+j*w;const fill=['?','k','x','y','t'].includes(value)?'#fff2da':(i===0&&rows.length>1?'#deedeb':'#f4f8f7');
        svg.push('<rect x="'+x+'" y="'+y+'" width="'+(w-1)+'" height="26" rx="3" fill="'+fill+'"/>');
        if(value!=='')svg.push(txt(x+w/2,y+18,value));
      });
      y+=28;
    }
    y+=9;
  }
  for(const note of notes){svg.push(txt(12,y+15,note,14,'start'));y+=22;}
  const caption=groups.map(g=>g.heading).join(' · ');
  const desc=groups.map(g=>g.heading+': '+g.rows.map(r=>r.join(', ')).join(' / ')).concat(notes).join('. ');
  return {caption,svg:'<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc(desc)+'" viewBox="0 0 288 '+(y+3)+'" style="display:block;width:100%;max-width:360px;height:auto"><title>'+esc(desc)+'</title>'+svg.join('')+'</svg>'};
}
module.exports={model,tableFigure};
