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
  <pattern id="paper-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0v32" fill="none" stroke="#8b5cf6" stroke-opacity=".075"/></pattern>
  <pattern id="pixel-dots" width="18" height="18" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="2" height="2" fill="#b89cff" fill-opacity=".22"/></pattern>
  <linearGradient id="dark-surface" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#17111f"/><stop offset=".58" stop-color="#21172f"/><stop offset="1" stop-color="#120e19"/></linearGradient>
  <linearGradient id="light-surface" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fbfaff"/><stop offset="1" stop-color="#f2eef8"/></linearGradient>
  <linearGradient id="cover-fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".28" stop-color="#17111f" stop-opacity="0"/><stop offset="1" stop-color="#17111f" stop-opacity=".96"/></linearGradient>
  <radialGradient id="violet-glow" cx="50%" cy="45%" r="58%"><stop stop-color="#8b5cf6" stop-opacity=".28"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
  <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#120e19" flood-opacity=".22"/></filter>
</defs>`;
const paper = ({ page, dark = false, label = 'PLAY NOTE / 推荐手记' }) => `<rect width="1080" height="1440" fill="url(#${dark ? 'dark-surface' : 'light-surface'})"/><rect width="1080" height="1440" fill="url(#paper-grid)"/>
  ${dark ? '<circle cx="855" cy="352" r="420" fill="url(#violet-glow)"/><rect x="0" y="0" width="1080" height="1440" fill="url(#pixel-dots)" opacity=".32"/>' : ''}
  <g transform="translate(60 48) scale(2.55)" shape-rendering="crispEdges"><path fill="#8b5cf6" d="M9 3h6v2h2v2h2v2h2v6h-2v2h-3v-4h-2v5h-4v-5H8v4H5v-2H3V9h2V7h2V5h2V3Z"/><path fill="#17111f" d="M8 9h3v3H8zm6 0h3v3h-3z"/><path fill="#f8f6fc" d="M9 10h1v1H9zm6 0h1v1h-1z"/></g>
  <text x="136" y="88" fill="${dark ? '#fff' : '#17131f'}" font-family="${MONO}" font-size="24" font-weight="900" letter-spacing="2.4">MOOYU.FUN</text>
  <text x="136" y="116" fill="${dark ? '#a99eb8' : '#736b7e'}" font-family="${FONT}" font-size="16" font-weight="700" letter-spacing="2">墨鱼工坊</text>
  <text x="72" y="169" fill="#8b5cf6" font-family="${MONO}" font-size="15" font-weight="800" letter-spacing="2.8">${label}</text>
  <rect x="916" y="62" width="92" height="46" rx="23" fill="${dark ? '#261d31' : '#fff'}" stroke="${dark ? '#51455f' : '#ded7e8'}"/>
  <text x="962" y="92" text-anchor="middle" fill="${dark ? '#d7d0df' : '#5f576a'}" font-family="${MONO}" font-size="16" font-weight="800">${String(page).padStart(2, '0')} / 05</text>
  <line x1="72" y1="194" x2="1008" y2="194" stroke="${dark ? '#3d344a' : '#ddd6e7'}"/>`;
const footer = dark => `<line x1="72" y1="1350" x2="1008" y2="1350" stroke="${dark ? '#42374f' : '#d8d2e2'}"/><circle cx="79" cy="1391" r="6" fill="#8b5cf6"/><text x="98" y="1398" fill="${dark ? '#bcb2ca' : '#6c6478'}" font-family="${MONO}" font-size="16" font-weight="700">免费游玩 · 来源透明 · 尊重作者</text><text x="1008" y="1398" text-anchor="end" fill="${dark ? '#fff' : '#17131f'}" font-family="${MONO}" font-size="18" font-weight="900">MOOYU.FUN</text>`;

const coverImage = async (body, width, height) => {
  if (!body) return null;
  try {
    return await sharp(body, { failOn: 'warning', limitInputPixels: 20 * 1024 * 1024, sequentialRead: true })
      .rotate().resize({ width, height, fit: 'cover', position: 'attention' }).png().toBuffer();
  } catch { return null; }
};

const title = work => wrap(work.title || '墨鱼工坊作品', 20, 2);
const description = work => clean(work.description || `一款可以直接在线体验的${work.kind === 'game' ? '游戏' : '互动作品'}。`);
const tags = work => (work.tags ?? []).map(clean).filter(Boolean).slice(0, 3);
const steps = work => {
  const candidates = String(work.instructions || '').split(/[\n。！？!?；;]/u).map(clean).filter(item => item.length >= 2);
  const fallbacks = ['打开作品页，点击「立即游玩」', '跟随游戏内提示开始体验', '喜欢的话，可以收藏或分享给朋友'];
  return [...candidates, ...fallbacks].slice(0, 3).map(item => wrap(item, 27, 2));
};
const sourceFacts = work => [
  ['发布者', work.creatorDisplayName || '墨鱼工坊社区作者'],
  ['源代码', work.repositoryUrl ? '已提供公开仓库' : '当前版本未关联公开仓库'],
  ['许可证', work.licenseSpdx || '以作品详情页标注为准'],
  ['游玩方式', work.targets?.some(target => target.targetKey === 'web') || work.id === 'gamehub-guess-baike' ? '浏览器直接游玩' : '查看作品支持的平台'],
];

const coverSvg = work => {
  const lines = title(work); const chips = [work.openSource ? '开放源码' : '免费体验', work.estimatedMinutes ? `约 ${work.estimatedMinutes} 分钟` : '随时开始', '浏览器打开'];
  const chipTop=lines.length>1?1150:1072;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 1, dark: true, label: 'OPEN PLAY / 本周值得玩' })}
    <rect x="48" y="218" width="984" height="640" rx="20" fill="#241b36" stroke="#5e4b78" stroke-width="2" filter="url(#soft-shadow)"/>
    <path d="M48 694h984v164H48z" fill="url(#cover-fade)"/>
    <rect x="72" y="804" width="124" height="7" fill="#8b5cf6"/><rect x="204" y="804" width="28" height="7" fill="#38d39f"/>
    <text x="72" y="875" fill="#b89cff" font-family="${MONO}" font-size="18" font-weight="800" letter-spacing="3">今天玩点不一样的</text>
    ${textBlock(lines,{x:72,y:968,size:78,color:'#fff',weight:850,lineHeight:1.08})}
    ${chips.map((chip,index)=>`<rect x="${72+index*296}" y="${chipTop}" width="274" height="58" rx="8" fill="${index===0?'#8b5cf6':'#211a2c'}" stroke="${index===0?'#a98cff':'#594b68'}"/><text x="${209+index*296}" y="${chipTop+38}" text-anchor="middle" fill="${index===0?'#fff':'#eee9f7'}" font-family="${FONT}" font-size="21" font-weight="800">${escapeXml(chip)}</text>`).join('')}
    <text x="72" y="1282" fill="#c9bfd7" font-family="${FONT}" font-size="24" font-weight="600">无需下载 · 无需注册 · 打开即玩</text>${footer(true)}</svg>`;
};

const overviewSvg = work => {
  const lines = wrap(description(work), 32, 4); const selectedTags = tags(work).length ? tags(work) : ['独立游戏','免费游玩','轻量体验'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 2 })}
    <text x="72" y="276" fill="#17131f" font-family="${FONT}" font-size="62" font-weight="850">为什么值得玩</text><text x="1008" y="270" text-anchor="end" fill="#8b5cf6" font-family="${MONO}" font-size="18" font-weight="800">WHY IT IS WORTH PLAYING</text>
    <rect x="72" y="314" width="152" height="7" fill="#8b5cf6"/><rect x="232" y="314" width="30" height="7" fill="#38d39f"/>
    <rect x="62" y="354" width="956" height="502" rx="18" fill="#e9e4f1" stroke="#cfc6dc" filter="url(#soft-shadow)"/>
    ${textBlock(lines,{x:72,y:954,size:36,color:'#302a39',weight:650,lineHeight:1.48})}
    ${selectedTags.map((tag,index)=>`<rect x="${72+index*300}" y="1194" width="272" height="62" rx="31" fill="${index===0?'#17111f':'#fff'}" stroke="${index===0?'#17111f':'#8b5cf6'}"/><text x="${208+index*300}" y="1235" text-anchor="middle" fill="${index===0?'#fff':'#5c3bc5'}" font-family="${FONT}" font-size="21" font-weight="800"># ${escapeXml(tag)}</text>`).join('')}${footer(false)}</svg>`;
};

const playSvg = work => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 3, label: 'QUICK START / 快速上手' })}
  <text x="72" y="276" fill="#17131f" font-family="${FONT}" font-size="62" font-weight="850">30 秒开始</text><text x="72" y="326" fill="#6c6478" font-family="${FONT}" font-size="24">三步进入状态，不需要先读一整本说明书。</text>
  <line x1="125" y1="420" x2="125" y2="1170" stroke="#cfc6dc" stroke-width="4" stroke-dasharray="10 12"/>
  ${steps(work).map((lines,index)=>{const top=390+index*272;const accent=index===0?'#8b5cf6':index===1?'#17a673':'#e09a31';return `<circle cx="125" cy="${top+112}" r="42" fill="#f8f6fc" stroke="${accent}" stroke-width="4"/><text x="125" y="${top+122}" text-anchor="middle" fill="${accent}" font-family="${MONO}" font-size="25" font-weight="900">0${index+1}</text><rect x="196" y="${top}" width="812" height="224" rx="16" fill="#fff" stroke="#d8d2e2" filter="url(#soft-shadow)"/><rect x="196" y="${top}" width="10" height="224" rx="5" fill="${accent}"/>${textBlock(lines,{x:252,y:top+87,size:34,color:'#17131f',weight:750,lineHeight:1.45})}`;}).join('')}${footer(false)}</svg>`;

const sourceSvg = work => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 4, label: 'SOURCE CARD / 作者与来源' })}
  <text x="72" y="276" fill="#17131f" font-family="${FONT}" font-size="62" font-weight="850">作品从哪里来</text><text x="72" y="328" fill="#6c6478" font-family="${FONT}" font-size="24">免费游玩，也应该看得见作者、仓库与许可证。</text>
  <rect x="58" y="382" width="964" height="740" rx="22" fill="#17111f" filter="url(#soft-shadow)"/><rect x="58" y="382" width="964" height="740" rx="22" fill="url(#pixel-dots)"/>
  ${sourceFacts(work).map(([label,value],index)=>{const left=92+(index%2)*460,top=430+Math.floor(index/2)*320;const lines=wrap(value,22,3);return `<text x="${left}" y="${top}" fill="#b89cff" font-family="${MONO}" font-size="17" font-weight="900" letter-spacing="2">0${index+1} · ${escapeXml(label.toUpperCase())}</text><rect x="${left}" y="${top+31}" width="404" height="220" rx="14" fill="#211a2c" stroke="#493c58"/>${textBlock(lines,{x:left+26,y:top+105,size:30,color:'#fff',weight:750,lineHeight:1.38})}`;}).join('')}
  <rect x="72" y="1174" width="936" height="108" rx="14" fill="#eee9fb"/><circle cx="112" cy="1228" r="10" fill="#8b5cf6"/><text x="140" y="1237" fill="#563ab2" font-family="${FONT}" font-size="22" font-weight="750">详细来源、认领状态和开源信息，以墨鱼工坊作品页为准。</text>${footer(false)}</svg>`;

const ctaSvg = work => {
  const lines=title(work);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}${paper({ page: 5, dark: true, label: 'PLAY IT NOW / 免费体验' })}
    <circle cx="540" cy="610" r="380" fill="url(#violet-glow)"/><rect x="72" y="250" width="936" height="8" fill="#8b5cf6"/>
    <text x="540" y="388" text-anchor="middle" fill="#b89cff" font-family="${MONO}" font-size="23" font-weight="900" letter-spacing="5">现在就能玩</text>
    ${textBlock(lines,{x:540,y:548,size:82,color:'#fff',weight:850,lineHeight:1.12,anchor:'middle'})}
    <g transform="translate(448 700) scale(7.6)" shape-rendering="crispEdges" opacity=".16"><path fill="#b89cff" d="M9 3h6v2h2v2h2v2h2v6h-2v2h-3v-4h-2v5h-4v-5H8v4H5v-2H3V9h2V7h2V5h2V3Z"/></g>
    <rect x="138" y="820" width="804" height="200" rx="20" fill="#211a2c" stroke="#8b5cf6" stroke-width="3" filter="url(#soft-shadow)"/><text x="540" y="890" text-anchor="middle" fill="#bcb2ca" font-family="${FONT}" font-size="22">浏览器访问</text><text x="540" y="965" text-anchor="middle" fill="#fff" font-family="${MONO}" font-size="44" font-weight="900" letter-spacing="2">MOOYU.FUN</text>
    <text x="540" y="1114" text-anchor="middle" fill="#c9bfd7" font-family="${FONT}" font-size="24">进入「发现」，搜索</text><text x="540" y="1182" text-anchor="middle" fill="#b89cff" font-family="${FONT}" font-size="40" font-weight="850">${escapeXml(clean(work.title))}</text>
    <rect x="282" y="1240" width="516" height="52" rx="26" fill="#261d31"/><text x="540" y="1274" text-anchor="middle" fill="#aaa0b8" font-family="${FONT}" font-size="20">试玩无需注册 · 打开即可开始</text>${footer(true)}</svg>`;
};

const slideSvg = (work, slide) => ({ cover: coverSvg, overview: overviewSvg, play: playSvg, source: sourceSvg, cta: ctaSvg })[slide](work);

const imageFrameSvg = slide => {
  if (slide === 'cover') return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${commonDefs}<rect x="80" y="230" width="920" height="610" fill="url(#cover-fade)"/><rect x="48" y="218" width="984" height="640" rx="20" fill="none" stroke="#8b5cf6" stroke-width="2"/></svg>`;
  if (slide === 'overview') return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect x="62" y="354" width="956" height="502" rx="18" fill="none" stroke="#cfc6dc" stroke-width="2"/><rect x="76" y="752" width="112" height="74" rx="10" fill="#8b5cf6"/><text x="132" y="801" text-anchor="middle" fill="#fff" font-family="${MONO}" font-size="28" font-weight="900">02</text></svg>`;
  return null;
};

export async function renderWorkXhsSlide(work, coverBody, slide) {
  if (!slides.includes(slide)) throw new TypeError('Unknown growth content slide.');
  const cover = await coverImage(coverBody, 920, slide === 'cover' ? 610 : 460);
  const composites = [{ input: Buffer.from(slideSvg(work, slide)) }];
  if (cover && slide === 'cover') composites.push({ input: cover, left: 80, top: 230 });
  if (cover && slide === 'overview') composites.push({ input: cover, left: 80, top: 374 });
  const imageFrame = imageFrameSvg(slide);
  if (cover && imageFrame) composites.push({ input: Buffer.from(imageFrame) });
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#f8f6fc' } })
    .composite(composites).timeout({ seconds: 5 }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export const growthContentSlides = slides;
export const growthContentSize = Object.freeze({ width: WIDTH, height: HEIGHT });
