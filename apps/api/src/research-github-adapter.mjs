import {ResearchFeedError} from './research-feed-adapter.mjs';

const segmentPattern=/^[A-Za-z0-9_.-]{1,100}$/u;

export function normalizeGitHubRepositoryUrl(input){
  let parsed;
  try{parsed=input instanceof URL?new URL(input.href):new URL(String(input??'').trim());}
  catch{throw new ResearchFeedError('RESEARCH_GITHUB_URL_INVALID','请输入完整的 GitHub 仓库地址。',400);}
  if(parsed.protocol!=='https:'||parsed.hostname.toLowerCase()!=='github.com'||parsed.username||parsed.password||parsed.search){throw new ResearchFeedError('RESEARCH_GITHUB_URL_INVALID','仅支持公开的 https://github.com/owner/repository 仓库地址。',400);}
  const parts=parsed.pathname.split('/').filter(Boolean);
  if(parts.length!==2)throw new ResearchFeedError('RESEARCH_GITHUB_URL_INVALID','GitHub 来源必须指向一个仓库，而不是用户、组织或子页面。',400);
  const owner=parts[0],repository=parts[1].replace(/\.git$/iu,'');
  if(!segmentPattern.test(owner)||!segmentPattern.test(repository))throw new ResearchFeedError('RESEARCH_GITHUB_URL_INVALID','GitHub 仓库名称格式无效。',400);
  return new URL(`https://github.com/${owner}/${repository}`);
}

export function createGitHubReleaseAdapter({feedAdapter}={}){
  if(!feedAdapter?.inspect)throw new TypeError('A syndication feed adapter is required.');
  return{async inspect(repositoryUrl){const repository=normalizeGitHubRepositoryUrl(repositoryUrl),feedUrl=`${repository.href}/releases.atom`,preview=await feedAdapter.inspect(feedUrl);return{...preview,protocol:'github-release-preview-v1',repositoryUrl:repository.href,feed:{...preview.feed,url:feedUrl,homeUrl:`${repository.href}/releases`},entries:preview.entries.map(entry=>({...entry,kind:'github-release'}))};}};
}
