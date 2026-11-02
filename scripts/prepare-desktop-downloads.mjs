import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDesktopDownloads} from './lib/desktop-downloads.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),values={};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--report','--release-info','--output'].includes(key)||!process.argv[i+1]||values[key])throw Error('DESKTOP_DOWNLOAD_OPTIONS_INVALID');values[key]=process.argv[i+1];}
try{console.log(JSON.stringify(await prepareDesktopDownloads({reportFile:path.resolve(values['--report']??path.join(root,'.runtime/desktop-windows-release/report.json')),releaseFile:path.resolve(values['--release-info']??path.join(root,'config/desktop-download-release.json')),outputDirectory:path.resolve(values['--output']??path.join(root,'.runtime/desktop-downloads/data'))}),null,2));}
catch(error){console.error(error.message);process.exitCode=1;}
