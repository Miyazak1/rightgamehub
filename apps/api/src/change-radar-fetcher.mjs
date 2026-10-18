import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 1024 * 1024;
const ALLOWED_TYPES = ['text/', 'application/json', 'application/xml', 'application/xhtml+xml', 'application/rss+xml', 'application/atom+xml'];
const entityMap = new Map([['amp','&'],['lt','<'],['gt','>'],['quot','"'],['apos',"'"],['nbsp',' ']]);

export class ChangeRadarFetchError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message); this.name = 'ChangeRadarFetchError'; this.code = code; this.statusCode = statusCode;
  }
}

const blockedIpv4 = value => {
  const parts = value.split('.').map(Number);
  const [a,b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};

export const isPrivateAddress = value => {
  const address = String(value || '').toLowerCase().split('%')[0];
  if (net.isIP(address) === 4) return blockedIpv4(address);
  if (net.isIP(address) !== 6) return true;
  if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/u.test(address)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(address);
  return mapped ? blockedIpv4(mapped[1]) : false;
};

export async function assertPublicHttpUrl(input, { lookup = dns.lookup } = {}) {
  let parsed;
  try { parsed = new URL(String(input || '').trim()); } catch { throw new ChangeRadarFetchError('CHANGE_RADAR_URL_INVALID', '请输入完整的 http 或 https 网页地址。'); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new ChangeRadarFetchError('CHANGE_RADAR_URL_INVALID', '仅支持不含账号密码的公开 http 或 https 网页。');
  parsed.hash = '';
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new ChangeRadarFetchError('CHANGE_RADAR_URL_PRIVATE', '不能监控本机或内网地址。');
  let addresses;
  try { addresses = net.isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new ChangeRadarFetchError('CHANGE_RADAR_DNS_FAILED', '暂时无法解析这个网页地址。', 422); }
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new ChangeRadarFetchError('CHANGE_RADAR_URL_PRIVATE', '不能监控本机、内网或保留网络地址。');
  return parsed;
}

const decodeEntities = value => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, key) => {
  if (key[0] === '#') {
    const code = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }
  return entityMap.get(key.toLowerCase()) ?? match;
});

export const normalizeFetchedText = (body, contentType = '') => {
  let text = String(body ?? '');
  if (/html|xhtml/iu.test(contentType)) text = text
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  const normalized = decodeEntities(text).replace(/\r\n?/gu, '\n').replace(/[\t\f\v ]+/gu, ' ').replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
  const bytes = new TextEncoder().encode(normalized);
  return bytes.byteLength <= 500000 ? normalized : new TextDecoder().decode(bytes.slice(0, 500000)).replace(/\uFFFD$/u, '');
};

async function readBounded(response, limit = MAX_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new ChangeRadarFetchError('CHANGE_RADAR_RESPONSE_TOO_LARGE', '网页内容超过 1 MB，暂时不能监控。', 422);
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ChangeRadarFetchError('CHANGE_RADAR_RESPONSE_TOO_LARGE', '网页内容超过 1 MB，暂时不能监控。', 422);
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const requestHeaders = { 'user-agent': 'MOOYU-Change-Radar/1.0 (+https://mooyu.fun)', accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding':'identity' };

async function safeNodeRequest(url,{lookup,timeoutMs}){
  const transport=url.protocol==='https:'?https:http;
  return new Promise((resolve,reject)=>{
    const guardedLookup=(hostname,_options,callback)=>{
      Promise.resolve(net.isIP(hostname)?[{address:hostname,family:net.isIP(hostname)}]:lookup(hostname,{all:true,verbatim:true})).then(addresses=>{
        if(!addresses.length||addresses.some(item=>isPrivateAddress(item.address)))return callback(new ChangeRadarFetchError('CHANGE_RADAR_URL_PRIVATE','不能监控本机、内网或保留网络地址。'));
        callback(null,addresses[0].address,addresses[0].family);
      },()=>callback(new ChangeRadarFetchError('CHANGE_RADAR_DNS_FAILED','暂时无法解析这个网页地址。',422)));
    };
    const request=transport.request(url,{method:'GET',headers:requestHeaders,lookup:guardedLookup,agent:false},response=>{
      const chunks=[];let length=0,settled=false;
      const fail=error=>{if(settled)return;settled=true;response.destroy();reject(error);};
      const declared=Number(response.headers['content-length']);
      if(Number.isFinite(declared)&&declared>MAX_BYTES)return fail(new ChangeRadarFetchError('CHANGE_RADAR_RESPONSE_TOO_LARGE','网页内容超过 1 MB，暂时不能监控。',422));
      response.on('data',chunk=>{length+=chunk.length;if(length>MAX_BYTES)return fail(new ChangeRadarFetchError('CHANGE_RADAR_RESPONSE_TOO_LARGE','网页内容超过 1 MB，暂时不能监控。',422));chunks.push(chunk);});
      response.on('error',fail);
      response.on('end',()=>{if(settled)return;settled=true;resolve({status:response.statusCode||0,ok:(response.statusCode||0)>=200&&(response.statusCode||0)<300,headers:{get:name=>{const value=response.headers[String(name).toLowerCase()];return Array.isArray(value)?value.join(', '):value??null;}},bodyBytes:new Uint8Array(Buffer.concat(chunks,length))});});
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new ChangeRadarFetchError('CHANGE_RADAR_TIMEOUT','网页响应超时。',422)));
    request.on('error',error=>reject(error instanceof ChangeRadarFetchError?error:new ChangeRadarFetchError('CHANGE_RADAR_FETCH_FAILED','暂时无法访问这个网页。',422)));
    request.end();
  });
}

export function createChangeRadarFetcher({ fetchImpl, lookup = dns.lookup, timeoutMs = 15000 } = {}) {
  return async input => {
    let current = await assertPublicHttpUrl(input, { lookup });
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      let response;
      if(fetchImpl){
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
        try { response = await fetchImpl(current, { redirect: 'manual', signal: controller.signal, headers: requestHeaders }); }
        catch (error) { if(error instanceof ChangeRadarFetchError)throw error;throw new ChangeRadarFetchError(error?.name === 'AbortError' ? 'CHANGE_RADAR_TIMEOUT' : 'CHANGE_RADAR_FETCH_FAILED', error?.name === 'AbortError' ? '网页响应超时。' : '暂时无法访问这个网页。', 422); }
        finally { clearTimeout(timer); }
      }else response=await safeNodeRequest(current,{lookup,timeoutMs});
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirects === 5) throw new ChangeRadarFetchError('CHANGE_RADAR_REDIRECT_FAILED', '网页重定向次数过多。', 422);
        current = await assertPublicHttpUrl(new URL(location, current).href, { lookup });
        continue;
      }
      if (!response.ok) throw new ChangeRadarFetchError('CHANGE_RADAR_HTTP_ERROR', `网页返回了 HTTP ${response.status}。`, 422);
      const contentEncoding=(response.headers.get('content-encoding')||'identity').toLowerCase();
      if(contentEncoding!=='identity')throw new ChangeRadarFetchError('CHANGE_RADAR_ENCODING_UNSUPPORTED','网页没有提供可直接读取的文字编码。',422);
      const contentType = (response.headers.get('content-type') || 'text/plain').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_TYPES.some(type => contentType.startsWith(type))) throw new ChangeRadarFetchError('CHANGE_RADAR_TYPE_UNSUPPORTED', '当前仅支持网页、纯文本、XML 和 JSON 内容。', 422);
      const bytes = response.bodyBytes??await readBounded(response), bodyText = normalizeFetchedText(new TextDecoder().decode(bytes), contentType);
      if (!bodyText) throw new ChangeRadarFetchError('CHANGE_RADAR_EMPTY', '网页没有可监控的文字内容。', 422);
      return { finalUrl: current.href, statusCode: response.status, contentType, bodyText, sha256: crypto.createHash('sha256').update(bodyText).digest('hex') };
    }
    throw new ChangeRadarFetchError('CHANGE_RADAR_REDIRECT_FAILED', '网页重定向次数过多。', 422);
  };
}
