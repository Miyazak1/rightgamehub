// Public taxonomy uses Mooyu IDs. Engine IDs remain behind the server adapter.
export const practiceSubjects = [
  { id: 'mathematics', title: { 'zh-CN': '数学', en: 'Mathematics' } },
  { id: 'physics', title: { 'zh-CN': '物理', en: 'Physics' } },
  { id: 'chemistry', title: { 'zh-CN': '化学', en: 'Chemistry' } },
];
export const practiceStages = [
  { id: 'primary', title: { 'zh-CN': '小学', en: 'Primary' } },
  { id: 'lower-secondary', title: { 'zh-CN': '初中', en: 'Lower secondary' } },
  { id: 'upper-secondary', title: { 'zh-CN': '高中', en: 'Upper secondary' } },
  { id: 'higher-education', title: { 'zh-CN': '大学', en: 'Higher education' } },
];
export const practiceDifficulties = [
  { id: 'basic', title: { 'zh-CN': '基础', en: 'Basic' } },
  { id: 'medium', title: { 'zh-CN': '中等', en: 'Medium' } },
  { id: 'hard', title: { 'zh-CN': '困难', en: 'Hard' } },
];
const rows = [
  ['sets', '集合', 'Sets', 'M-SET-001'],
  ['inequalities', '不等式', 'Inequalities', 'M-INEQ-001'],
  ['functions', '函数概念与性质', 'Functions', 'M-FUNC-001'],
  ['elementary-functions', '基本初等函数', 'Elementary functions', 'M-FUNC-002'],
  ['sequences', '数列', 'Sequences', 'M-SEQ-001'],
  ['calculus', '导数与微积分基础', 'Introduction to calculus', 'M-CALC-001'],
  ['analytic-geometry', '平面解析几何', 'Analytic geometry', 'M-GEO-001'],
  ['solid-geometry', '立体几何', 'Solid geometry', 'M-GEO-002'],
  ['vectors-complex', '向量与复数', 'Vectors and complex numbers', 'M-ALG-001'],
  ['probability', '概率', 'Probability', 'M-PROB-001'],
  ['statistics', '统计基础', 'Statistics', 'M-STAT-001'],
  ['statistics-models', '统计模型', 'Statistical models', 'M-STAT-002'],
];
export const mathTopics = rows.map(([id, zh, en, engineTopic]) => ({
  id: `csca.math.${id}`, subjectId: 'mathematics', curriculumId: 'csca-math-1.43',
  // CSCA coverage has not been reviewed against a school-stage curriculum.
  stageIds: [], parentId: 'csca.math', title: { 'zh-CN': zh, en }, engineTopic,
  questionTypes: ['single-choice'], difficultyIds: ['basic', 'medium', 'hard'],
}));
export const practiceCurricula = [{ id: 'csca-math-1.43', subjectId: 'mathematics', stageIds: [],
  title: { 'zh-CN': 'CSCA 数学专项', en: 'CSCA mathematics' }, version: '1.43.0' }];
export function matchesPracticeFilter(topic, filter = {}) {
  return (!filter.subjectId || topic.subjectId === filter.subjectId)
    && (!filter.curriculumId || topic.curriculumId === filter.curriculumId)
    && (!filter.stageId || topic.stageIds.includes(filter.stageId))
    && (!filter.difficultyId || topic.difficultyIds.includes(filter.difficultyId));
}
