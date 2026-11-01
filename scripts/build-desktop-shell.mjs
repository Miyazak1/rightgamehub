import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const webRequire = createRequire(path.join(root, 'apps/web/package.json'));
const { build } = await import(pathToFileURL(webRequire.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(webRequire.resolve('@vitejs/plugin-react')).href);
const output = path.join(root, '.runtime/desktop-shell/web');
await fs.mkdir(output, { recursive: true });
await build({ configFile: false, root: path.join(root, 'apps/desktop/renderer'), plugins: [react()],
  resolve: { alias: { react: path.dirname(webRequire.resolve('react/package.json')), 'react-dom': path.dirname(webRequire.resolve('react-dom/package.json')) } },
  build: { target: 'es2022', outDir: output, emptyOutDir: false, sourcemap: true } });
console.log(JSON.stringify({ output, sharedClient: 'packages/platform-client/src/App.jsx' }));
const directory = path.dirname(output);
const executable = path.resolve(root, '../../.runtime/electron-v44.4.5-win32-x64/electron.exe');
await fs.writeFile(path.join(directory, 'launch.json'), JSON.stringify({ assetRoot: output, profileRoot: path.join(directory, 'profile'), initialRoute: '/discover', electronExecutable: executable, electronEntry: path.join(root, 'apps/desktop/electron/main.cjs') }, null, 2));
if (process.platform === 'win32') {
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/codepage:65001',
    '/reference:' + path.join(path.dirname(compiler), 'System.Web.Extensions.dll'), '/reference:' + path.join(path.dirname(compiler), 'System.Windows.Forms.dll'),
    '/out:' + path.join(directory, 'MooyuDesktopPreview.exe'), path.join(root, 'apps/desktop/native/MooyuDesktopPreviewLauncher.cs')], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error('DESKTOP_PREVIEW_LAUNCHER_BUILD_FAILED: ' + result.stdout);
}
