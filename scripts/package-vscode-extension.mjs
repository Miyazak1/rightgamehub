import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const extensionRoot = new URL('extensions/vscode/', root);
const artifactRoot = new URL('artifacts/', root);
const pkg = JSON.parse(await readFile(new URL('package.json', extensionRoot), 'utf8'));
const output = new URL(`${pkg.name}-${pkg.version}.vsix`, artifactRoot);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="map" ContentType="application/json" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`;
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="zh-CN" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" /></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>
`;

const inputs = [
  ['[Content_Types].xml', Buffer.from(contentTypes)],
  ['extension.vsixmanifest', Buffer.from(manifest)],
  ['extension/package.json', await readFile(new URL('package.json', extensionRoot))],
  ['extension/gamehub-extension.cjs', await readFile(new URL('gamehub-extension.cjs', extensionRoot))],
  ['extension/desktop-launcher.mjs', await readFile(new URL('extensions/harness/src/desktop-launcher.mjs', root))],
  ['extension/media/gamehub.js', await readFile(new URL('media/gamehub.js', extensionRoot))],
  ['extension/media/gamehub.js.map', await readFile(new URL('media/gamehub.js.map', extensionRoot))],
  ['extension/media/arcade.svg', await readFile(new URL('media/arcade.svg', extensionRoot))],
  ['extension/README.md', await readFile(new URL('README.md', extensionRoot))],
];

const locals = [];
const centrals = [];
let offset = 0;
for (const [name, data] of inputs) {
  const filename = Buffer.from(name);
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  locals.push(local, filename, data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, filename);
  offset += local.length + filename.length + data.length;
}
const centralSize = centrals.reduce((size, chunk) => size + chunk.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(inputs.length, 8);
end.writeUInt16LE(inputs.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

await mkdir(artifactRoot, { recursive: true });
await writeFile(output, Buffer.concat([...locals, ...centrals, end]));
console.log(`Packed ${fileURLToPath(output)}`);
