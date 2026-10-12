const assert=require('node:assert/strict');
const path=require('node:path');
const test=require('node:test');
const {pathToFileURL}=require('node:url');

const moduleUrl=pathToFileURL(path.resolve(__dirname,'../../packages/platform-client/src/community-share.mjs')).href;

test('community share copies the stable public post URL instead of reporting an unrelated clipboard value',async()=>{
  const {communityPostUrl,copyCommunityPostLink}=await import(moduleUrl);
  const location={origin:'https://mooyu.fun',pathname:'/'};
  assert.equal(communityPostUrl(location,'post / 一'),`https://mooyu.fun/community/posts/${encodeURIComponent('post / 一')}`);
  let written='';
  const result=await copyCommunityPostLink({location,clipboard:{writeText:async value=>{written=value;}}},'post-123');
  assert.deepEqual(result,{url:'https://mooyu.fun/community/posts/post-123',copied:true,method:'clipboard'});
  assert.equal(written,result.url);
});

test('community share exposes the exact URL for manual copy when clipboard permission is denied',async()=>{
  const {copyCommunityPostLink}=await import(moduleUrl);
  let promptCall;
  const result=await copyCommunityPostLink({
    location:{origin:'https://mooyu.fun',pathname:'/'},
    clipboard:{writeText:async()=>{throw new Error('denied');}},
    prompt:(label,value)=>{promptCall={label,value};},
  },'post-456');
  assert.deepEqual(result,{url:'https://mooyu.fun/community/posts/post-456',copied:false,method:'prompt'});
  assert.deepEqual(promptCall,{label:'复制动态链接',value:result.url});
});
