export const MIN_WIKIPEDIA_INTRO_HAN = 180;
export const GUESS_BAIKE_SELECTION_POLICY_VERSION = 2;
export const MIN_WIKIPEDIA_PAGEVIEWS_60_DAYS = 3000;
export const MIN_WIKIPEDIA_PAGEVIEW_DAYS = 30;
export const MIN_WIKIPEDIA_CHINESE_RATIO = 0.72;

const hanPattern = /[\u3400-\u9fff]/u;
const guessablePattern = /[\u3400-\u9fffA-Za-z0-9]/u;
const chineseTitlePattern = /^(?:\p{Script=Han}|·){2,10}$/u;
const scriptCharacterPattern = /[\p{Script=Han}A-Za-z0-9]/u;
const unsuitableTitlePattern = /(?:消歧义|列表|一览|索引|年表|清单|目录|人物表|作品列表)/u;
const sensitiveTitlePattern = /(?:政治|政党|选举|总统|总理|首相|外交|制裁|抗议|示威|政变|领土争议|主权争议)/u;
const sensitiveCategoryPattern = /(?:政治人物|政治家|政党|选举|政府首脑|国家元首|外交|国际关系|领土争议|主权争议|抗议|示威|恐怖主义|恐怖袭击|政变|制裁|在世人物|当前事件|新闻动态|正在发生)/u;
const unstableContentPattern = /(?:现任|正在进行|仍在持续|截至20\d{2}年).{0,32}(?:总统|总理|首相|选举|政治|冲突|战争|抗议|示威|制裁)/u;
const topicRules = [
  ['科学', /(?:科学|科技|数学|物理|化学|生物|天文|医学|技术|软件|计算机|互联网|工程|发明)/u],
  ['历史', /(?:历史|朝代|古代|考古|文物|世界遗产)/u],
  ['地理', /(?:地理|国家|城市|省份|地区|山脉|河流|湖泊|海洋|岛屿|地形|旅游景点|国家公园|风景名胜)/u],
  ['人文', /(?:文学|语言|哲学|文化|宗教|神话|民俗|节日|教育|艺术|建筑)/u],
  ['娱乐', /(?:电影|电视|动画|漫画|音乐|电子游戏|游戏|戏剧|综艺)/u],
  ['体育', /(?:体育|运动|足球|篮球|网球|棋类|奥林匹克)/u],
  ['生活', /(?:饮食|食品|饮料|烹饪|服饰|交通工具|日常生活|咖啡|茶)/u],
];
const visiblePunctuation = new Set(Array.from('，。！？；：、,.!?;:\'"“”‘’（）()[]【】《》〈〉「」『』—–…·-'));
const whitespacePattern = /\s/u;

export function isVisibleGuessPunctuation(character = '') {
  return character !== '' && (visiblePunctuation.has(character) || whitespacePattern.test(character));
}

export function shouldMaskGuessCharacter(character = '') {
  return character !== '' && !isVisibleGuessPunctuation(character);
}

export function normalizeGuessCharacter(character = '') {
  return guessablePattern.test(character) ? character.toLocaleLowerCase('en-US') : null;
}

export function uniqueGuessCharacters(value = '') {
  return [...new Set(Array.from(value, normalizeGuessCharacter).filter(Boolean))];
}

export function countGuessOccurrences(value = '', characters = []) {
  const keys = new Set(Array.from(characters, normalizeGuessCharacter).filter(Boolean));
  return Array.from(value).filter(character => keys.has(normalizeGuessCharacter(character))).length;
}

export function isGuessTitleSolved(title = '', guessed = []) {
  const titleCharacters = uniqueGuessCharacters(title);
  const guessedCharacters = new Set(Array.from(guessed, normalizeGuessCharacter).filter(Boolean));
  return titleCharacters.length > 0 && titleCharacters.every(character => guessedCharacters.has(character));
}

export function countHan(value = '') {
  return Array.from(value).filter(character => hanPattern.test(character)).length;
}

export function normalizeWikipediaIntro(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .split(/\n+/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function evaluateWikipediaIntro(value, minimumHan = MIN_WIKIPEDIA_INTRO_HAN) {
  const content = normalizeWikipediaIntro(value);
  const hanCount = countHan(content);
  return {
    content,
    hanCount,
    eligible: hanCount >= minimumHan,
    reason: hanCount >= minimumHan ? null : `导言只有 ${hanCount} 个汉字，低于 ${minimumHan} 字门槛`,
  };
}

export function summarizeWikipediaPageviews(pageviews = {}) {
  const entries = Object.entries(pageviews && typeof pageviews === 'object' ? pageviews : {});
  return {
    days: entries.length,
    total: entries.reduce((sum, [, value]) => sum + (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0), 0),
  };
}

export function classifyGuessBaikeTopic(categories = [], curatedCategory = '') {
  const categoryText = [curatedCategory, ...categories.map(item => typeof item === 'string' ? item : item?.title)]
    .filter(Boolean)
    .map(item => String(item).replace(/^(?:Category|分类):/u, ''))
    .join('\n');
  return topicRules.find(([, pattern]) => pattern.test(categoryText))?.[0] ?? null;
}

export function evaluateGuessBaikeSelection({ title = '', content = '', categories = [], pageviews = {}, curatedCategory = '', requirePopularity = true, minimumHan = MIN_WIKIPEDIA_INTRO_HAN } = {}) {
  const normalizedTitle = String(title).trim();
  if (/[A-Za-z]/u.test(normalizedTitle)) return { eligible: false, reason: '标题含有英文字母', reasonCode: 'TITLE_HAS_LATIN' };
  if (!chineseTitlePattern.test(normalizedTitle)) return { eligible: false, reason: '标题必须由 2 至 10 个汉字组成，可包含间隔点', reasonCode: 'TITLE_NOT_CHINESE' };
  if (unsuitableTitlePattern.test(normalizedTitle)) return { eligible: false, reason: '列表、索引、年表或消歧义条目不适合作为题目', reasonCode: 'TITLE_NOT_ARTICLE' };

  const quality = evaluateWikipediaIntro(content, minimumHan);
  if (!quality.eligible) return { eligible: false, reason: quality.reason, reasonCode: 'INTRO_TOO_SHORT' };
  const scriptCount = Array.from(quality.content).filter(character => scriptCharacterPattern.test(character)).length;
  const chineseRatio = scriptCount ? quality.hanCount / scriptCount : 0;
  if (chineseRatio < MIN_WIKIPEDIA_CHINESE_RATIO) return { eligible: false, reason: `正文中文比例 ${Math.round(chineseRatio * 100)}% 低于要求`, reasonCode: 'CONTENT_NOT_CHINESE' };

  const categoryText = categories.map(item => typeof item === 'string' ? item : item?.title).filter(Boolean).join('\n');
  if (sensitiveTitlePattern.test(normalizedTitle) || sensitiveCategoryPattern.test(categoryText) || unstableContentPattern.test(quality.content.slice(0, 600))) {
    return { eligible: false, reason: '涉及政治、时政、在世人物或不稳定敏感话题', reasonCode: 'SENSITIVE_OR_UNSTABLE_TOPIC' };
  }

  const category = classifyGuessBaikeTopic(categories, curatedCategory);
  if (!category) return { eligible: false, reason: '无法明确归入大众人文、历史、地理、娱乐、科学、体育或生活主题', reasonCode: 'TOPIC_NOT_MAINSTREAM' };

  const popularity = summarizeWikipediaPageviews(pageviews);
  if (requirePopularity && popularity.days < MIN_WIKIPEDIA_PAGEVIEW_DAYS) return { eligible: false, reason: '近 60 天访问量数据不足，按灰色题目拒绝', reasonCode: 'POPULARITY_DATA_MISSING' };
  if (requirePopularity && popularity.total < MIN_WIKIPEDIA_PAGEVIEWS_60_DAYS) return { eligible: false, reason: `近 60 天访问量 ${popularity.total}，未达到大众题目门槛`, reasonCode: 'POPULARITY_TOO_LOW' };

  return {
    eligible: true,
    reason: null,
    reasonCode: null,
    category,
    content: quality.content,
    hanCount: quality.hanCount,
    signals: {
      policyVersion: GUESS_BAIKE_SELECTION_POLICY_VERSION,
      chineseRatio: Number(chineseRatio.toFixed(3)),
      pageviewDays: popularity.days,
      pageviews60Days: popularity.total,
      topic: category,
    },
  };
}

