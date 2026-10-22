import crypto from 'node:crypto';
import {createChangeRadarFetcher} from './change-radar-fetcher.mjs';

const clean=(value,max=2000)=>String(value??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu,'$1').replace(/<[^>]+>/gu,' ').replace(/&lt;/giu,'<').replace(/&gt;/giu,'>').replace(/&quot;/giu,'"').replace(/&apos;/giu,"'").replace(/&amp;/giu,'&').replace(/&#(\d+);/gu,(_,code)=>String.fromCodePoint(Math.min(0x10ffff,Number(code)||32))).replace(/\s+/gu,' ').trim().slice(0,max);
const first=(xml,names)=>{for(const name of names){const match=new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'iu').exec(xml);if(match)return clean(match[1]);}return'';};
const atomLink=xml=>{const match=/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/iu.exec(xml);return match?clean(match[1],2048):'';};
const safeLink=(value,base)=>{if(!value)return null;try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const date=value=>{if(!value)return null;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed.toISOString();};

export class ResearchFeedError extends Error{
  constructor(code,message,statusCode=422){super(message);this.name='ResearchFeedError';this.code=code;this.statusCode=statusCode;this.retryable=statusCode>=500;}
}

export function parseSyndicationFeed(xml,{url='https://example.invalid/feed'}={}){
  const source=String(xml??'');
  if(!source||source.length>1_100_000)throw new ResearchFeedError('RESEARCH_FEED_INVALID','订阅源内容为空或过大。');
  if(/<!DOCTYPE|<!ENTITY/iu.test(source))throw new ResearchFeedError('RESEARCH_FEED_UNSAFE_XML','订阅源包含不支持的 XML 声明。');
  const atom=/<feed\b/iu.test(source),rss=/<rss\b|<rdf:RDF\b/iu.test(source);
  if(!atom&&!rss)throw new ResearchFeedError('RESEARCH_FEED_INVALID','这不是可识别的 RSS 或 Atom 订阅源。');
  const blocks=[...source.matchAll(atom?/<entry\b[^>]*>([\s\S]*?)<\/entry>/giu:/<item\b[^>]*>([\s\S]*?)<\/item>/giu)].slice(0,100);
  const seen=new Set(),entries=[];
  for(const match of blocks){const block=match[1],title=first(block,['title'])||'未命名更新',rawLink=atomLink(block)||first(block,['link']),link=safeLink(rawLink,url),externalId=first(block,atom?['id']:['guid'])||link||title,publishedAt=date(first(block,atom?['published','updated']:['pubDate','dc:date','date'])),summary=first(block,atom?['summary','content']:['description','content:encoded'])||title,contentHash=crypto.createHash('sha256').update(JSON.stringify({externalId,title,link,publishedAt,summary})).digest('hex');if(seen.has(externalId))continue;seen.add(externalId);entries.push({externalId:externalId.slice(0,500),title:title.slice(0,240),url:link,publishedAt,summary:summary.slice(0,2000),contentHash});}
  if(!entries.length)throw new ResearchFeedError('RESEARCH_FEED_EMPTY','订阅源里没有可读取的条目。');
  return{protocol:'syndication-preview-v1',feed:{title:first(source,['title']).slice(0,240)||new URL(url).hostname,url,homeUrl:safeLink(atomLink(source)||first(source,['link']),url)},entries};
}

export function createResearchFeedAdapter({fetchText=createChangeRadarFetcher()}={}){
  return{async inspect(url){const result=await fetchText(url);if(!['application/rss+xml','application/atom+xml','application/xml','text/xml','text/plain'].includes(result.contentType))throw new ResearchFeedError('RESEARCH_FEED_TYPE_UNSUPPORTED','该地址没有返回 RSS、Atom 或 XML 文本。');return{...parseSyndicationFeed(result.bodyText,{url:result.finalUrl}),fetchedAt:new Date().toISOString(),statusCode:result.statusCode,contentType:result.contentType,contentHash:result.sha256};}};
}
