'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {load,runtimeHash}=require('./frozen.cjs');
const {scene}=require('./geometry.cjs');
const {render}=require('./render.cjs');
const {registry}=require('./expanded/catalog.cjs');
const {plot}=require('./expanded/plots.cjs');
const {tableFigure}=require('./expanded/tables.cjs');
const policies=new Map(fs.readFileSync(path.join(__dirname,'policy.tsv'),'utf8').trim().split(/\r?\n/).slice(1).map(line=>{
  const [key,timing,reason]=line.split('\t');
  return [key,{timing,reason}];
}));
// Match the complete verified fact sequence, including the target. Unknown derivations keep the original text.
const specs={
  slope_from_two_distinct_points:[
    ['two_distinct_points','line_slope'],'两点与连线','Two points and their connecting segment'],
  line_intersection_then_point_distance:[
    ['two_lines','intersection_and_given_point','point_distance'],'两直线交于 P，另标给定点 Q','Two lines meet at P; Q is the given point'],
  circle_line_chord_length:[
    ['circle_equation','two_intersections','full_chord_length'],'割线在圆内的一段为题中所指的弦','The highlighted part of the secant is the chord'],
  external_point_tangency_points_distance_squared_sum:[
    ['circle_equation|reconstruct_circle_from_three_powers','external_point','two_tangent_contacts_and_given_point','sum_squared_contact_distances'],'P 引出的两条切线与给定点 Q','Tangents from P and the given point Q'],
  cuboid_face_diagonals_division_point_plane_distance_squared:[
    ['positive_cuboid_coordinates','three_face_diagonal_squares','point_on_space_diagonal|section_from_equal_base_pyramid_volumes','squared_point_plane_distance'],'T 位于对角线 OK 上，着色三角形表示平面 UVW','T lies on OK; the shaded triangle represents plane UVW'],
  cuboid_volume_face_areas_skew_lines_cosine_squared:[
    ['cuboid_coordinates','adjacent_face_areas_and_volume','point_on_vertical_edge|section_from_equal_base_pyramid_volumes','squared_cosine_acute_skew_angle'],'两条加粗线分别为 AB₁ 与 BE','The two bold segments are AB₁ and BE'],
  rectangular_pyramid_lateral_edge_section_plane_cosine_squared:[
    ['rectangular_pyramid_centered_apex','interior_point_on_AB|section_from_common_altitude_triangle_areas','squared_cosine_acute_plane_angle'],'两个三角形分别表示平面 SAB 与 SCT','The shaded triangles represent planes SAB and SCT'],
  cone_two_sections_frustum_total_surface_area:[
    ['right_circular_cone_axial_perimeter_total_area','two_internal_parallel_sections|invert_similar_cone_volume_ratio','frustum_total_area_both_bases_exact_pi'],'着色部分位于两个截面之间，最下方的椭圆表示原圆锥底面','The band lies between the two sections; the lowest ellipse is the base of the original cone']
};
const scopes=new Map(load('src/config.cjs').catalog.flatMap(c=>c.scopes.map(s=>[s.id,s.key])));
assert.equal(scopes.size,141);
assert.equal(policies.size,141);
assert([...scopes.values()].every(k=>policies.has(k)));
function verifyLocal(claim,result){
  assert.equal(claim.config.admissionRuntimeHash,runtimeHash);
  assert.equal(claim.config.admissionVersion,load('src/admission-contract.cjs').VERSION);
  const checked=load('src/admission-boundary.cjs').beforeStore(claim,result);
  assert(checked.passed && checked.gate.checks.oracle && checked.admission.eligibleBeforeHistory);
  assert.equal(checked.questionArtifact.sourceHash,checked.contentHash);
  assert.equal(checked.questionArtifact.cellId,claim.cell_id);
  assert.equal(checked.questionArtifact.scopeId,claim.scope_id);
  return checked;
}
// Server-only. Call with the artifact from verifyLocal (or an equivalently reverified stored item).
// The phase comes from the host's attempt state. Only the returned display object goes to the client.
function figure(artifact,phase='question',language='zh'){
  assert(['question','review'].includes(phase));assert(['zh','en'].includes(language));
  assert.equal(artifact.runtimeBundleHash,runtimeHash);
  const key=scopes.get(artifact.scopeId);
  if(!key || (!specs[key]&&!registry[key]))return null;
  if(phase==='question' && policies.get(key).timing!=='aux')return null;
  if(registry[key]){
    const {contracts,kind}=registry[key];
    if(!contracts.some(contract=>contract.length===artifact.facts.length && contract.every((s,i)=>s.split('|').includes(artifact.facts[i].predicate))))return null;
    return kind==='urn'||kind==='data'?tableFigure(key,artifact.facts,language):plot(key,kind,artifact.facts,language);
  }
  const [schema,zh,en]=specs[key];
  if(schema.length!==artifact.facts.length || !schema.every((s,i)=>s.split('|').includes(artifact.facts[i].predicate)))return null;
  const caption=language==='zh'?zh:en;
  return {caption,svg:render(scene(key,artifact.facts),caption)};
}
module.exports={policies,specs,registry,verifyLocal,figure};
