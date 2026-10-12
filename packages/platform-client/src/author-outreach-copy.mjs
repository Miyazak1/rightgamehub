export function githubIssueDraftUrl(item,draft){
  const url=new URL(`${item.repositoryUrl}/issues/new`);
  url.searchParams.set('title',draft.draftSubject);
  url.searchParams.set('body',draft.draftBody.slice(0,2400));
  return String(url);
}
