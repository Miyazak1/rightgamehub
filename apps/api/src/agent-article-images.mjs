import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:422});};
const escape=text=>String(text).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const units=c=>/^[\x20-\x7e]$/u.test(c)?1:1.1;
export function paginateAgentArticle(article){
 if(typeof article?.title!=='string'||!Array.isArray(article.blocks)||!Array.isArray(article.citations))fail('AGENT_ARTICLE_IMAGE_CONTENT_INVALID');
 const paragraphs=[{text:article.title,size:38,weight:700},{text:article.summary??'',size:26,color:'#475569'}];
 const references=block=>(block.citationIds??[]).map(id=>{const i=article.citations.findIndex(c=>c.id===id);if(i<0)fail('AGENT_ARTICLE_IMAGE_CONTENT_INVALID');return `[${i+1}]`;}).join('');
 for(const block of article.blocks){
  if(block.type==='heading')paragraphs.push({text:block.text,size:32,weight:700});
  else if(block.type==='paragraph'||block.type==='code')paragraphs.push({text:(block.text??block.code)+references(block),size:26});
  else if(block.type==='list')block.items.forEach((text,i)=>paragraphs.push({text:(block.ordered?(i+1)+'. ':'• ')+text+references(block),size:26}));
  else fail('AGENT_ARTICLE_IMAGE_BLOCK_UNSUPPORTED');
 }
 if(article.citations.length)paragraphs.push({text:'参考资料',size:32,weight:700});
 article.citations.forEach((c,i)=>paragraphs.push({text:`[${i+1}] ${c.title??c.label??''}\n${c.url??''}${c.locator?'\n'+c.locator:''}`,size:22,color:'#475569'}));
 if(paragraphs.some(p=>typeof p.text!=='string')||paragraphs.reduce((n,p)=>n+p.text.length,0)>50000)fail('AGENT_ARTICLE_IMAGE_CONTENT_TOO_LARGE');
 const pages=[[]];let y=116;
 for(const p of paragraphs){
  for(const raw of p.text.split(/\r?\n/u)){
   let line='',width=0;const lines=[];
   const words=[];let opening='';
   for(const {segment}of new Intl.Segmenter('zh',{granularity:'word'}).segment(raw)){
    if(/^[（《“‘\[]+$/u.test(segment)){opening+=segment;continue;}
    const word=opening+segment;opening='';
    if(words.length&&(/^[，。！？；：、）》”’\]〉]+$/u.test(segment)||/^\s+$/u.test(segment)))words[words.length-1]+=word;else words.push(word);
   }
   if(opening)words.push(opening);
   for(const word of words){
    const wordWidth=[...word].reduce((n,x)=>n+units(x)*p.size,0);
    if(wordWidth<=936){if(width+wordWidth>936&&line){lines.push(line);line='';width=0;}line+=word;width+=wordWidth;continue;}
    for(const {segment:c}of new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(word)){
     const next=[...c].reduce((n,x)=>n+units(x)*p.size,0);if(width+next>936&&line){lines.push(line);line='';width=0;}line+=c;width+=next;
    }
   }lines.push(line);
   for(const text of lines){if(y+p.size*1.65>1485){pages.push([]);y=116;}pages.at(-1).push({...p,text,y});y+=p.size*1.65;}
  }y+=24;
 }
 if(pages.length>24)fail('AGENT_ARTICLE_IMAGE_TOO_MANY_PAGES');
 return pages.map((lines,i)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1600"><rect width="1080" height="1600" fill="#fff"/><text x="72" y="58" font-size="20" fill="#64748b" font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif">小墨鱼 · 文章全文</text>${lines.map(p=>`<text x="72" y="${p.y}" font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="${p.size}" font-weight="${p.weight??400}" fill="${p.color??'#172033'}" xml:space="preserve">${escape(p.text)}</text>`).join('')}<text x="72" y="1550" font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="20" fill="#64748b">${i+1} / ${pages.length} · ${escape(article.publication_state==='draft'?'草稿 · 未发布':'文章')}</text></svg>`);
}
const cache=new Map();
export async function renderAgentArticlePage(article,page){
 if(!Number.isInteger(page)||page<0||page>=24)fail('AGENT_ARTICLE_IMAGE_PAGE_INVALID');
 const svgs=paginateAgentArticle(article);if(page>=svgs.length)fail('AGENT_ARTICLE_IMAGE_PAGE_INVALID');
 const key=createHash('sha256').update(svgs[page]).digest('hex');let pending=cache.get(key);
 if(!pending){pending=(async()=>{const {default:sharp}=await import('sharp');const data=await sharp(Buffer.from(svgs[page]),{limitInputPixels:2000000}).png().toBuffer();if(data.length>1048576)fail('AGENT_ARTICLE_IMAGE_TOO_LARGE');return {schemaVersion:'agent-article-image-v1',rendererVersion:1,page,pageCount:svgs.length,revisionId:article.revision_id,mimeType:'image/png',sha256:createHash('sha256').update(data).digest('hex'),data:data.toString('base64')};})();cache.set(key,pending);if(cache.size>24)cache.delete(cache.keys().next().value);pending.catch(()=>cache.delete(key));}
 return {...await pending,revisionId:article.revision_id};
}
