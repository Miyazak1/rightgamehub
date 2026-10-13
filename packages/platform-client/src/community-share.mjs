export function communityPostUrl(location,postId) {
  if(!location?.origin)throw new Error('page location unavailable');
  return `${location.origin}/community/posts/${encodeURIComponent(postId)}`;
}

export async function copyCommunityPostLink({location,clipboard,prompt,promptLabel='复制动态链接'},postId) {
  const url=communityPostUrl(location,postId);
  if(clipboard?.writeText){
    try{
      await clipboard.writeText(url);
      return {url,copied:true,method:'clipboard'};
    }catch{}
  }
  if(typeof prompt==='function'){
    prompt(promptLabel,url);
    return {url,copied:false,method:'prompt'};
  }
  return {url,copied:false,method:'unavailable'};
}
