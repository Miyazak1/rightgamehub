'use strict';
const assert = require('node:assert/strict');
const W=288,H=204,M=27;
const fixed=x=>{assert(Number.isFinite(x));return Number(x.toFixed(3));};
const pt=p=>p.map(fixed).join(',');
const style={edge:'#375567',hidden:'#78909d',highlight:'#006b76',second:'#884917',axis:'#a3b3bc'};
const ink=(kind,width)=>`stroke="${style[kind]}" stroke-width="${width}" ${kind==='hidden'?'stroke-dasharray="4 4"':''}`;
const line=(p,q,kind='edge',width=1.6)=>`<line x1="${fixed(p[0])}" y1="${fixed(p[1])}" x2="${fixed(q[0])}" y2="${fixed(q[1])}" ${ink(kind,width)}/>`;
function bounds(points){
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return [Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
}
function projectSolid(s) {
  let best=-1,projection;
  // Choose among upright views of the same solid to separate named vertices.
  for(const yaw of [.55,.82,1.03,.37]) for(const pitch of [.42,.30,.58]){
    const f=([x,y,z])=>[x*Math.cos(yaw)+y*Math.sin(yaw),
      z*Math.cos(pitch)+(y*Math.cos(yaw)-x*Math.sin(yaw))*Math.sin(pitch)];
    const [l,r,b,t]=bounds(Object.values(s.points).map(f));
    const scale=Math.min((W-2*M)/(r-l),(H-2*M)/(t-b));
    const points=s.labels.map(n=>f(s.points[n])); let min=Infinity;
    points.forEach((p,i)=>points.slice(i+1).forEach(q=>{min=Math.min(min,Math.hypot(p[0]-q[0],p[1]-q[1])*scale);}));
    if(min>best){best=min;projection=f;}
  }
  return projection;
}
function fit(points){
  let [l,r,b,t]=bounds(points);
  const span=Math.max(r-l,t-b,1);
  const scale=Math.min((W-2*M)/Math.max(r-l,span*.16),(H-2*M)/Math.max(t-b,span*.16));
  return {scale,screen:([x,y])=>[W/2+(x-(l+r)/2)*scale,H/2-(y-(b+t)/2)*scale],
    box:[(l+r)/2-(W/2-10)/scale,(l+r)/2+(W/2-10)/scale,(b+t)/2-(H/2-10)/scale,(b+t)/2+(H/2-10)/scale]};
}
function clip([a,b,c],[l,r,lo,hi]){
  const ends=[];
  if(b) for(const x of [l,r]){const y=(-c-a*x)/b;if(y>=lo-1e-8&&y<=hi+1e-8)ends.push([x,y]);}
  if(a) for(const y of [lo,hi]){const x=(-c-b*y)/a;if(x>=l-1e-8&&x<=r+1e-8)ends.push([x,y]);}
  return ends.filter((p,i)=>ends.slice(0,i).every(q=>Math.hypot(p[0]-q[0],p[1]-q[1])>1e-8));
}
const overlaps=(a,b)=>a.x<b.x+b.w+2&&a.x+a.w+2>b.x&&a.y<b.y+b.h+2&&a.y+a.h+2>b.y;
function labels(entries){
  const grouped=[];
  for(const [n,p] of entries){
    const same=grouped.find(g=>Math.hypot(g.p[0]-p[0],g.p[1]-p[1])<1e-7);
    if(same)same.n+='/'+n;else grouped.push({n,p});
  }
  const placed=[],out=[];
  for(const {n,p:[x,y]} of grouped){
    assert(/^(?:[A-Z][A-Z0-9/]*|[abc?])$/.test(n));
    const w=9*n.length+4,h=16; let chosen;
    for(const gap of [5,12,21,33,45]){
      for(const [dx,dy] of [[gap,-h-gap/2],[gap,gap/2],[-w-gap,-h-gap/2],[-w-gap,gap/2],[-w/2,-gap-h],[-w/2,gap]]){
        const rect={x:x+dx,y:y+dy,w,h};
        if(rect.x<2||rect.x+w>W-2||rect.y<2||rect.y+h>H-2||placed.some(b=>overlaps(rect,b)))continue;
        if(grouped.some(g=>overlaps(rect,{x:g.p[0]-2,y:g.p[1]-2,w:4,h:4})))continue;
        chosen=rect;break;
      }
      if(chosen)break;
    }
    assert(chosen,'unreadable diagram labels');
    const near=[Math.max(chosen.x,Math.min(x,chosen.x+w)),Math.max(chosen.y,Math.min(y,chosen.y+h))];
    placed.push(chosen);
    if(Math.hypot(near[0]-x,near[1]-y)>10)out.push(line([x,y],near,'hidden',1));
    out.push(`<circle cx="${fixed(x)}" cy="${fixed(y)}" r="2.3" fill="#173944"/><text x="${fixed(chosen.x+w/2)}" y="${fixed(chosen.y+13)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="600" stroke="white" stroke-width="3" paint-order="stroke" fill="#173944">${n}</text>`);
  }
  return out.join('');
}
function cone(s){
  const R=s.rings[2].r,h=s.points.S[2],tilt=Math.min(.23,.36*h/R);
  const {screen,scale}=fit([[-R,-tilt*R],[R,h]]);
  const parts=[],apex=screen([0,h]),contact=tilt*R/h;
  const tangents=ring=>[-1,1].map(sign=>screen([sign*ring.r*Math.sqrt(1-contact*contact),ring.z+tilt*ring.r*contact]));
  const [small,large,base]=s.rings;
  const arc=(ring,a,b,sweep,major)=>`A ${fixed(scale*ring.r)} ${fixed(scale*tilt*ring.r)} 0 ${major} ${sweep} ${pt(b)}`;
  const [sl,sr]=tangents(small),[ll,lr]=tangents(large);
  parts.push(`<path d="M ${pt(sl)} L ${pt(ll)} ${arc(large,ll,lr,0,1)} L ${pt(sr)} ${arc(small,sr,sl,1,1)} Z" fill="#d7eeed"/>`);
  for(const p of tangents(base))parts.push(line(apex,p));
  for(const ring of s.rings){
    const [l,r]=tangents(ring);
    parts.push(`<path d="M ${pt(l)} ${arc(ring,l,r,1,0)}" fill="none" ${ink('hidden',1.2)}/>`);
    parts.push(`<path d="M ${pt(l)} ${arc(ring,l,r,0,1)}" fill="none" ${ink(ring===base?'edge':'highlight',1.8)}/>`);
  }
  return parts.join('');
}
function render(s,description){
  assert(!/[<>&"]/.test(description));
  const start=`<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${description}" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:360px;height:auto;display:block"><title>${description}</title>`;
  if(s.rings.length)return start+cone(s)+'</svg>';
  const project=Object.values(s.points)[0].length===3?projectSolid(s):p=>p;
  const projected=Object.fromEntries(Object.entries(s.points).map(([k,p])=>[k,project(p)]));
  const cloud=Object.values(projected);
  for(const {o,r} of s.circles)cloud.push([o[0]-r,o[1]-r],[o[0]+r,o[1]+r]);
  if(s.axes)cloud.push([0,0]);
  const {screen,scale,box}=fit(cloud);
  const positions=Object.fromEntries(Object.entries(projected).map(([k,p])=>[k,screen(p)]));
  const out=[start];
  const infinite=(coeff,kind)=>{const ends=clip(coeff,box);if(ends.length===2)out.push(line(screen(ends[0]),screen(ends[1]),kind,kind==='axis'?1:1.6));};
  if(s.axes){infinite([1,0,0],'axis');infinite([0,1,0],'axis');}
  for(const {o,r} of s.circles){const [x,y]=screen(o);out.push(`<circle cx="${fixed(x)}" cy="${fixed(y)}" r="${fixed(r*scale)}" fill="none" ${ink('edge',1.8)}/>`);}
  s.lines.forEach((a,i)=>infinite(a,i?'second':'edge'));
  for(const [i,face] of s.faces.entries())out.push(`<polygon points="${face.map(n=>pt(positions[n])).join(' ')}" fill="${i?'#efc487':'#85ccca'}" fill-opacity=".40" ${ink(i?'second':'highlight',1.4)}/>`);
  for(const [a,b,kind] of s.segments)out.push(line(positions[a],positions[b],kind,kind==='highlight'||kind==='second'?2.6:1.5));
  for(const name of s.referenceMarks||[]){
    const [x,y]=positions[name];out.push(`<rect x="${fixed(x-3)}" y="${fixed(y-3)}" width="6" height="6" fill="white" ${ink('second',1.5)}/>`);
  }
  const annotations=s.labels.map(n=>[n,positions[n]]);
  for(const [u,v,name] of s.edgeLabels||[])annotations.push([name,positions[u].map((x,i)=>(x+positions[v][i])/2)]);
  out.push(labels(annotations),'</svg>');return out.join('');
}
module.exports={render};
