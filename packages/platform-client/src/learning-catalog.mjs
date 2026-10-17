import { generatedLearningItems } from './generated-learning-items.mjs';

export const learningCategories = [
  {
    id: 'simulations',
    icon: '∿',
    title: { 'zh-CN': '模拟课件', en: 'Interactive simulations' },
    description: { 'zh-CN': '操作模型、观察变化，在教材、自由和挑战模式中理解知识。', en: 'Manipulate models and learn through guided, sandbox, and challenge modes.' },
  },
  {
    id: 'practice',
    icon: '✓',
    title: { 'zh-CN': '解题与练习', en: 'Practice and problems' },
    description: { 'zh-CN': '把练习、反馈和知识点连在一起，逐步形成解题能力。', en: 'Connect practice, feedback, and concepts to build problem-solving skills.' },
  },
  {
    id: 'tools',
    icon: '⌘',
    title: { 'zh-CN': '学习工具', en: 'Learning tools' },
    description: { 'zh-CN': '收纳绘图、计算、分析与创作工具，支持更复杂的学习任务。', en: 'Graphing, calculation, analysis, and creation tools for deeper study.' },
  },
  {
    id: 'topics',
    icon: '◇',
    title: { 'zh-CN': '知识专题', en: 'Knowledge topics' },
    description: { 'zh-CN': '按知识脉络组织概念、证据与应用，建立完整理解。', en: 'Organize concepts, evidence, and applications into coherent learning paths.' },
  },
];

export const builtInLearningItems = generatedLearningItems;

export const learningSubjects = [
  { id: 'all', label: { 'zh-CN': '全部学科', en: 'All subjects' } },
  { id: 'mathematics', label: { 'zh-CN': '数学', en: 'Mathematics' } },
  { id: 'physics', label: { 'zh-CN': '物理', en: 'Physics' } },
  { id: 'chemistry', label: { 'zh-CN': '化学', en: 'Chemistry' } },
];
