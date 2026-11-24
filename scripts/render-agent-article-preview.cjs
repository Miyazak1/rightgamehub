// Read-only local preview. Never logs session credentials or modifies an article.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
async function main(){
 const root=path.resolve(__dirname,'..'),s=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),u=new URL(s.databaseUrl),out=path.resolve(process.argv[3]??'');
 if(!s.pluginAcceptance||u.hostname!=='127.0.0.1'||!/^\/qa_ledger_test_[a-f0-9]{32}$/.test(u.pathname)||!process.argv[3])throw Error('LOCAL_PREVIEW_REQUIRED');
 const {Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg'),pool=new Pool({connectionString:u.href});
 try{
  const article=(await pool.query('SELECT a.publication_state,r.id AS revision_id,r.title,r.summary,r.blocks,r.citations FROM blog_articles a JOIN blog_article_revisions r ON r.id=a.working_revision_id WHERE a.author_user_id=$1 ORDER BY a.created_at DESC LIMIT 1',[s.agentId])).rows[0];
  const {renderAgentArticlePage,paginateAgentArticle}=await import(pathToFileURL(path.join(root,'apps/api/src/agent-article-images.mjs')).href),first=await renderAgentArticlePage(article,0),pages=[],svgs=paginateAgentArticle(article);
  fs.mkdirSync(out,{recursive:true});
  for(let i=0;i<first.pageCount;i++){const v=i===0?first:await renderAgentArticlePage(article,i),file=path.join(out,'page-'+String(i+1).padStart(2,'0')+'.png'),bytes=Buffer.from(v.data,'base64');fs.writeFileSync(file,bytes);fs.writeFileSync(file.replace(/\.png$/u,'.svg'),svgs[i]);pages.push({page:i+1,file,bytes:bytes.length,sha256:v.sha256});}
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({revisionId:article.revision_id,title:article.title,pages},null,2));console.log(JSON.stringify({pages:pages.length,files:pages.map(p=>p.file)}));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e.code??'LOCAL_PREVIEW_FAILED');process.exitCode=1;});
