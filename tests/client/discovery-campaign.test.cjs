const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');

test('discovery campaigns stay inside discovery and provide admin curation',async()=>{
  const [page,discover,app,caddy]=await Promise.all([
    fs.readFile('packages/platform-client/src/DiscoveryCampaigns.jsx','utf8'),
    fs.readFile('packages/platform-client/src/DiscoverPage.jsx','utf8'),
    fs.readFile('packages/platform-client/src/App.jsx','utf8'),
    fs.readFile('deploy/Caddyfile','utf8'),
  ]);
  assert.match(discover,/DiscoveryCampaignSpotlight/);
  assert.match(app,/DiscoveryCampaignPage/);
  assert.match(app,/DiscoveryCampaignAdmin/);
  assert.match(page,/发现页运营专题/);
  assert.match(page,/套用运营模板/);
  assert.match(page,/作者联动素材/);
  assert.match(page,/gh_src','campaign'/);
  assert.match(page,/campaign\.download/);
  assert.match(page,/useI18n/);
  assert.match(page,/rememberWorkAttribution\(item\.work\.id,'campaign'/);
  assert.doesNotMatch(page,/go\('\/community/u);
  assert.match(caddy,/handle \/discover\/c\/\*/);
});

test('campaign share cards and author kits reuse stable attributed links',async()=>{
  const {createApiClient}=await import('../../packages/platform-api-client/src/index.mjs');
  const client=createApiClient();
  assert.equal(client.discoveryCampaignShareCardUrl('weekly game',{version:2,download:true}),'/v1/discovery/campaigns/weekly%20game/share-card.png?v=2&download=1');
  assert.equal(client.discoveryCampaignShareCardUrl('weekly game',{version:2,locale:'en'}),'/v1/discovery/campaigns/weekly%20game/share-card.png?v=2&lang=en');
  const source=await fs.readFile('packages/platform-client/src/DiscoveryCampaigns.jsx','utf8');
  assert.match(source,/new URL\(`\/w\/\$\{encodeURIComponent\(item\.work\.id\)\}`/);
  assert.match(source,/gh_campaign/);
  assert.match(source,/campaign\.publicUrl/);
});

test('stable campaign handoff keeps a clean discovery URL',async()=>{
  const {readBrowserRoute,consumePublicWorkHandoff,navigateBrowserRoute}=await import('../../packages/platform-client/src/public-work-route.mjs');
  const location={pathname:'/',hash:'#/discover/c/weekly-open-game-01?public=1'};
  const calls=[];
  const history={state:null,replaceState:(_state,_title,url)=>{calls.push(['replace',url]);location.pathname=url;location.hash='';},pushState:(_state,_title,url)=>{calls.push(['push',url]);const parsed=new URL(url,'https://mooyu.fun');location.pathname=parsed.pathname;location.hash=parsed.hash;}};
  assert.equal(readBrowserRoute('hash',location),'/discover/c/weekly-open-game-01');
  assert.equal(consumePublicWorkHandoff(location,history),true);
  assert.equal(location.pathname,'/discover/c/weekly-open-game-01');
  let route='';navigateBrowserRoute('hash','/discover/c/second-campaign',location,history,next=>{route=next;});
  assert.equal(route,'/discover/c/second-campaign');assert.equal(location.pathname,'/discover/c/second-campaign');
});

test('campaign attribution is stored without exposing a referrer URL',async()=>{
  const {rememberWorkAttribution,getWorkAttribution}=await import('../../packages/platform-client/src/analytics-attribution.mjs');
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  assert.deepEqual(rememberWorkAttribution('work-1','campaign','weekly-open-game-01',storage),{attributionSource:'campaign',campaignKey:'weekly-open-game-01'});
  assert.deepEqual(getWorkAttribution('work-1',storage),{attributionSource:'campaign',campaignKey:'weekly-open-game-01'});
});
