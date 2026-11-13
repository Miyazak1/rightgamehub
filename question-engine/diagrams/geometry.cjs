'use strict';
// Coordinates stay private to the renderer. Published labels are object names only.
const assert = require('node:assert/strict');
function number(value) {
  const s = String(value);
  assert(/^-?\d+(?:\.\d+)?(?:\/[1-9]\d*)?$/.test(s), 'invalid coordinate');
  const [n,d = '1'] = s.split('/');
  const x = Number(n) / Number(d);
  assert(Number.isFinite(x));
  return x;
}
const vector = a => a.map(number);
const root = x => { assert(x > 0 && Number.isFinite(x), 'degenerate solid or circle'); return Math.sqrt(x); };
const mix = (a,b,t) => a.map((v,i)=>v+(b[i]-v)*t);
const dot = (a,b) => a.reduce((sum,x,i)=>sum+x*b[i],0);
function world() { return {points:{}, segments:[], faces:[], circles:[], rings:[], lines:[], labels:[], anchors:[]}; }
function division(fact, direct, index, point, edge) {
  let t;
  if (fact.predicate === direct) t = number(fact.args.t);
  else {
    assert.equal(fact.predicate,index===2?'section_from_common_altitude_triangle_areas':'section_from_equal_base_pyramid_volumes');
    assert.equal(fact.args.index,index); assert.equal(fact.args.pt,point); assert.equal(fact.args.edge,edge);
    const k = number(fact.args.odds); assert(k>0); t=k/(1+k);
  }
  assert(t>0 && t<1); return t;
}
function addBox(s, size, names) {
  const [a,b,c]=size;
  const corners=[[0,0,0],[a,0,0],[a,b,0],[0,b,0],[0,0,c],[a,0,c],[a,b,c],[0,b,c]];
  names.forEach((n,i)=>s.points[n]=corners[i]);
  for (const [u,v] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    s.segments.push([names[u],names[v],u===3||v===3?'hidden':'edge']);
  }
}
function circleFrom(fact) {
  let d,e,f;
  if (fact.predicate === 'circle_equation') {
    [d,e,f]=vector(fact.args.coefficients ?? [fact.args.D,fact.args.E,fact.args.F]);
  } else {
    assert.equal(fact.predicate,'reconstruct_circle_from_three_powers');
    const [p0,p1,p2]=vector([fact.args.p0,fact.args.p1,fact.args.p2]);
    [d,e,f]=[p1-p0-1,p2-p0-1,p0];
  }
  const o=[-d/2,-e/2]; return {o,r:root(dot(o,o)-f)};
}
function scene(key, facts) {
  const s=world();
  const [first,second,third]=facts;
  function args(i,p) { assert.equal(facts[i].predicate,p); return facts[i].args; }
  switch(key) {
    case 'slope_from_two_distinct_points': {
      const q=args(0,'two_distinct_points'); s.points={P:vector([q.x1,q.y1]),Q:vector([q.x2,q.y2])};
      s.segments.push(['P','Q','highlight']); s.axes=true; s.labels=['P','Q']; break;
    }
    case 'line_intersection_then_point_distance': {
      const q=args(0,'two_lines'); const [a,b,c]=vector(q.l1),[d,e,f]=vector(q.l2),det=a*e-b*d;
      assert(det!==0); s.points.P=[(b*f-c*e)/det,(c*d-a*f)/det];
      s.points.Q=vector(args(1,'intersection_and_given_point').point); s.labels=['P','Q'];
      s.lines.push([a,b,c],[d,e,f]); s.axes=true; break;
    }
    case 'circle_line_chord_length': {
      const {o,r}=circleFrom(first); const [a,b,c]=vector(args(1,'two_intersections').line);
      const l=Math.hypot(a,b), dist=(a*o[0]+b*o[1]+c)/l, half=root(r*r-dist*dist);
      const foot=[o[0]-a/l*dist,o[1]-b/l*dist];
      s.points.A=[foot[0]-b/l*half,foot[1]+a/l*half];
      s.points.B=[foot[0]+b/l*half,foot[1]-a/l*half];
      s.circles.push({o,r}); s.lines.push([a,b,c]); s.segments.push(['A','B','highlight']); s.axes=true; break;
    }
    case 'external_point_tangency_points_distance_squared_sum': {
      const {o,r}=circleFrom(first),p=vector(args(1,'external_point').P),q=vector(args(2,'two_tangent_contacts_and_given_point').Q);
      const x=p[0]-o[0], y=p[1]-o[1], len=x*x+y*y, k=r*r/len, h=r*root(len-r*r)/len;
      s.points={P:p,Q:q,T1:[o[0]+k*x-h*y,o[1]+k*y+h*x],T2:[o[0]+k*x+h*y,o[1]+k*y-h*x]};
      s.circles.push({o,r}); s.segments.push(['P','T1','highlight'],['P','T2','highlight']);
      s.labels=['P','Q','T1','T2']; break;
    }
    case 'cuboid_face_diagonals_division_point_plane_distance_squared': {
      args(0,'positive_cuboid_coordinates');
      const {P,Q,R}=args(1,'three_face_diagonal_squares'),[p,q,r]=vector([P,Q,R]);
      const size=[root((p+q-r)/2),root((p+r-q)/2),root((q+r-p)/2)];
      addBox(s,size,['O','U','X','V','W','Y','K','Z']);
      s.points.T=mix(s.points.O,s.points.K,division(third,'point_on_space_diagonal',0,'T','OK'));
      s.faces.push(['U','V','W']); s.segments.push(['O','K','highlight']); s.labels=['O','U','V','W','K','T']; break;
    }
    case 'cuboid_volume_face_areas_skew_lines_cosine_squared': {
      args(0,'cuboid_coordinates');
      const g=args(1,'adjacent_face_areas_and_volume'),[u,w,v]=vector([g.U,g.W,g.V]); assert(Math.min(u,w,v)>0);
      addBox(s,[u*w/v,v/w,v/u],['A','B','C','D','A1','B1','C1','D1']);
      s.points.E=mix(s.points.C,s.points.C1,division(third,'point_on_vertical_edge',1,'E','CC_1'));
      s.segments.push(['A','B1','highlight'],['B','E','second']); s.labels=['A','B','C','C1','B1','E']; break;
    }
    case 'rectangular_pyramid_lateral_edge_section_plane_cosine_squared': {
      const g=args(0,'rectangular_pyramid_centered_apex'),[a,b,e]=vector([g.a,g.b,g.E]);
      assert(a>0 && b>0); s.points={A:[0,0,0],B:[a,0,0],C:[a,b,0],D:[0,b,0],S:[a/2,b/2,root(e-(a*a+b*b)/4)]};
      s.points.T=mix(s.points.A,s.points.B,division(second,'interior_point_on_AB',2,'T','AB'));
      for(const [u,v] of ['AB','BC','CD','DA','SA','SB','SC','SD']) s.segments.push([u,v,u==='D'||v==='D'?'hidden':'edge']);
      s.faces.push(['S','A','B'],['S','C','T']); s.labels=['A','B','C','D','S','T']; break;
    }
    case 'cone_two_sections_frustum_total_surface_area': {
      const g=args(0,'right_circular_cone_axial_perimeter_total_area'),p=number(g.P),a=number(g.A);
      const radius=2*a/p,slant=p/2-radius,h=root(slant*slant-radius*radius);
      let b,c;
      if(second.predicate==='two_internal_parallel_sections'){
        assert.equal(second.args.strictOrder,'0<B<C'); [b,c]=vector([second.args.B,second.args.C]);
      }else{
        assert.equal(second.predicate,'invert_similar_cone_volume_ratio');
        const ratio=Math.cbrt(number(second.args.vol2)); c=number(second.args.diff)/(1-ratio); b=c*ratio;
      }
      assert(radius>0 && slant>radius && 0<b && b<c && c<radius*radius);
      s.points={S:[0,0,h]}; s.rings=[b,c,radius*radius].map(area=>({r:root(area),z:h*(1-root(area)/radius)}));
      s.anchors=[[-radius,-radius,0],[radius,radius,0]]; break;
    }
    default: throw Error('unsupported scene');
  }
  return s;
}
module.exports={scene,world,addBox,circleFrom,number,vector};
