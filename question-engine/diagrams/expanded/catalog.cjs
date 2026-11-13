'use strict';
const registry = {};
function add(key, kind, zh, en, ...contracts) {
  registry[key] = {kind, title:{zh,en}, contracts:contracts.map(c=>c.split(' '))};
}
add('parallel_lines_distance','plane','平行直线间的距离','Distance between parallel lines','two_lines verify_parallel_and_common_scale parallel_line_distance');
add('circle_tangent_at_point','plane','圆上给定点的切线','Tangent at a point','circle_equation point_on_circle tangent_at_point');
add('circle_center_line_two_points_tangent_length_squared','plane','圆心轨迹与两个已知点','Two points and a locus of centers','circle_two_points_center_line external_point|trilaterate_external_point squared_tangent_length');
add('diameter_circle_secant_intersection_triangle_area_squared','plane','直径、割线与交点','Diameter, secant and intersection','diameter_endpoints secant_points_A_B|recover_secant_as_perpendicular_bisector intersection_Q triangle_area_squared');
add('cuboid_volume','solid','长方体的体积','Volume of a cuboid','cuboid_adjacent_edges_cm volume');
add('cuboid_surface_area','solid','长方体的总表面积','Surface area of a cuboid','cuboid_adjacent_edges_cm total_surface_area');
add('cuboid_space_diagonal','solid','长方体的体对角线','Space diagonal of a cuboid','cuboid_adjacent_edges_cm space_diagonal_length');
add('cylinder_volume','solid','圆柱体积与底面条件','Volume and base of a cylinder','right_circular_cylinder|cylinder_given_diameter|cylinder_given_circumference|cylinder_given_base_area volume_exact_pi');
add('cuboid_volume_to_surface_area','solid','由体积求总表面积','Surface area from volume','cuboid_two_adjacent_edges cuboid_volume total_surface_area');
add('cuboid_surface_area_to_space_diagonal','solid','由表面积求体对角线','Space diagonal from surface area','cuboid_two_adjacent_edges cuboid_total_surface_area space_diagonal_exact_radical');
add('cylinder_volume_to_total_surface_area','solid','圆柱总表面积','Total surface area of a cylinder','right_circular_cylinder total_area_including_two_bases');
add('cone_radius_height_to_lateral_area','solid','圆锥的侧面积','Lateral area of a cone','right_circular_cone lateral_area_excluding_base');
add('colored_objects_single_draw','urn','一次随机抽取','One random draw','red_blue_tokens one_uniform_draw probability_red');
for(const [key,zh,en] of [
  ['without_replacement_both_target','不放回抽取两个红球','Two red balls without replacement'],
  ['without_replacement_one_of_each','不放回抽取一红一蓝','One red and one blue without replacement']])
  add(key,'urn',zh,en,'distinct_labelled_colored_balls|remove_known_colors_before_sampling|recover_population_from_total_ratio sequential_uniform_without_replacement probability_'+key);
for(const [key,zh,en] of [
  ['independent_two_boxes_both_target','两盒独立抽取均为红球','Red from both boxes'],
  ['independent_two_boxes_at_least_one_target','两盒独立抽取至少一个红球','At least one red across two boxes']])
  add(key,'urn',zh,en,'two_boxes_distinct_labelled_balls independent_uniform_boxes probability_'+key);
add('independent_boxes_three_red_each_box_nonempty','urn','两盒抽取共三个红球','Three reds across two boxes',
  'two_colours_labelled_box_size unordered_red_pairs labelled_second_box independent_uniform_boxes probability_three_red_both_nonempty',
  'two_boxes_distinct_labelled_balls independent_uniform_boxes probability_independent_boxes_three_red_each_box_nonempty');
add('missing_value_from_mean_to_population_variance','data','一个缺失观测值','One missing observation','one_missing_integer_value given_mean|recover_group_mean_from_pooled_mean determine_missing_first population_variance population_denominator_current_count');
add('missing_frequency_from_total_to_weighted_mean','data','给定总频数的频数表','Frequencies with a given total','three_distinct_values_respective_frequencies given_total_frequency determine_missing_first weighted_mean');
add('missing_frequency_from_mean_to_population_variance','data','给定均值的频数表','Frequencies with a given mean','three_distinct_values_respective_frequencies given_mean determine_missing_first population_variance population_denominator_current_count');
add('two_missing_values_moments_order_replacement_variance','data','六个观测值与替换位置','Six observations and one replacement','four_known_two_bounded_unknown_integers mean_population_variance_order|recover_moments_from_two_shifted_losses replace_x_only updated_six_population_variance population_current_count_never_n_minus_one');
add('three_missing_frequencies_moments_trimmed_variance','data','四个水平与缺失频数','Four levels and missing frequencies','four_increasing_integer_levels_bounded_frequencies frequency_total_mean_population_variance|recover_moments_from_two_shifted_losses remove_all_occurrences_at_position remaining_population_variance population_current_count_never_n_minus_one');
add('two_group_moments_order_reweighted_mean','data','两组观测数据','Two observation groups','two_even_groups_unknown_bounded_integer_means combined_moments_mean_order|recover_moments_from_two_shifted_losses repeat_entire_groups reweighted_mean population_current_count_never_n_minus_one');
add('standardized_interval_from_cdf_values','normal','原变量上的正态区间','Interval on the original normal variable','normal_mean_variance mean_and_positive_standard_deviation given_approximate_standard_normal_cdf standardize_endpoints_then_given_table interval_probability');
module.exports={registry};
