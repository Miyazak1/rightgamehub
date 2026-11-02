import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Reuse the website mark; PNG-compressed ICO frames support Windows 10+. */
export async function buildDesktopIcons(root, output) {
  const require = createRequire(path.join(root, 'apps/api/package.json'));
  const sharp = require('sharp');
  const source = await fs.readFile(path.join(root, 'apps/web/public/favicon.svg'));
  const directory = path.join(output, 'desktop-icons');
  await fs.mkdir(directory, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = await Promise.all(sizes.map(async size => {
    const data = await sharp(source, { density: 768 }).resize(size, size).png().toBuffer();
    await fs.writeFile(path.join(directory, `mooyu-${size}.png`), data);
    return data;
  }));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const start = 6 + i * 16;
    header[start] = header[start + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(frames[i].length, start + 8); header.writeUInt32LE(offset, start + 12);
    offset += frames[i].length;
  });
  const ico = path.join(directory, 'mooyu.ico');
  await fs.writeFile(ico, Buffer.concat([header, ...frames]));
  return { ico, png: path.join(directory, 'mooyu-256.png'), sizes };
}
