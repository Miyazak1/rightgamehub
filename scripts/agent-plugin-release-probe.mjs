// No database, credentials or network: dependency/font smoke check in a disposable runtime.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderAgentArticlePage} from '../apps/api/src/agent-article-images.mjs';
const out=process.argv[2];if(!out)throw Error('OUTPUT_DIRECTORY_REQUIRED');
const fontDirectories=['/usr/share/fonts/truetype/wqy','/usr/share/fonts/opentype/noto'];
const fonts=fontDirectories.filter(d=>fs.existsSync(d)).flatMap(d=>fs.readdirSync(d).map(f=>path.join(d,f)));
if(process.platform==='linux'&&!fonts.some(f=>/\.(ttf|ttc|otf)$/iu.test(f)))throw Error('CHINESE_FONT_REQUIRED');
const article={revision_id:'11111111-1111-4111-a111-111111111111',publication_state:'draft',title:'小墨鱼 Linux 中文分页检查',summary:'验证中文、标点与参考资料，不连接数据库或网络。',blocks:Array.from({length:16},(_,i)=>({type:'paragraph',text:`第${i+1}段：`+'中文文章分页与引用完整性。'.repeat(14)})),citations:[{title:'验证资料',url:'https://example.invalid/source'}]};
fs.mkdirSync(out,{recursive:true});const first=await renderAgentArticlePage(article,0),pages=[];
for(let page=0;page<first.pageCount;page++){const v=page?await renderAgentArticlePage(article,page):first,data=Buffer.from(v.data,'base64'),name=`linux-page-${page+1}.png`;fs.writeFileSync(path.join(out,name),data);pages.push({page:page+1,file:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
const report={platform:process.platform,node:process.version,fontFiles:fonts,pageCount:first.pageCount,pages,databaseConnected:false,networkRequired:false,paperEnabled:false};
fs.writeFileSync(path.join(out,'linux-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
