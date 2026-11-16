const release=/^\/v1\/works\/[A-Za-z0-9-]+\/releases\/[A-Za-z0-9-]+\/download$/u;
export function businessResourcePath(value,origin){
  try{const url=new URL(value,origin);if(url.origin!==origin||url.username||url.password||url.hash||url.search||!release.test(url.pathname))return null;return url.pathname;}catch{return null;}
}
export function desktopResourceUrl(value,origin){const target=businessResourcePath(value,origin);return target?'mooyu-app://client/__desktop-file?path='+encodeURIComponent(target):null;}
