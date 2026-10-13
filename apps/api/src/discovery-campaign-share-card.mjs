import sharp from 'sharp';

const WIDTH=1200,HEIGHT=630;
const FONT_STACK=`'WenQuanYi Zen Hei','Noto Sans CJK SC','Microsoft YaHei UI','Segoe UI',sans-serif`;
const escapeXml=value=>String(value??'').replace(/[&<>"']/gu,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;',
})[character]);
const units=character=>/[\u0000-\u00ff]/u.test(character)?1:2;
const wrap=(value,maxUnits,maxLines)=>{
  const lines=[''];let size=0;
  for(const character of Array.from(String(value??'').replace(/\s+/gu,' ').trim())){
    const next=units(character);
    if(size+next>maxUnits){
      if(lines.length>=maxLines){lines[maxLines-1]=`${lines[maxLines-1].replace(/…$/u,'')}…`;break;}
      lines.push('');size=0;
    }
    lines[lines.length-1]+=character;size+=next;
  }
  return lines;
};

const overlaySvg=campaign=>{
  const title=wrap(campaign.title,20,2);
  const summary=wrap(campaign.summary,42,2);
  const creators=[...new Set(campaign.items.map(item=>item.work?.creatorDisplayName).filter(Boolean))].slice(0,2);
  const creatorLine=creators.length?`作者联动 · ${creators.join(' / ')}`:'墨鱼工坊开放游戏专题';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0v24" fill="none" stroke="#b89cff" stroke-opacity=".09"/></pattern><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#17111f"/><stop offset=".58" stop-color="#21172f"/><stop offset="1" stop-color="#21172f" stop-opacity=".24"/></linearGradient></defs>
    <rect width="1200" height="630" fill="#17111f"/><rect width="1200" height="630" fill="url(#grid)"/><rect width="1200" height="630" fill="url(#fade)"/>
    <path fill="#8b5cf6" d="M58 48h18v18h18v18h18v18H94v18H76v-18H58V84H40V66h18z"/>
    <text x="132" y="83" fill="#fff" font-family="${FONT_STACK}" font-size="26" font-weight="800" letter-spacing="2">GAME<tspan fill="#b89cff">HUB</tspan></text>
    <text x="58" y="172" fill="#b89cff" font-family="${FONT_STACK}" font-size="20" font-weight="800" letter-spacing="3">${escapeXml(campaign.eyebrow)}</text>
    <text x="58" y="250" fill="#fff" font-family="${FONT_STACK}" font-size="56" font-weight="800">${escapeXml(title[0])}</text>
    ${title[1]?`<text x="58" y="318" fill="#fff" font-family="${FONT_STACK}" font-size="56" font-weight="800">${escapeXml(title[1])}</text>`:''}
    <text x="58" y="${title[1]?388:330}" fill="#cfc5dd" font-family="${FONT_STACK}" font-size="21">${escapeXml(summary[0])}</text>
    ${summary[1]?`<text x="58" y="${title[1]?423:365}" fill="#cfc5dd" font-family="${FONT_STACK}" font-size="21">${escapeXml(summary[1])}</text>`:''}
    <rect x="58" y="488" width="510" height="2" fill="#8b5cf6"/>
    <text x="58" y="532" fill="#f3effa" font-family="${FONT_STACK}" font-size="20" font-weight="700">${campaign.items.length} 款免费游戏 · 打开即玩</text>
    <text x="58" y="568" fill="#a99db9" font-family="${FONT_STACK}" font-size="17">${escapeXml(creatorLine)}</text>
    <text x="1142" y="585" text-anchor="end" fill="#c2b8d1" font-family="${FONT_STACK}" font-size="19">mooyu.fun</text>
  </svg>`);
};

const positions=count=>count<=1
  ?[{left:690,top:70,width:450,height:470}]
  :count===2
    ?[{left:690,top:70,width:450,height:225},{left:690,top:315,width:450,height:225}]
    :[{left:660,top:70,width:280,height:470},{left:960,top:70,width:180,height:225},{left:960,top:315,width:180,height:225}];

const coverLayer=async(body,position,index)=>{
  if(body)try{return{input:await sharp(body,{failOn:'warning',limitInputPixels:16*1024*1024,sequentialRead:true}).rotate().resize({width:position.width,height:position.height,fit:'cover',position:'attention'}).modulate({brightness:.86,saturation:.92}).png().toBuffer(),left:position.left,top:position.top};}catch{}
  const colors=['#392a54','#243957','#4d2d43'];
  return{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${position.width}" height="${position.height}"><rect width="100%" height="100%" fill="${colors[index%colors.length]}"/><path fill="#a987ff" d="M${position.width/2-24} ${position.height/2-24}h16v16h16v16h16v16h-16v16h-16v-16h-16v-16h-16v-16h16z"/></svg>`),left:position.left,top:position.top};
};

export async function renderDiscoveryCampaignShareCard(campaign,coverBodies=[]){
  const selected=campaign.items.slice(0,3),layout=positions(selected.length||1);
  const covers=await Promise.all(layout.map((position,index)=>coverLayer(coverBodies[index],position,index)));
  return sharp({create:{width:WIDTH,height:HEIGHT,channels:4,background:'#17111f'}})
    .composite([...covers,{input:overlaySvg(campaign)}]).timeout({seconds:5}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
}

export const discoveryCampaignShareCardSize=Object.freeze({width:WIDTH,height:HEIGHT});
