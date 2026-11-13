'use strict';
const A=require('node:assert/strict');
const {world,addBox,circleFrom,number,vector}=require('../geometry.cjs');
const {render}=require('../render.cjs');
const text=(lang,zh,en)=>lang==='zh'?zh:en;
const intersection=(u,v)=>{
  const [a,b,c]=u,[d,e,f]=v,det=a*e-b*d; A(det!==0);
  return [(b*f-c*e)/det,(c*d-a*f)/det];
};
function lineFoot(line,at){
  const [a,b,c]=line,k=(a*at[0]+b*at[1]+c)/(a*a+b*b);A(Number.isFinite(k));
  return [at[0]-a*k,at[1]-b*k];
}
function planeModel(key,facts,lang){
  const s=world(),f=facts[0].args,g=facts[1].args;
  let caption;
  switch(key){
    case 'parallel_lines_distance':{
      const u=vector(f.l1),v=vector(f.l2);A(Math.abs(u[0]*v[1]-v[0]*u[1])<1e-8);
      s.lines=[u,v];s.points={u:lineFoot(u,[0,0]),v:lineFoot(v,[0,0])};
      caption=text(lang,'两条给定直线，未标间距','The two given parallel lines');break;
    }
    case 'circle_tangent_at_point':{
      const circle=circleFrom(facts[0]);s.circles=[circle];s.points={P:vector(g.point)};s.labels=['P'];
      A(Math.abs(Math.hypot(...s.points.P.map((x,i)=>x-circle.o[i]))-circle.r)<1e-8);
      caption=text(lang,'P 是题目给定的圆上点','P is the given point on the circle');break;
    }
    case 'circle_center_line_two_points_tangent_length_squared':{
      s.points={A:vector(f.A),B:vector(f.B)};s.labels=['A','B'];s.lines=[vector(f.centerLine)];
      const mid=s.points.A.map((x,i)=>(x+s.points.B[i])/2);
      s.points.frame=lineFoot(s.lines[0],mid);
      if(facts[1].predicate==='external_point'){s.points.P=vector(g.P);s.labels.push('P');}
      caption=text(lang,'A、B 为已知点，直线是圆心所在的轨迹','A and B are given; the center lies on the line');break;
    }
    case 'diameter_circle_secant_intersection_triangle_area_squared':{
      const u=vector(f.U),v=vector(f.V),o=u.map((x,i)=>(x+v[i])/2),r=Math.hypot(u[0]-v[0],u[1]-v[1])/2;
      A(r>0);s.points={U:u,V:v};s.labels=['U','V'];s.circles=[{o,r}];s.segments=[['U','V','edge']];
      const {l1,l2}=facts[2].args;
      s.lines=[vector(l1),vector(l2)];s.points.Q=intersection(...s.lines);s.labels.push('Q');
      if(facts[1].predicate==='secant_points_A_B'){
        const line=vector(g.line),foot=lineFoot(line,o),len=Math.hypot(line[0],line[1]);
        const half=Math.sqrt(r*r-(foot[0]-o[0])**2-(foot[1]-o[1])**2);A(half>0);
        for(const [n,sign] of [['A',1],['B',-1]]){
          s.points[n]=[foot[0]+sign*half*line[1]/len,foot[1]-sign*half*line[0]/len];
          s.labels.push(n);
        }
        s.segments.push(['A','B','highlight']);
        caption=text(lang,'UV 是直径，AB 是弦，Q 为两条给定直线的交点','UV is the diameter, AB the chord and Q the intersection of the given lines');
      }else{
        // The secant equation is a reasoning step. Leave its construction to the student.
        s.points.ref1=vector(g.U);s.points.ref2=vector(g.V);
        s.referenceMarks=['ref1','ref2'];
        caption=text(lang,'UV 是直径，Q 为交点；方框标出等距条件中的两个给定点','UV is the diameter and Q the intersection. Squares mark the two given points in the equidistance condition.');
      }
      break;
    }
    default: throw Error('unknown plane model');
  }
  return {s,caption};
}
function boxModel(key,facts,lang){
  const s=world(),f=facts[0].args,two=facts[0].predicate==='cuboid_two_adjacent_edges';
  const a=number(f.a),b=number(f.b);
  // Give the missing edge a schematic size independent of the volume/surface-area condition.
  const height=two?Math.sqrt(a*b):number(f.c);A(Math.min(a,b,height)>0);
  addBox(s,[a,b,height],['A','B','C','D','E','F','G','H']);
  s.edgeLabels=[['A','B','a'],['B','C','b'],['B','F',two?'?':'c']];
  if(key.includes('diagonal'))s.segments.push(['A','G','highlight']);
  if(two)A(number(facts[1].args.value)>0);
  const given=two?(facts[1].predicate==='cuboid_volume'?' · V = '+facts[1].args.value+' cm³':' · S = '+facts[1].args.value+' cm²'):'';
  const caption='a = '+f.a+' cm · b = '+f.b+' cm · '+(two?text(lang,'第三棱待求','third edge unknown'):'c = '+f.c+' cm')+given;
  return {s,caption};
}
const svgHead=caption=>'<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+caption+'" viewBox="0 0 288 186" style="display:block;width:100%;max-width:360px;height:auto"><title>'+caption+'</title>';
function axial(key,facts,lang){
  const f=facts[0],g=f.args,cone=key==='cone_radius_height_to_lateral_area';
  const h=g.h??g.height;
  const caption=text(lang,cone?'圆锥的底面和垂直高度':'圆柱的底面和高度',cone?'Base and perpendicular height of the cone':'Base and height of the cylinder');
  let baseInfo,r;
  if(g.r!==undefined){r=number(g.r);baseInfo='r = '+g.r+' cm';}
  else if(g.diameter!==undefined){r=number(g.diameter)/2;baseInfo='d = '+g.diameter+' cm';}
  else if(g.circumferencePi!==undefined){r=number(g.circumferencePi)/2;baseInfo='C = '+g.circumferencePi+'π cm';}
  else {r=Math.sqrt(number(g.baseAreaPi));baseInfo=text(lang,'底面积','Base area')+' = '+g.baseAreaPi+'π cm²';}
  A(r>0);
  const height=h===undefined?r*1.65:number(h);A(height>0);
  const scale=Math.min(59/r,87/height),rx=r*scale,dy=height*scale;
  const ry=Math.min(rx*.20,dy*.23),cx=142,base=116,top=base-dy;
  const stroke=' stroke="#335a68" stroke-width="1.7"',teal=' stroke="#087e81" stroke-width="2"';
  const ellipse=y=>'<ellipse cx="'+cx+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'" fill="#e0f1ef"'+stroke+'/>';
  const seg=(x,y,xx,yy,pen)=>'<line x1="'+x+'" y1="'+y+'" x2="'+xx+'" y2="'+yy+'"'+pen+'/>';
  const parts=[svgHead(caption),ellipse(base)];
  if(cone){
    const sin=ry/dy,offset=rx*Math.sqrt(1-sin*sin);
    for(const sign of [-1,1])parts.push(seg(cx,top,cx+sign*offset,base-ry*sin,stroke));
    parts.push(seg(cx,top,cx,base,teal+' stroke-dasharray="4 3"'));
  }else{
    for(const sign of [-1,1])parts.push(seg(cx+sign*rx,top,cx+sign*rx,base,stroke));
    parts.push(ellipse(top));
  }
  const y=cone?base:top;
  if(g.r!==undefined||g.diameter!==undefined)parts.push(seg(g.diameter!==undefined?cx-rx:cx,y,cx+rx,y,teal));
  const heightInfo=h===undefined?'h = ?':'h = '+h+' cm';
  const info=[baseInfo,heightInfo];
  if(g.volumePiCoefficient!==undefined){A(number(g.volumePiCoefficient)>0);info.push('V = '+g.volumePiCoefficient+'π cm³');}
  const textLine=(v,y)=>'<text x="144" y="'+y+'" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" fill="#163b46">'+v+'</text>';
  parts.push(textLine(info.slice(0,2).join('   ·   '),154));
  if(info[2])parts.push(textLine(info[2],175));
  parts.push('</svg>');return {svg:parts.join(''),caption};
}
function normal(facts,lang){
  const g=facts.at(-1).args,a=number(g.a),b=number(g.b);A(a<b&&number(facts[0].args.variance)>0);
  const caption=text(lang,'原变量 X 的给定闭区间','Given closed interval on the original variable X');
  const end=(x,value)=>'<circle cx="'+x+'" cy="56" r="5" fill="#08746e"/><text x="'+x+'" y="82" text-anchor="middle" font-size="16">'+value+'</text>';
  // A probability-scaled shaded bell would make some multiple-choice answers estimable by eye.
  return {caption,svg:svgHead(caption).replace('288 186','288 99')+'<path d="M 14 56 H 270 l -6 -4 m 6 4 l -6 4" stroke="#486471" fill="none"/><path d="M 65 56 H 216" stroke="#08746e" stroke-width="5"/>'+end(65,a)+end(216,b)+'<text x="263" y="82" font-size="15">X</text></svg>'};
}
function plot(key,kind,facts,lang){
  if(kind==='normal')return normal(facts,lang);
  if(kind==='solid'&&!key.startsWith('cuboid'))return axial(key,facts,lang);
  const {s,caption}=kind==='plane'?planeModel(key,facts,lang):boxModel(key,facts,lang);
  return {svg:render(s,caption),caption};
}
module.exports={plot,planeModel,boxModel};
