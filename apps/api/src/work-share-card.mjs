import sharp from 'sharp';

const WIDTH = 1200;
const HEIGHT = 630;
const FONT_STACK = `'WenQuanYi Zen Hei','Noto Sans CJK SC','Microsoft YaHei UI','Segoe UI',sans-serif`;

const escapeXml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);

const units = character => /[\u0000-\u00ff]/u.test(character) ? 1 : 2;
const titleLines = value => {
  const characters = Array.from(String(value || '墨鱼工坊作品').replace(/\s+/gu, ' ').trim());
  const lines = ['']; let lineUnits = 0;
  for (const character of characters) {
    const size = units(character);
    if (lineUnits + size > 30 && lines.length === 1) { lines.push(''); lineUnits = 0; }
    if (lineUnits + size > 30) { lines[1] = `${lines[1].replace(/…$/u, '')}…`; break; }
    lines[lines.length - 1] += character; lineUnits += size;
  }
  return lines;
};

const sourceLabel = work => {
  if (work.licenseSpdx) return `${work.licenseSpdx} · ${work.openSource ? '开放源码' : '许可证待核验'}`;
  if (work.repositoryUrl) return '查看源码与项目来源';
  return '免费在线体验';
};

const overlaySvg = work => {
  const lines = titleLines(work.title);
  const titleSize = lines.length > 1 ? 54 : 64;
  const firstY = lines.length > 1 ? 430 : 468;
  const creator = work.creatorDisplayName || (work.id === 'gamehub-guess-baike' ? '墨鱼工坊' : '社区作者');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#100c19" stop-opacity=".08"/><stop offset=".5" stop-color="#100c19" stop-opacity=".22"/><stop offset="1" stop-color="#100c19" stop-opacity=".98"/></linearGradient>
      <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0v24" fill="none" stroke="#b89cff" stroke-opacity=".09" stroke-width="1"/></pattern>
    </defs>
    <rect width="1200" height="630" fill="url(#shade)"/>
    <rect width="1200" height="630" fill="url(#grid)"/>
    <path fill="#8b5cf6" d="M58 48h18v18h18v18h18v18H94v18H76v-18H58V84H40V66h18z"/>
    <text x="132" y="83" fill="#fff" font-family="${FONT_STACK}" font-size="26" font-weight="800" letter-spacing="2">墨鱼<tspan fill="#b89cff">工坊</tspan></text>
    <rect x="938" y="47" width="204" height="42" fill="#15111f" fill-opacity=".76" stroke="#b89cff" stroke-width="2"/>
    <text x="1040" y="75" text-anchor="middle" fill="#f7f4ff" font-family="${FONT_STACK}" font-size="17" font-weight="700" letter-spacing="2">免费在线游玩</text>
    <text x="58" y="${firstY}" fill="#fff" font-family="${FONT_STACK}" font-size="${titleSize}" font-weight="800">${escapeXml(lines[0])}</text>
    ${lines[1] ? `<text x="58" y="494" fill="#fff" font-family="${FONT_STACK}" font-size="${titleSize}" font-weight="800">${escapeXml(lines[1])}</text>` : ''}
    <rect x="58" y="530" width="1084" height="2" fill="#8b5cf6"/>
    <text x="58" y="577" fill="#eee9f7" font-family="${FONT_STACK}" font-size="22">by ${escapeXml(creator)} · ${escapeXml(sourceLabel(work))}</text>
    <text x="1142" y="577" text-anchor="end" fill="#c2b8d1" font-family="${FONT_STACK}" font-size="20">mooyu.fun</text>
  </svg>`);
};

const coverLayer = async body => {
  if (!body) return null;
  try {
    return await sharp(body, { failOn: 'warning', limitInputPixels: 16 * 1024 * 1024, sequentialRead: true })
      .rotate().resize({ width: WIDTH, height: HEIGHT, fit: 'cover', position: 'attention' })
      .modulate({ brightness: 0.82, saturation: 0.9 }).png().toBuffer();
  } catch { return null; }
};

export async function renderWorkShareCard(work, coverBody = null) {
  const cover = await coverLayer(coverBody);
  const background = sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: '#241b36' } });
  const layers = [...(cover ? [{ input: cover }] : []), { input: overlaySvg(work) }];
  return background.composite(layers).timeout({ seconds: 5 }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

export const workShareCardSize = Object.freeze({ width: WIDTH, height: HEIGHT });
