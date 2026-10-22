import crypto from 'node:crypto';

const outlets=[
  {id:'reuters',name:'Reuters',region:'global',countries:['GB'],languages:['en'],domains:['reuters.com'],discoveryModes:['search'],accessPolicy:'licensed',officialReference:'https://reutersagency.com/license-reuters-content/'},
  {id:'ap',name:'Associated Press',region:'global',countries:['US'],languages:['en'],domains:['apnews.com'],discoveryModes:['search'],accessPolicy:'licensed',officialReference:'https://developer.ap.org/ap-media-api/'},
  {id:'bbc',name:'BBC News',region:'europe',countries:['GB'],languages:['en'],domains:['bbc.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'license-required-business',rssCandidates:['https://feeds.bbci.co.uk/news/world/rss.xml'],officialReference:'https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm'},
  {id:'al-jazeera',name:'Al Jazeera',region:'global',countries:['QA'],languages:['en'],domains:['aljazeera.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://www.aljazeera.com/xml/rss/all.xml'],officialReference:'https://www.aljazeera.com/'},
  {id:'guardian',name:'The Guardian',region:'europe',countries:['GB'],languages:['en'],domains:['theguardian.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'personal-noncommercial',rssCandidates:['https://www.theguardian.com/world/rss'],officialReference:'https://www.theguardian.com/help/feeds'},
  {id:'dw',name:'Deutsche Welle',region:'europe',countries:['DE'],languages:['en','de'],domains:['dw.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://rss.dw.com/rdf/rss-en-all'],officialReference:'https://www.dw.com/'},
  {id:'france24',name:'France 24',region:'europe',countries:['FR'],languages:['en','fr'],domains:['france24.com'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.france24.com/'},
  {id:'euronews',name:'Euronews',region:'europe',countries:['EU'],languages:['en','fr','de'],domains:['euronews.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://www.euronews.com/rss?level=theme&name=news'],officialReference:'https://www.euronews.com/'},
  {id:'politico-eu',name:'POLITICO Europe',region:'europe',countries:['EU'],languages:['en'],domains:['politico.eu'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.politico.eu/'},
  {id:'financial-times',name:'Financial Times',region:'europe',countries:['GB'],languages:['en'],domains:['ft.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.ft.com/'},
  {id:'le-monde',name:'Le Monde',region:'europe',countries:['FR'],languages:['fr'],domains:['lemonde.fr'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.lemonde.fr/'},
  {id:'spiegel',name:'Der Spiegel',region:'europe',countries:['DE'],languages:['de','en'],domains:['spiegel.de'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.spiegel.de/'},
  {id:'elpais',name:'El País',region:'europe',countries:['ES'],languages:['es','en'],domains:['elpais.com'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://elpais.com/'},
  {id:'npr',name:'NPR',region:'americas',countries:['US'],languages:['en'],domains:['npr.org'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://feeds.npr.org/1004/rss.xml'],officialReference:'https://www.npr.org/'},
  {id:'new-york-times',name:'The New York Times',region:'americas',countries:['US'],languages:['en'],domains:['nytimes.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'personal-noncommercial',rssCandidates:['https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],officialReference:'https://www.nytimes.com/rss'},
  {id:'washington-post',name:'The Washington Post',region:'americas',countries:['US'],languages:['en'],domains:['washingtonpost.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.washingtonpost.com/'},
  {id:'cbc',name:'CBC News',region:'americas',countries:['CA'],languages:['en','fr'],domains:['cbc.ca'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.cbc.ca/news'},
  {id:'bloomberg',name:'Bloomberg',region:'americas',countries:['US'],languages:['en'],domains:['bloomberg.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.bloomberg.com/'},
  {id:'wall-street-journal',name:'The Wall Street Journal',region:'americas',countries:['US'],languages:['en'],domains:['wsj.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.wsj.com/'},
  {id:'cnn',name:'CNN',region:'americas',countries:['US'],languages:['en'],domains:['cnn.com'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.cnn.com/'},
  {id:'nhk-world',name:'NHK WORLD-JAPAN',region:'asia',countries:['JP'],languages:['en','ja'],domains:['nhk.or.jp'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www3.nhk.or.jp/nhkworld/'},
  {id:'kyodo',name:'Kyodo News',region:'asia',countries:['JP'],languages:['en','ja'],domains:['kyodonews.net'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://english.kyodonews.net/'},
  {id:'nikkei-asia',name:'Nikkei Asia',region:'asia',countries:['JP'],languages:['en'],domains:['asia.nikkei.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://asia.nikkei.com/'},
  {id:'japan-times',name:'The Japan Times',region:'asia',countries:['JP'],languages:['en'],domains:['japantimes.co.jp'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://www.japantimes.co.jp/feed/'],officialReference:'https://www.japantimes.co.jp/'},
  {id:'cna',name:'CNA',region:'asia',countries:['SG'],languages:['en'],domains:['channelnewsasia.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'personal-noncommercial',rssCandidates:['https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511'],officialReference:'https://www.channelnewsasia.com/rss'},
  {id:'scmp',name:'South China Morning Post',region:'asia',countries:['HK'],languages:['en'],domains:['scmp.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'review-required',rssCandidates:['https://www.scmp.com/rss/91/feed'],officialReference:'https://www.scmp.com/feed-rss'},
  {id:'straits-times',name:'The Straits Times',region:'asia',countries:['SG'],languages:['en'],domains:['straitstimes.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.straitstimes.com/'},
  {id:'yonhap',name:'Yonhap News Agency',region:'asia',countries:['KR'],languages:['en','ko'],domains:['en.yna.co.kr'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://en.yna.co.kr/'},
  {id:'korea-herald',name:'The Korea Herald',region:'asia',countries:['KR'],languages:['en'],domains:['koreaherald.com'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://www.koreaherald.com/'},
  {id:'focus-taiwan',name:'Focus Taiwan',region:'asia',countries:['TW'],languages:['en'],domains:['focustaiwan.tw'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://focustaiwan.tw/'},
  {id:'the-hindu',name:'The Hindu',region:'asia',countries:['IN'],languages:['en'],domains:['thehindu.com'],discoveryModes:['search'],accessPolicy:'subscription-or-license',officialReference:'https://www.thehindu.com/'},
  {id:'indian-express',name:'The Indian Express',region:'asia',countries:['IN'],languages:['en'],domains:['indianexpress.com'],discoveryModes:['search'],accessPolicy:'review-required',officialReference:'https://indianexpress.com/'},
  {id:'times-of-india',name:'The Times of India',region:'asia',countries:['IN'],languages:['en'],domains:['timesofindia.indiatimes.com'],discoveryModes:['search','rss-candidate'],accessPolicy:'personal-noncommercial',rssCandidates:['https://timesofindia.indiatimes.com/rssfeedstopstories.cms'],officialReference:'https://timesofindia.indiatimes.com/timesofindia.indiatimes.com/rss.cms'},
];

const packs=[
  {id:'global-core',region:'global',outletIds:['reuters','ap','bbc','al-jazeera','cna','nhk-world'],domainGroups:[['reuters.com','apnews.com','bbc.com'],['aljazeera.com','channelnewsasia.com','nhk.or.jp']]},
  {id:'europe',region:'europe',outletIds:['bbc','guardian','dw','france24','euronews','politico-eu','financial-times','le-monde','spiegel','elpais'],domainGroups:[['bbc.com','theguardian.com','politico.eu'],['euronews.com','dw.com','france24.com'],['ft.com','lemonde.fr','spiegel.de','elpais.com']]},
  {id:'americas',region:'americas',outletIds:['ap','reuters','npr','new-york-times','washington-post','cbc','bloomberg','wall-street-journal','cnn'],domainGroups:[['apnews.com','reuters.com','npr.org'],['nytimes.com','washingtonpost.com','cbc.ca'],['bloomberg.com','wsj.com','cnn.com']]},
  {id:'asia',region:'asia',outletIds:['nhk-world','kyodo','nikkei-asia','japan-times','cna','scmp','straits-times','yonhap','korea-herald','focus-taiwan','the-hindu','indian-express','times-of-india'],domainGroups:[['nhk.or.jp','kyodonews.net','asia.nikkei.com'],['channelnewsasia.com','scmp.com'],['straitstimes.com','en.yna.co.kr','koreaherald.com'],['focustaiwan.tw','thehindu.com'],['indianexpress.com','timesofindia.indiatimes.com']]},
];

const outletById=new Map(outlets.map(item=>[item.id,item]));
const packById=new Map(packs.map(item=>[item.id,item]));
export const researchNewsSourcePackIds=new Set(packById.keys());

const indexFor=(seed,length)=>length?Number.parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0,8),16)%length:0;

export function getResearchNewsSourcePackDomains(packId,seed=''){
  const pack=packById.get(packId);if(!pack)return[];
  return [...pack.domainGroups[indexFor(`${packId}:${seed}`,pack.domainGroups.length)]];
}

export function getResearchNewsSourceCatalog(){
  return{
    schemaVersion:'research-news-source-catalog-v1',
    generatedAt:null,
    policy:{searchResultsAreCandidates:true,rssAutoSubscription:false,fullTextStorage:false,licenseReviewRequired:true},
    packs:packs.map(pack=>({id:pack.id,region:pack.region,outletCount:pack.outletIds.length,domains:[...new Set(pack.domainGroups.flat())],outlets:pack.outletIds.map(id=>outletById.get(id)).filter(Boolean).map(item=>({...item,countries:[...item.countries],languages:[...item.languages],domains:[...item.domains],discoveryModes:[...item.discoveryModes],rssCandidates:item.rssCandidates?[...item.rssCandidates]:[]}))})),
  };
}
