// Loopback-only acceptance shell. Production always uses createRuntime + real auth.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import Fastify from '../apps/api/node_modules/fastify/fastify.js';
import pg from '../apps/api/node_modules/pg/lib/index.js';
import { PostgresPracticeRepository } from '../apps/api/src/practice/repository.mjs';
import { createPracticeService, createPracticeWorker } from '../apps/api/src/practice/service.mjs';
import { createVerifiedMathEngine } from '../apps/api/src/practice/engine.mjs';
import { registerPracticeRoutes } from '../apps/api/src/practice/routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionString = process.env.PRACTICE_TEST_DATABASE_URL ?? 'postgresql://postgres:practice_local_test@127.0.0.1:55438/mooyu_practice_acceptance';
const database = new URL(connectionString);
if (!['127.0.0.1','localhost'].includes(database.hostname) || database.pathname !== '/mooyu_practice_acceptance') throw new Error('Review requires the dedicated loopback acceptance database.');
const pool = new pg.Pool({ connectionString, options: '-c search_path=practice_review,public' });
await pool.query('CREATE SCHEMA IF NOT EXISTS practice_review');
await pool.query('CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY)');
if (!(await pool.query("SELECT to_regclass('practice_review.practice_batches') AS name")).rows[0].name) {
  await pool.query(await readFile(path.join(root,'apps/api/migrations/0160_learning_practice.sql'),'utf8'));
}
const userId = '7c316635-f9e0-41e5-b2a1-2a54dc938c1b';
await pool.query('INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
const outdir = path.join(root,'.runtime/practice-review');
await mkdir(outdir,{recursive:true});
await build({ stdin: { contents: `
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider,LanguageSwitch} from './packages/platform-client/src/I18n.jsx';
import PracticePage from './packages/platform-client/src/PracticePage.jsx';
import LearningPage from './packages/platform-client/src/LearningPage.jsx';
import {createApiClient} from './packages/platform-api-client/src/index.mjs';
import './packages/platform-client/src/styles.css';
const api=createApiClient({getAccessToken:()=> 'local-practice-review'});
api.listWorks=async()=>({data:[]});
function Shell(){const [route,setRoute]=useState(location.hash.slice(1)||'/learn/practice');useEffect(()=>{const f=()=>setRoute(location.hash.slice(1)||'/learn/practice');addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f);},[]);const go=value=>{location.hash=value};return <><header className="review-shell-head"><a href="#/learn">墨鱼<span>工坊</span></a><span>MOOYU.FUN · 本机验收</span><LanguageSwitch/></header>{route==='/learn'?<LearningPage api={api} go={go} Art={()=>null}/>:<PracticePage api={api} go={go} accountProfile={{id:'${userId}'}} batchId={route.split('/')[3]}/>}</>};
createRoot(document.getElementById('root')).render(<I18nProvider><Shell/></I18nProvider>);
`, resolveDir: root, sourcefile: 'practice-review.jsx', loader: 'jsx' }, bundle:true, format:'esm', jsx:'automatic', outfile:path.join(outdir,'app.js'),
  loader:{'.woff':'file','.woff2':'file','.ttf':'file','.eot':'file'}, nodePaths:[path.join(root,'packages/platform-client/node_modules')], assetNames:'[name]-[hash]', logLevel:'warning' });
const app = Fastify();
const repository = new PostgresPracticeRepository(pool), engine = createVerifiedMathEngine();
const service = createPracticeService({repository,engine}), worker = createPracticeWorker({repository,engine});
app.setErrorHandler((error,_request,reply)=>reply.code(error.statusCode??500).send({error:{code:error.code??'INTERNAL_ERROR',message:error.statusCode?error.message:'Review server error'}}));
registerPracticeRoutes(app,{service,requireAuth:async request=>{
  if(request.headers.authorization!=='Bearer local-practice-review')throw Object.assign(new Error('Sign in'),{statusCode:401,code:'AUTH_REQUIRED'});
  request.actor={userId};
}});
const mime={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
app.get('/assets/:name',async(request,reply)=>{
  if(!/^[a-zA-Z0-9_.-]+$/.test(request.params.name))return reply.code(404).send();
  try {const file=path.join(outdir,request.params.name);reply.type(mime[path.extname(file)]??'application/octet-stream');return await readFile(file);}catch{return reply.code(404).send();}
});
app.get('/',async(_request,reply)=>reply.type('text/html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>墨鱼 · 数学练习验收</title><link rel="stylesheet" href="/assets/app.css"><style>body{margin:0}.review-shell-head{height:70px;border-bottom:1px solid var(--gh-border);display:flex;align-items:center;padding:0 max(24px,calc((100vw - 1080px)/2));gap:22px}.review-shell-head>a{color:var(--gh-primary);text-decoration:none;font-size:22px;font-weight:800;white-space:nowrap}.review-shell-head>a span{color:var(--gh-action)}.review-shell-head>span{color:var(--gh-secondary);font-size:10px;letter-spacing:.1em}.review-shell-head>button{margin-left:auto}@media(max-width:540px){.review-shell-head{padding:0 16px;gap:12px}.review-shell-head>span{font-size:8px}}</style></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`));
app.addHook('onClose',async()=>{await worker.stop();await pool.end()});
await app.listen({host:'127.0.0.1',port:4188});worker.start();
console.log('Mooyu practice review: http://127.0.0.1:4188/#/learn/practice');
const stop=async()=>{await app.close();process.exit(0)};process.once('SIGINT',stop);process.once('SIGTERM',stop);
