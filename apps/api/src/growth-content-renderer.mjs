import sharp from 'sharp';

const WIDTH = 1080;
const HEIGHT = 1440;
const FONT = `'WenQuanYi Zen Hei','Noto Sans CJK SC','Microsoft YaHei UI','Segoe UI',sans-serif`;
const MONO = `'Cascadia Mono','WenQuanYi Zen Hei','Noto Sans Mono CJK SC',monospace`;
const slides = Object.freeze(['cover','overview','play','source','cta']);

const escapeXml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const units = character => /[\u0000-\u00ff]/u.test(character) ? 1 : 2;
const wrap = (value, maxUnits, maxLines) => {
  const result = ['']; let size = 0;
  for (const character of Array.from(clean(value))) {
    const next = units(character);
    if (size + next > maxUnits) {
      if (result.length >= maxLines) { result[maxLines - 1] = `${result[maxLines - 1].replace(/…$/u, '')}…`; break; }
      result.push(''); size = 0;
    }
    result[result.length - 1] += character; size += next;
  }
  return result.filter(Boolean);
};
const textBlock = (lines, { x, y, size, color = '#17131f', weight = 700, lineHeight = 1.25, anchor = 'start', family = FONT }) => lines
  .map((line, index) => `<text x="${x}" y="${y + index * size * lineHeight}" text-anchor="${anchor}" fill="${color}" font-family="${family}" font-size="${size}" font-weight="${weight}">${escapeXml(line)}</text>`).join('');
const commonDefs = `<defs>
  <pattern id="paper-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0v32" fill="none" stroke="#8b5cf6" stroke-opacity=".065"/></pattern>
  <linearGradient id="cover-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".18" stop-color="#17111f" stop-opacity="0"/><stop offset="1" stop-color="#17111f" stop-opacity=".92"/></linearGradient>
</defs>`;
const paper = ({ page, dark = false, label = 'GAMEHUB PLAY NOTE' }) => `<rect width="1080" height="1440" fill="${dark ? '#17111f' : '#f8f6fc'}"/><rect width="1080" height="1440" fill="url(#paper-grid)"/>
  <path fill="#8b5cf6" d="M72 66h14v14h14v14h14v14h-14v14H86v-14H72V94H58V80h14z"/>
  <text x="136" y="101" fill="${dark ? '#fff' : '#17131f'}" font-family="${MONO}" font-size="25" font-weight="800" letter-spacing="2">GAME<tspan fill="#8b5cf6">HUB</tspan></text>
  <text x="72" y="151" fill="#8b5cf6" font-family="${MONO}" font-size="16" font-weight="800" letter-spacing="3">${label}</text>
  <text x="1008" y="100" text-anchor="end" fill="${dark ? '#bcb2ca' : '#6c6478'}" font-family="${MONO}" font-size="18" font-weight="700">${String(page).padStart(2, '0')} / 05</text>`;
const footer = dark => `<line x1="72" y1="1360" x2="1008" y2="1360" stroke="${dark ? '#3d344a' : '#d8d2e2'}"/><text x="72" y="1400" fill="${dark ? '#bcb2ca' : '#6c6478'}" font-family="${MONO}" font-size="17">免费游玩 · 来源透明 · 尊重作者</text><text x="1008" y="1400" text-anchor="end" fill="${dark ? '#fff' : '#17131f'}" font-family="${MONO}" font-size="18" font-weight="800">mooyu.fun</text>`;

const coverImage = async (body, width, height) => {
  if (!body) return null;
  try {
    return await sharp(body, { failOn: 'warning', limitInputPixels: 20 * 1024 * 1024, sequentialRead: true })
      .rotate().resize({ width, height, fit: 'cover', position: 'attention' }).png().toBuffer();
  } catch { return null; }
};

const title = work => wrap(work.title || 'GameHub 作品', 20, 2);
const description = work => clean(work.description || `一款可以直接在线体验的${work.kind === 'game' ? '游戏' : '互动作品'}。`);
const tags = work => (work.tags ?? []).map(clean).filter(Boolean).slice(0, 3);
const steps = work => {
  const candidates = String(work.instructions || '').split(/[\n。！？!?；;]/u).map(clean).filter(item => item.length >= 2);
  const fallbacks = ['打开作品页，点击「立即游玩」', '跟随游戏内提示开始体验', '喜欢的话，可以收藏或分享给朋友'];
  return [...candidates, ...fallbacks].slice(0, 3).map(item => wrap(item, 27, 2));
};
const sourceFacts = work => [
  ['发布者', work.creatorDisplayName || 'GameHub 社区作者'],
  ['源代码', work.repositoryUrl ? '已提供公开仓库' : '当前版本未关联公开仓库'],
  ['许可证', work.licenseSpdx || '以作品详情页标注为准'],
  ['游玩方式', work.targets?.some(target => target.targetKey === 'web') || work.id === 'gamehub-guess-baike' ? '浏览器直接游玩' : '查看作品支持的平台'],
];

const coverSvg = work => {
  const lines = title(work); const chips = [work.openSource ? '开放源码' : '免费体验', work.estimatedMinutes ? `约 ${work.estimatedMinutes} 分钟` : '随时开始', '浏览器打开'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 1, dark: true, label: 'OPEN GAME / 现在就玩' })}
    <rect x="58" y="194" width="964" height="652" fill="#241b36" stroke="#8b5cf6" stroke-width="2"/>
    <rect x="72" y="806" width="936" height="4" fill="#8b5cf6"/>
    ${textBlock(lines,{x:72,y:930,size:80,color:'#fff',weight:800,lineHeight:1.12})}
    ${chips.map((chip,index)=>`<rect x="${72+index*286}" y="${lines.length>1?1138:1055}" width="260" height="54" fill="#211a2c" stroke="#554765"/><text x="${202+index*286}" y="${lines.length>1?1173:1090}" text-anchor="middle" fill="${index===0?'#b89cff':'#eee9f7'}" font-family="${FONT}" font-size="21" font-weight="700">${escapeXml(chip)}</text>`).join('')}
    <text x="72" y="1267" fill="#c9bfd7" font-family="${FONT}" font-size="24">不下载，不注册，打开就能开始。</text>${footer(true)}</svg>`;
};

const overviewSvg = work => {
  const lines = wrap(description(work), 32, 4); const selectedTags = tags(work).length ? tags(work) : ['独立游戏','免费游玩','轻量体验'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 2 })}
    <text x="72" y="246" fill="#17131f" font-family="${FONT}" font-size="60" font-weight="800">为什么值得玩</text><rect x="72" y="278" width="148" height="6" fill="#8b5cf6"/>
    <rect x="72" y="338" width="936" height="488" fill="#e9e4f1" stroke="#d0c8da"/>
    ${textBlock(lines,{x:72,y:930,size:35,color:'#302a39',weight:600,lineHeight:1.5})}
    ${selectedTags.map((tag,index)=>`<rect x="${72+index*300}" y="1195" width="272" height="58" fill="${index===0?'#8b5cf6':'#fff'}" stroke="#8b5cf6"/><text x="${208+index*300}" y="1233" text-anchor="middle" fill="${index===0?'#fff':'#5c3bc5'}" font-family="${FONT}" font-size="21" font-weight="800">${escapeXml(tag)}</text>`).join('')}${footer(false)}</svg>`;
};

const playSvg = work => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 3 })}
  <text x="72" y="246" fill="#17131f" font-family="${FONT}" font-size="60" font-weight="800">30 秒开始</text><text x="72" y="300" fill="#6c6478" font-family="${FONT}" font-size="25">不需要先读一整本说明书。</text>
  ${steps(work).map((lines,index)=>{const top=380+index*285;return `<rect x="72" y="${top}" width="936" height="232" fill="#fff" stroke="#d8d2e2"/><rect x="72" y="${top}" width="12" height="232" fill="${index===0?'#8b5cf6':index===1?'#17a673':'#e09a31'}"/><text x="126" y="${top+78}" fill="#8b5cf6" font-family="${MONO}" font-size="42" font-weight="800">0${index+1}</text>${textBlock(lines,{x:224,y:top+82,size:34,color:'#17131f',weight:750,lineHeight:1.45})}`;}).join('')}${footer(false)}</svg>`;

const sourceSvg = work => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 4 })}
  <text x="72" y="246" fill="#17131f" font-family="${FONT}" font-size="60" font-weight="800">作品从哪里来</text><text x="72" y="300" fill="#6c6478" font-family="${FONT}" font-size="24">免费游玩，也应该保留作者、仓库与许可证。</text>
  ${sourceFacts(work).map(([label,value],index)=>{const top=382+index*192;const lines=wrap(value,30,2);return `<text x="72" y="${top}" fill="#8b5cf6" font-family="${MONO}" font-size="18" font-weight="800" letter-spacing="2">${escapeXml(label.toUpperCase())}</text>${textBlock(lines,{x:72,y:top+64,size:34,color:'#17131f',weight:750,lineHeight:1.4})}<line x1="72" y1="${top+138}" x2="1008" y2="${top+138}" stroke="#d8d2e2" stroke-dasharray="8 8"/>`;}).join('')}
  <rect x="72" y="1206" width="936" height="92" fill="#eee9fb"/><text x="104" y="1262" fill="#563ab2" font-family="${FONT}" font-size="22" font-weight="700">详细来源、认领状态和开源信息，以 GameHub 作品页为准。</text>${footer(false)}</svg>`;

const ctaSvg = work => {
  const lines=title(work);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 5, dark: true, label: 'PLAY IT NOW / 免费体验' })}
    <rect x="72" y="238" width="936" height="8" fill="#8b5cf6"/><text x="540" y="410" text-anchor="middle" fill="#b89cff" font-family="${MONO}" font-size="24" font-weight="800" letter-spacing="4">现在就能玩</text>
    ${textBlock(lines,{x:540,y:560,size:80,color:'#fff',weight:800,lineHeight:1.15,anchor:'middle'})}
    <rect x="148" y="820" width="784" height="190" fill="#211a2c" stroke="#8b5cf6" stroke-width="3"/><text x="540" y="892" text-anchor="middle" fill="#bcb2ca" font-family="${FONT}" font-size="23">浏览器访问</text><text x="540" y="956" text-anchor="middle" fill="#fff" font-family="${MONO}" font-size="42" font-weight="800">mooyu.fun</text>
    <text x="540" y="1105" text-anchor="middle" fill="#c9bfd7" font-family="${FONT}" font-size="25">进入「发现」，搜索</text><text x="540" y="1172" text-anchor="middle" fill="#b89cff" font-family="${FONT}" font-size="38" font-weight="800">${escapeXml(clean(work.title))}</text>
    <text x="540" y="1280" text-anchor="middle" fill="#8f839e" font-family="${FONT}" font-size="21">试玩不需要注册 · 收藏和参与社区时再登录</text>${footer(true)}</svg>`;
};

const slideSvg = (work, slide) => ({ cover: coverSvg, overview: overviewSvg, play: playSvg, source: sourceSvg, cta: ctaSvg })[slide](work);

const imageFrameSvg = slide => {
  if (slide === 'cover') return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}<rect x="80" y="214" width="920" height="610" fill="url(#cover-fade)"/><rect x="58" y="194" width="964" height="652" fill="none" stroke="#8b5cf6" stroke-width="2"/></svg>`;
  if (slide === 'overview') return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect x="72" y="338" width="936" height="488" fill="none" stroke="#d0c8da" stroke-width="2"/></svg>';
  return null;
};

export async function renderWorkXhsSlide(work, coverBody, slide) {
  if (!slides.includes(slide)) throw new TypeError('Unknown growth content slide.');
  const cover = await coverImage(coverBody, 920, slide === 'cover' ? 610 : 460);
  const composites = [{ input: Buffer.from(slideSvg(work, slide)) }];
  if (cover && slide === 'cover') composites.push({ input: cover, left: 80, top: 214 });
  if (cover && slide === 'overview') composites.push({ input: cover, left: 80, top: 352 });
  const imageFrame = imageFrameSvg(slide);
  if (cover && imageFrame) composites.push({ input: Buffer.from(imageFrame) });
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#f8f6fc' } })
    .composite(composites).timeout({ seconds: 5 }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export const growthContentSlides = slides;
export const growthContentSize = Object.freeze({ width: WIDTH, height: HEIGHT });
