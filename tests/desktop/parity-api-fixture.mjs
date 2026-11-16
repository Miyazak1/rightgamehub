import {createIsolatedAccountApi} from './account-api-fixture.mjs';
export async function createParityApiFixture({onMail}={}){
  const calls=[];
  const backend=await createIsolatedAccountApi({onMail,handleBusinessRequest:async(req,res,url,authenticate)=>{
    if(url.pathname.startsWith('/v1/auth/')||url.pathname==='/v1/me')return false;
    const path=url.pathname;
    if(path.startsWith('/v1/me/')||path.startsWith('/v1/community/')||path.startsWith('/v1/admin/'))await authenticate();
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const bytes=Buffer.concat(chunks);calls.push({path,method:req.method,bytes:bytes.length});
    if(path.endsWith('/package')&&req.method==='GET'||path.endsWith('/download')){
      res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="fixture.zip"'});res.end('PK-native-archive');return true;
    }
    if(path.includes('/community/media/')&&req.method==='GET'){
      res.writeHead(200,{'content-type':'image/webp'});res.end('native-community-image');return true;
    }
    if(path.endsWith('share-card.png')){
      res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'));return true;
    }
    if(path.endsWith('/content')&&req.method==='GET'){
      res.writeHead(200,{'content-type':'application/octet-stream',etag:'"save-one"'});res.end(Buffer.from([0,1,254,255]));return true;
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{items:[],receivedBytes:bytes.length}}));return true;
  }});
  return {...backend,calls};
}
