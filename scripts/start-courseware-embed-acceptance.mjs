import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sampleRoot=path.join(root,'samples/courseware-embed');
const sdkRoot=path.join(root,'packages/courseware-embed-sdk/src');
const names=new Set(['concept-explorer','causal-simulation','algorithm-stepper']);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const send=(response,status,body,headers={})=>{response.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});response.end(body);};
const content=async file=>({body:await readFile(file),type:mime[path.extname(file)] ?? 'application/octet-stream'});

export async function startCoursewareEmbedAcceptance({hostPort=4173,secondaryHostPort=4175,runtimePort=4174,hostname='127.0.0.1'}={}) {
  if(!['127.0.0.1','localhost','::1'].includes(hostname))throw Object.assign(new Error('Acceptance server is loopback-only.'),{code:'COURSEWARE_EMBED_HOST_INVALID'});
  let hostOrigin,secondaryHostOrigin,runtimeOrigin;
  const createHost=()=>http.createServer(async(request,response)=>{try{
    const url=new URL(request.url,`http://${request.headers.host??hostname}`),pathname=url.pathname;
    if(pathname==='/'){response.writeHead(302,{Location:'/acceptance/concept-explorer.html'});response.end();return;}
    let file;
    if(/^\/acceptance\/(concept-explorer|causal-simulation|algorithm-stepper)\.html$/u.test(pathname))file=path.join(sampleRoot,path.basename(pathname));
    else if(pathname==='/reference-host.mjs'||pathname==='/styles.css')file=path.join(sampleRoot,path.basename(pathname));
    else if(/^\/sdk\/[a-z0-9-]+\.mjs$/u.test(pathname))file=path.join(sdkRoot,path.basename(pathname));
    else{send(response,404,'Not found');return;}
    const result=await content(file);let body=result.body;if(result.type.startsWith('text/html'))body=Buffer.from(body.toString().replaceAll('__RUNTIME_ORIGIN__',runtimeOrigin));
    send(response,200,body,{'Content-Type':result.type,'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'; frame-src ${runtimeOrigin}; img-src 'self' data:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'`});
  }catch{send(response,500,'Acceptance host error');}});
  const host=createHost(),secondaryHost=createHost();
  const runtime=http.createServer(async(request,response)=>{try{
    const url=new URL(request.url,runtimeOrigin ?? `http://${hostname}`),pathname=url.pathname;let file,template=false;
    const runtimeMatch=pathname.match(/^\/runtime\/([a-z-]+)$/u),templateMatch=pathname.match(/^\/templates\/([a-z-]+)\/dist\/index\.html$/u);
    if(runtimeMatch&&names.has(runtimeMatch[1]))file=path.join(sampleRoot,'gateway.html');
    else if(templateMatch&&names.has(templateMatch[1])){file=path.join(root,'templates/courseware',templateMatch[1],'dist/index.html');template=true;}
    else if(pathname==='/runtime-gateway.mjs'||pathname==='/gateway.css')file=path.join(sampleRoot,path.basename(pathname));
    else if(/^\/sdk\/[a-z0-9-]+\.mjs$/u.test(pathname))file=path.join(sdkRoot,path.basename(pathname));
    else{send(response,404,'Not found');return;}
    const frameAncestors=[hostOrigin,secondaryHostOrigin].join(' ');const result=await content(file);const csp=template?`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'self' ${frameAncestors}; base-uri 'none'; object-src 'none'`:`default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'none'; img-src data:; frame-ancestors ${frameAncestors}; base-uri 'none'; object-src 'none'`;
    send(response,200,result.body,{'Content-Type':result.type,'Content-Security-Policy':csp,'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()','Referrer-Policy':'strict-origin-when-cross-origin'});
  }catch{send(response,500,'Acceptance runtime error');}});
  const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,()=>{server.off('error',reject);resolve();});});
  await listen(host,hostPort);hostOrigin=`http://${hostname}:${host.address().port}`;
  try{await listen(secondaryHost,secondaryHostPort);secondaryHostOrigin=`http://${hostname}:${secondaryHost.address().port}`;}catch(error){await new Promise(resolve=>host.close(resolve));throw error;}
  try{await listen(runtime,runtimePort);}catch(error){await Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>secondaryHost.close(resolve))]);throw error;}
  runtimeOrigin=`http://${hostname}:${runtime.address().port}`;
  const hostOrigins=Object.freeze([hostOrigin,secondaryHostOrigin]);
  const close=()=>Promise.all([new Promise(resolve=>host.close(resolve)),new Promise(resolve=>secondaryHost.close(resolve)),new Promise(resolve=>runtime.close(resolve))]);
  return Object.freeze({hostOrigin,hostOrigins,runtimeOrigin,urls:hostOrigins.flatMap(origin=>[...names].map(name=>`${origin}/acceptance/${name}.html`)),close});
}

if(path.resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
  const started=await startCoursewareEmbedAcceptance();
  console.log(`MOOYU Courseware Embed v2 acceptance (v1 remains frozen)\nHosts: ${started.hostOrigins.join(', ')}\nRuntime: ${started.runtimeOrigin}\n${started.urls.join('\n')}\n按 Ctrl+C 停止。`);
  const stop=async()=>{await started.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
