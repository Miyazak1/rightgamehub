import {updateVersion} from './update-manifest.mjs';
export function isNewerUpdate(next,current){
  if(!updateVersion(next)||!updateVersion(current))throw Error('DESKTOP_UPDATE_VERSION_INVALID');
  const parse=s=>{const [base,preview]=s.split('-preview.');return [...base.split('.').map(BigInt),preview===undefined?null:BigInt(preview)];};
  const a=parse(next),b=parse(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}
  if(a[3]===null)return b[3]!==null;if(b[3]===null)return false;return a[3]>b[3];
}
